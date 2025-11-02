import { Hono, Context } from 'hono'
import { upgradeWebSocket } from 'hono/cloudflare-workers'
import { LiveRoom as LiveRoom_ } from './live-room'

export class LiveRoom extends LiveRoom_ { }

type Bindings = {
  LIVE_ROOM: DurableObjectNamespace<LiveRoom>
  LOCAL_DEBUG: boolean
  RTC_API_URL: string
  RTC_API_TOKEN: string
  SUPABASE_URL: string
}

interface NewSessionResponse {
  sessionId: string
  sessionDescription?: SessionDescription
}

interface Track {
  location: 'local' | 'remote'
  mid?: string
  trackName: string
  sessionId?: string
}

interface DataChannel {
  location: 'local' | 'remote'
  sessionId: string
  dataChannelName: string
}

interface SessionDescription {
  sdp: string
  type?: 'offer' | 'answer'
}

interface TracksResponse {
  requiresImmediateRenegotiation?: boolean
  tracks: Track[]
  sessionDescription: SessionDescription
}

interface TracksRequest {
  tracks: Track[]
  sessionDescription?: SessionDescription
  autoDiscover?: boolean
}

interface SessionStatus {
  tracks: Track[]
  datachannels: DataChannel[]
  subs: string[]
  errorCode?: string
  errorDescription?: string
}

interface PatchRequest {
  dataChannels?: DataChannel[]
  tracks?: Track[]
}

