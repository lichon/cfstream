import { Hono, Context } from 'hono'
import {
  setSignal, getSignal, SignalRoom,
  setStreamRoom, getStreamRoom,
  setStreamSecret, getStreamSecret, delStreamSecret,
  getStreamSubs, putStreamSubs, delStreamSubs,
  sendChannelMessage,
} from './supabase'

type Bindings = {
  RTC_APP_ID: string
  RTC_API_URL: string
  RTC_API_TOKEN: string
  WEB_HOOK: string
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

const sendWebHook = async (hookURL: string, message: string) => {
  return fetch(hookURL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      msgtype: 'text',
      text: { content: message }
    })
  })
}

const app = new Hono<{ Bindings: Bindings }>()

app.get('/', async (c) => {
  return c.text('hello world')
})

app.get('/api', (c) => c.text(crypto.randomUUID()))

// api create signal room
app.post('/api/signals/:name', async (c) => {
  const name = c.req.param('name')
  if (!name?.length || name === 'null' || name === 'undefined') {
    return c.json({}, 400)
  }
  const signalRoom = await c.req.json() as SignalRoom
  await setSignal(c, signalRoom)
  return c.json({}, 200)
})

// api get signal room
app.get('/api/signals/:name', async (c) => {
  const name = c.req.param('name')
  if (!name?.length || name === 'null' || name === 'undefined') {
    return c.json({}, 404)
  }
  const room = await getSignal(c, name)
  return room ? c.json(room, 200) : c.json({}, 404)
})

// api create stream room
app.post('/api/rooms/:name', async (c) => {
  const name = c.req.param('name')
  if (!name?.length || name === 'null' || name === 'undefined') {
    return c.text('invalid room', 404)
  }
  const room = await c.req.json()
  const ok = await setStreamRoom(c, name, room.sid)
  return c.json({}, ok ? 200 : 500)
})

// api get room info
app.get('/api/rooms/:name', async (c) => {
  const name = c.req.param('name')
  if (!name?.length || name === 'null' || name === 'undefined') {
    return c.text('invalid room', 404)
  }
  const sid = await getStreamRoom(c, name)
  return sid?.length ? c.text(sid, 200) : c.text('room not found', 404)
})

app.post('/api/rooms/:name/message', async (c) => {
  const name = c.req.param('name')
  if (!name?.length || name === 'null' || name === 'undefined') {
    return c.text('invalid room', 404)
  }
  const msg = await c.req.json()
  const ok = await sendChannelMessage(c, name, msg.content)
  return c.json({}, ok ? 200 : 500)
})

// api create session
app.post('/api/sessions', async (c) => {
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
    c.header('Location', `sessions/dc/${sid}`)
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

  if (c.env.WEB_HOOK?.length) {
    await sendWebHook(c.env.WEB_HOOK, `https://${c.req.header('Host')}?sid=${sid}_`)
  }

  // create session secret
  const secret = crypto.randomUUID()
  await setStreamSecret(c, sid, secret)

  c.header('Location', `sessions/${secret}/${sid}`)
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
  const secret = c.req.param('secret')
  const sessionSecret = await getStreamSecret(c, sid)
  // check secret for session
  if (!sid || secret !== sessionSecret) {
    return c.json({}, 403)
  }

  if (c.env.WEB_HOOK?.length) {
    await sendWebHook(c.env.WEB_HOOK, `session end ${sid}`)
  }
  await delStreamSecret(c, sid)
  await delStreamSubs(c, sid)
  console.log(`del stream session ${sid}`)
  return c.json({}, 200)
})

