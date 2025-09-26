import { getConfig } from '../config'

const ROOM_API = getConfig().api.roomUrl
const SESSION_API = getConfig().api.sessionUrl
const BROADCAST_LABEL = getConfig().stream.broadcastLabel

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

interface SessionStatus {
  tracks: Track[]
  datachannels: DataChannel[]
  subs: string[]
  errorCode?: string
  errorDescription?: string
}

export interface DataChannelConfig {
  sessionId: string;
  location: 'local' | 'remote';
  dataChannelName: string;
}

export interface NewSessionResponse {
  sessionId: string;
  sessionDescription?: RTCSessionDescription;
}

export function getSessionUrl(sid?: string | null): string {
  const apiHost = window.location.host
  const protocol = window.location.protocol
  return `${protocol}//${apiHost}${SESSION_API}` + (sid ? `/${sid}` : '')
}

export function getPlayerUrl(sid?: string, name?: string): string {
  const playerHost = window.location.host
  const protocol = window.location.protocol
  if (name?.length)
    return `${protocol}//${playerHost}?name=${name}`
  return `${protocol}//${playerHost}` + (sid ? `?sid=${sid}` : '')
}

export function extractSessionIdFromUrl(url: string | null): string | undefined {
  return url ? url.split('/').pop() : undefined;
}

export async function createSession(offerSdp: string | undefined): Promise<NewSessionResponse | null> {
  const res = await fetch(SESSION_API, {
    method: 'POST',
    body: offerSdp
  })
  if (!res.ok)
    return null

  return {
    sessionId: extractSessionIdFromUrl(res.headers.get('Location')) || '',
    sessionDescription: new RTCSessionDescription({
      type: 'answer',
      sdp: await res.text()
    })
  }
}

export async function kickSignalSession(sid: string, sdp: string): Promise<Response> {
  return fetch(`${SESSION_API}/${sid}`, {
    method: 'PATCH',
    body: sdp
  })
}

export async function createDataChannel(
  sid: string, 
  configs?: DataChannelConfig[],
): Promise<{ dataChannels: { id: number }[] }> {
  const res = await fetch(`${SESSION_API}/${sid}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ dataChannels: configs })
  });
  return res.json()
}

export async function getSessionInfo(sid: string): Promise<SessionStatus> {
  const res = await fetch(`${SESSION_API}/${sid}`)
  return res.json()
}

export async function setSessionByName(name: string, sid: string) {
  const res = await fetch(`${ROOM_API}/${name}`, {
    method: 'POST',
    body: JSON.stringify({ name: name, sid: sid, })
  })
  return res
}

export async function getSessionByName(name: string): Promise<string> {
  const res = await fetch(`${ROOM_API}/${name}`)
  return res.text()
}

export async function requestDataChannel(
  sid: string,
  peer: RTCPeerConnection,
  remoteSid?: string | null,
  label?: string | null,
): Promise<RTCDataChannel> {
  const dcRes = await createDataChannel(sid, [{
    sessionId: remoteSid ?? sid,
    location: remoteSid ? 'remote' : 'local',
    dataChannelName: label ?? BROADCAST_LABEL,
  }])
  if (!dcRes.dataChannels.length || !dcRes.dataChannels[0].id) {
    // never open dc
    return {} as RTCDataChannel
  }
  const dc = peer.createDataChannel(label ?? BROADCAST_LABEL, {
    negotiated: true,
    id: dcRes.dataChannels[0].id
  })
  return dc
}