// Add this helper function at the top of the file after the imports
const rtcApi = (c: Context, url: string, init?: RequestInit) => {
  return fetch(`${c.env.RTC_API_URL}${url}`, {
    ...init,
    headers: {
      ...init?.headers,
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${c.env.RTC_API_TOKEN}`,
    },
  })
}

function createTracksRequest(sdp?: string, tracks?: Track[], sid?: string): TracksRequest {
  if (tracks) {
    const remoteTracks = tracks.map(t => {
      return { location: 'remote', sessionId: sid, trackName: t.trackName } as Track
    })
    return {
      tracks: remoteTracks,
      ... (sdp?.length ?
        {
          sessionDescription: { sdp: sdp, type: 'offer' }
        } : {}
      )
    }
  }

  return {
    sessionDescription: {
      sdp: sdp,
      type: 'offer'
    },
    autoDiscover: true
  } as TracksRequest
}

const app = new Hono<{ Bindings: Bindings }>()

app.get('/api', (c) => c.text(crypto.randomUUID()))

// hbbs ws api
app.get('/ws', upgradeWebSocket((c) => {
  return {
    onClose: () => {
      console.log('hbbs ws close')
    },
    onMessage: async (event, ws) => {
      console.log('hbbs ws message', event.data)
      if (typeof event.data === 'string') {
        const roomId = c.env.LIVE_ROOM.idFromName(event.data)
        const roomObj = c.env.LIVE_ROOM.get(roomId)
        const sid = await roomObj.getSessionId()
        ws.send(`sid: ${sid}`)
      }
    },
  }
}))

// supabase proxy
app.all('/api/supabase/*', async (c) => {
  const supaUrl = new URL(c.env.SUPABASE_URL)
  const targetURL = new URL(c.req.url);
  targetURL.protocol = supaUrl.protocol
  targetURL.host = supaUrl.host
  targetURL.port = supaUrl.port
  targetURL.pathname = targetURL.pathname.substring(5);
  const newRequest = new Request(targetURL, {
    method: c.req.method,
    headers: c.req.raw.headers,
    body: c.req.raw.body
  });
  return fetch(newRequest)
})

// api get session id by name
app.get('/api/rooms/:name?', async (c) => {
  const name = c.req.param('name')
  if (name) {
    const roomId = c.env.LIVE_ROOM.idFromName(name)
    const roomObj = c.env.LIVE_ROOM.get(roomId)
    return c.text(await roomObj.getSessionId())
  }
  return c.text('', 400)
})

// api create session, whip api
app.post('/api/sessions/:name?', async (c) => {
  const sdp = await c.req.text()
  if (!sdp?.length) {
    return c.text('invalid request', 400)
  }
  const hasMedia = sdp.includes('m=audio') || sdp.includes('m=video')
  const dcOnly = !hasMedia && sdp.includes('m=application')
  if (!hasMedia && !dcOnly) {
    return c.text('invalid request', 400)
  }

  const session = await newSession(c, dcOnly ? createTracksRequest(sdp).sessionDescription : undefined)
  const sid = session.sessionId

  console.log(`new ${hasMedia ? 'stream' : 'dc'} session ${sid}`)
  if (dcOnly) {
    c.header('Location', `/api/sessions/dc/${sid}`)
    c.header('Access-Control-Expose-Headers', 'Location')
    c.header('Access-Control-Allow-Origin', '*')
    return c.text(session.sessionDescription?.sdp || '')
  }
  const res = await rtcApi(c, `/sessions/${sid}/tracks/new`, {
    method: 'POST',
    body: JSON.stringify(createTracksRequest(sdp))
  }).catch(_ => {
    return c.text('new tracks error', 500)
  })
  const tracksRes = await res.json() as TracksResponse

  // create session secret
  const secret = crypto.randomUUID()
  const name = c.req.param('name')
  if (name) {
    const roomId = c.env.LIVE_ROOM.idFromName(name)
    const roomObj = c.env.LIVE_ROOM.get(roomId)
    roomObj.setSessionId(sid)
  }

  c.header('Location', `/api/sessions/${secret}/${sid}`)
  c.header('Access-Control-Expose-Headers', 'Location')
  c.header('Access-Control-Allow-Origin', '*')
  return c.text(tracksRes.sessionDescription?.sdp || '')
})

// api patch session, bind dc to session
app.patch('/api/sessions/:sid', async (c) => {
  // TODO check session's secret
  const sid = c.req.param('sid')
  if (c.req.header('Content-Type')?.indexOf('text/plain') != -1) {
    const sessionStatus = await getSessionStatus(c, sid)
    if (sessionStatus.datachannels?.length || sessionStatus.tracks?.length) {
      return c.text('', 403)
    }
    // disable kick function
    return c.text('', 201)

    // const kickBySubSession = c.req.header('X-Sub-Session')
    // this would break the session's ice connection by cf sfu
    const sdp = await c.req.text()
    const res = await rtcApi(c, `/sessions/${sid}/tracks/new`, {
      method: 'POST',
      body: JSON.stringify(createTracksRequest(sdp))
    })
    return res.status <= 201 ? c.text('ok', 201) : res
  }

  const patch = await c.req.json() as PatchRequest
  if (patch?.dataChannels?.length) {
    const res = await rtcApi(c, `/sessions/${sid}/datachannels/new`, {
      method: 'POST',
      body: JSON.stringify(patch)
    }).catch(_ => {
      return c.text('new dc error', 500)
    })
    const jsonRes = await res.json()
    return c.json(jsonRes || {})
  } else if (patch?.tracks?.length) {
    const res = await rtcApi(c, `/sessions/${sid}/tracks/new`, {
      method: 'POST',
      body: JSON.stringify(createTracksRequest('', patch.tracks, ))
    }).catch(_ => {
      return c.text('new tracks error', 500)
    })
    const jsonRes = await res.json()
    return c.json(jsonRes || {})
  }
  return c.json({}, 403)
})

// api delete session
app.delete('/api/sessions/:secret/:sid', async (c) => {
  const sid = c.req.param('sid')
  console.log(`del stream session ${sid}`)
  return c.json({}, 200)
})

// api play session, whep api
app.post('/api/sessions/:sid/play', async (c) => {
  const streamSid = c.req.param('sid')
  const sessionStat = await getSessionStatus(c, streamSid)
  if (!sessionStat?.tracks?.length && !sessionStat?.datachannels?.length) {
    return c.text('session not found', 404)
  }
  // use offer to create recvonly track
  const playerSdp = await c.req.text()
  const request = createTracksRequest(playerSdp, sessionStat.tracks, streamSid)

  // create new sub session
  const session = await newSession(c)
  const playerSid = session.sessionId

  const res = await rtcApi(c, `/sessions/${playerSid}/tracks/new`, {
    method: 'POST',
    body: JSON.stringify(request)
  })
  const joinRes = await res.json() as TracksResponse
  console.log(`new play session ${playerSid}`)

  // save new sub to session
  // await putStreamSubs(c, streamSid, playerSid)

  c.header('Location', `/api/sessions/${playerSid}/play`)
  c.header('Access-Control-Expose-Headers', 'Location')
  c.header('Access-Control-Allow-Origin', '*')
  return c.text(joinRes.sessionDescription.sdp, 201)
})

// api get session info
app.get('/api/sessions/:sid', async (c) => {
  const sid = c.req.param('sid')
  if (!sid?.length || sid === 'null' || sid === 'undefined') {
    return c.json({}, 404)
  }
  const subs = [] as string[] // await getStreamSubs(c, sid)
  const status = await getSessionStatus(c, sid)
  status.subs = subs.length ? subs : []
  return c.json(status)
})

app.get('/*', (c) => {
  if (c.env.LOCAL_DEBUG)
    return fetch('http://localhost:5173/index.html')
  return c.notFound()
})

// session utils
async function newSession(c: Context, offer?: SessionDescription) {
  const res = await rtcApi(c, `/sessions/new`, {
    method: 'POST',
    body: offer ? JSON.stringify({ sessionDescription: offer }) : undefined
  })
  return await res.json() as NewSessionResponse
}

async function getSessionStatus(c: Context, sid: string) {
  const res = await rtcApi(c, `/sessions/${sid}`, {
    method: 'GET',
  })
  return await res.json() as SessionStatus
}

export default app