// api play session
app.post('/api/sessions/:sid', async (c) => {
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
  await putStreamSubs(c, streamSid, playerSid)

  c.header('Location', `sessions/sub/${playerSid}`)
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
  const subs = await getStreamSubs(c, sid)
  const status = await getSessionStatus(c, sid)
  status.subs = subs.length ? subs : []
  return c.json(status)
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

// sdp experiment
interface MediaSdp {
  m: string
  mid: string
  ice: string[]
  sendOrRecv: string
  content: string[]
}

function disableMedia(media: MediaSdp): MediaSdp {
  if (!media.m)
    return media

  const newContent = []
  for (const line of media.content) {
    if (line.startsWith('a=extmap')) {
      continue
    }
    if (line.startsWith('a=rtpmap')) {
      continue
    }
    if (line.startsWith('a=rtcp-fb')) {
      continue
    }
    if (line.startsWith('a=fmtp')) {
      continue
    }
    newContent.push(line)
  }

  if (media.m.startsWith('m=video')) {
    media.m = 'm=video 9 UDP/TLS/RTP/SAVPF 96'
    newContent.push('a=rtpmap:96 VP8/90000')
  }
  if (media.m.startsWith('m=audio')) {
    media.m = 'm=audio 0 UDP/TLS/RTP/SAVPF 111'
    newContent.push('a=rtpmap:111 opus/48000/2')
  }
  media.ice = []
  media.sendOrRecv = 'a=recvonly'
  media.content = newContent

  return media
}

// @ts-expect-error keep
function _getMediaFromSdp(sfuOffer: SessionDescription): MediaSdp[] {
  const ret: MediaSdp[] = []
  const lines = sfuOffer.sdp.split('\r\n')

  let activeMedia = null
  for (const line of lines) {
    if (line.length == 0) {
      continue
    }
    if (line.startsWith('m=')) {
      activeMedia = {
        m: line,
        mid: '',
        sendOrRecv: '',
        ice: [],
        content: [],
      } as MediaSdp
      ret.push(activeMedia)
      continue
    }
    if (!activeMedia) {
      continue
    }
    if (line.startsWith('a=candidate:') || line.startsWith('a=ice-') || line.startsWith('a=fingerprint')) {
      activeMedia.ice.push(line)
      continue
    }
    if (line.startsWith('a=mid')) {
      activeMedia.mid = line
      continue
    }
    if (line.startsWith('a=send') || line.startsWith('a=recv')) {
      activeMedia.sendOrRecv = line
      continue
    }
    activeMedia.content.push(line)
  }

  return ret
}

// @ts-expect-error keep
function _createAnswerForPlayer(sfuMedia: MediaSdp[], playerMedia: MediaSdp[], baseOffer: SessionDescription): SessionDescription {
  const finalMedia: MediaSdp[] = []

  let validAudio: MediaSdp | null = null
  let validVideo: MediaSdp | null = null
  const validCandidate: string[] = []
  sfuMedia.forEach(media => {
    const valid = media.sendOrRecv.startsWith('a=send')
    if (valid) {
      if (media.m.startsWith('m=video'))
        validVideo = media
      if (media.m.startsWith('m=audio'))
        validAudio = media
    }
    media.ice.forEach(ice => {
      if (ice.startsWith('a=candidate'))
        validCandidate.push(ice)
    })
  })

  for (const media of playerMedia) {
    if (media.m.startsWith('m=video')) {
      if (validVideo) {
        const m = validVideo as MediaSdp
        m.mid = media.mid
        finalMedia.push(m)
      } else {
        finalMedia.push(disableMedia(media))
      }
    }
    if (media.m.startsWith('m=audio')) {
      if (validAudio) {
        const m = validAudio as MediaSdp
        m.mid = media.mid
        finalMedia.push(validAudio)
      } else {
        finalMedia.push(disableMedia(media))
      }
    }
  }
  
  const answerLines: string[] = []
  const lines = baseOffer.sdp.split('\r\n')
  for (const line of lines) {
    if (line.startsWith('a=group:BUNDLE')) {
      const mids = finalMedia
        .map(m => m.mid.replace('a=mid:', '').trim())
        .filter(mid => mid !== '')
        .join(' ')
      answerLines.push(`a=group:BUNDLE ${mids}`)
      continue
    }
    if (line.startsWith('m=')) {
      break
    }
    answerLines.push(line)
  }

  console.log('player', playerMedia)
  console.log('a', validAudio)
  console.log('v', validVideo)
  console.log('final', finalMedia)
  console.log('ans1', answerLines)

  let hasCandidate = false
  for (const media of finalMedia) {
    answerLines.push(media.m)
    media.content.forEach(content => {
      if (content.startsWith('a=setup')) {
        answerLines.push('a=setup:passive')
      } else {
        answerLines.push(content)
      }
    })
    media.ice.forEach(ice => {
      if (ice.startsWith('a=candidate')) {
        hasCandidate = true
      }
      answerLines.push(ice)
    })
    if (!hasCandidate) {
      validCandidate.forEach(cand => {
        answerLines.push(cand)
      })
      answerLines.push('a=end-of-candidates')
      hasCandidate = true
    }

    answerLines.push(media.mid)
    answerLines.push(media.sendOrRecv)
  }

  return {
    type: 'answer',
    sdp: answerLines.join('\r\n') + '\r\n',
  }
}

// @ts-expect-error keep
function _createAnswerForSfu(sfuMedia: MediaSdp[], playerMedia: MediaSdp[], baseOffer: SessionDescription): SessionDescription {
  const finalMedia: MediaSdp[] = []

  let validAudio: MediaSdp | null = null
  let validVideo: MediaSdp | null = null
  const validCandidate: string[] = []
  playerMedia.forEach(media => {
    const valid = media.sendOrRecv.startsWith('a=send')
    if (valid) {
      if (media.m.startsWith('m=video'))
        validVideo = media
      if (media.m.startsWith('m=audio'))
        validAudio = media
    }
    media.ice.forEach(ice => {
      if (ice.startsWith('a=candidate'))
        validCandidate.push(ice)
    })
  })

  for (const media of sfuMedia) {
    if (media.m.startsWith('m=video')) {
      if (validVideo) {
        const m = validVideo as MediaSdp
        m.mid = media.mid
        finalMedia.push(m)
      } else {
        finalMedia.push(disableMedia(media))
      }
    }
    if (media.m.startsWith('m=audio')) {
      if (validAudio) {
        const m = validAudio as MediaSdp
        m.mid = media.mid
        finalMedia.push(validAudio)
      } else {
        finalMedia.push(disableMedia(media))
      }
    }
  }
  
  const answerLines: string[] = []
  const lines = baseOffer.sdp.split('\r\n')
  for (const line of lines) {
    if (line.startsWith('a=group:BUNDLE')) {
      const mids = finalMedia
        .map(m => m.mid.replace('a=mid:', '').trim())
        .filter(mid => mid !== '')
        .join(' ')
      answerLines.push(`a=group:BUNDLE ${mids}`)
      continue
    }
    if (line.startsWith('m=')) {
      break
    }
    answerLines.push(line)
  }


  let hasCandidate = false
  for (const media of finalMedia) {
    answerLines.push(media.m)
    media.content.forEach(content => {
      if (content.startsWith('a=setup')) {
        answerLines.push('a=setup:passive')
      } else {
        answerLines.push(content)
      }
    })
    media.ice.forEach(ice => {
      if (ice.startsWith('a=candidate')) {
        hasCandidate = true
      }
      answerLines.push(ice)
    })
    if (!hasCandidate) {
      validCandidate.forEach(cand => {
        answerLines.push(cand)
      })
      answerLines.push('a=end-of-candidates')
      hasCandidate = true
    }

    answerLines.push(media.mid)
    answerLines.push(media.sendOrRecv)
  }

  return {
    type: 'answer',
    sdp: answerLines.join('\r\n') + '\r\n',
  }
}

export default app
