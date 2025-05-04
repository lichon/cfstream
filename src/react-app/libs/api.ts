// API服务封装
const API_BASE = '/api/sessions';

export type SignalType = 'signalsession' | 'chat' | 'action'

export const STUN_SERVERS = [{ urls: 'stun:stun.cloudflare.com:3478' }]

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

export function extractSessionIdFromUrl(url: string | null): string | undefined {
  return url ? url.split('/').pop() : undefined;
}

export function getSessionUrl(sid?: string | null): string {
  const url = new URL(window.location.href);
  url.pathname = sid ? `${API_BASE}/${sid}` : API_BASE;
  url.search = '';
  return url.toString();
}

export function getPlayerUrl(sid?: string | null): string {
  const url = new URL(window.location.href);
  url.pathname = '/play';
  url.search = `?sid=${sid}`;
  return url.toString();
}

export async function createSession(offerSdp: string | undefined): Promise<NewSessionResponse | null> {
  const res = await fetch(API_BASE, {
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
  return fetch(`${API_BASE}/${sid}`, {
    method: 'PATCH',
    body: sdp
  })
}

export async function createDataChannel(
  sid: string, 
  configs?: DataChannelConfig[],
): Promise<{ dataChannels: { id: number }[] }> {
  const res = await fetch(`${API_BASE}/${sid}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ dataChannels: configs })
  });
  return res.json()
}

export async function getSessionInfo(sid: string): Promise<SessionStatus> {
  const res = await fetch(`${API_BASE}/${sid}`);
  return res.json();
}

export async function initDataChannel(
  sid: string,
  peer: RTCPeerConnection,
  remoteSid?: string | null,
  label?: string | null,
): Promise<RTCDataChannel> {
  const dcRes = await createDataChannel(sid, [{
    sessionId: remoteSid ?? sid,
    location: remoteSid ? 'remote' : 'local',
    dataChannelName: label ?? 'broadcast',
  }])
  const dc = peer.createDataChannel(label ?? 'broadcast', {
    negotiated: true,
    id: dcRes.dataChannels[0].id
  })
  return dc
}
