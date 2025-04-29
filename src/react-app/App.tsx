// src/App.tsx

import { useState } from 'react'
import './App.css'

import { WHIPClient } from '@eyevinn/whip-web-client'
import { WebRTCPlayer } from "@eyevinn/webrtc-player";

async function newSession() {
  const res = await fetch('/api/sessions/new', { method: 'POST' })
  const json = await res.json() as { sessionId: string }
  return json.sessionId
}

function App() {
  const [session, setSession] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('sid') || ''
  })
  const [whipClient, setWHIPClient] = useState<WHIPClient | null>()

  async function joinSession(sid: string) {
    const video = document.querySelector<HTMLVideoElement>('#video')
    if (!video)
      throw Error('no video element')

    const player = new WebRTCPlayer({
      video: video,
      type: 'whep',
      statsTypeFilter: '^candidate-*|^inbound-rtp',
      debug: true,
      iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
    })
    const url = new URL(window.location.href)
    url.pathname = `api/session/${sid}/join`
    url.search = ''
    await player.load(url);
    player.unmute()
    return sid
  }

  async function deleteSession() {
    if (whipClient) {
      await whipClient.destroy()
      setWHIPClient(null)
      setSession(null)
    }
  }

  async function createSession() {
    const sid = await newSession()
    const url = new URL(window.location.href)
    const client = new WHIPClient({
      endpoint: `${url}api/session/${sid}`,
      opts: {
        debug: true,
        noTrickleIce: true,
        iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }]
      }
    })
    await client.setIceServersFromEndpoint()

    const videoIngest = document.querySelector<HTMLVideoElement>('#video')
    if (!videoIngest)
      throw Error('video tag not found')

    const mediaStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    })
    videoIngest.srcObject = mediaStream
    await client.ingest(mediaStream)
    setSession(sid)
    setWHIPClient(client)
  }

  return (
    <>
      <div id='control' className='control'>
        <button className='control-bt'
          onClick={async (e) => {
            const bt = e.target as HTMLButtonElement
            if (bt.innerText == 'stop') {
              deleteSession()
              return
            }
            if (session)
              joinSession(session)
            else
              createSession()
          }}
        >
          {new URLSearchParams(window.location.search).get('sid') ? 'join' : session ? 'stop' : 'start'}
        </button>
        <button className='control-bt'
          onClick={() => {
            const url = new URL(window.location.href)
            url.searchParams.set('sid', session || '')
            navigator.clipboard.writeText(url.toString())
              // .then(() => { window.open(url.toString(), '_blank') })
              .catch((err) => {
                console.error('Failed to copy:', err)
                alert('Failed to copy link')
              })
          }}
        >
          Copy view link
        </button>
        <button className='control-bt'
          onClick={async () => {
            try {
              const res = await fetch('/api/session/' + session)
              if (!res.ok) {
                throw new Error(`HTTP error! status: ${res.status}`)
              }
            } catch (error) {
              console.error('test failed:', error)
            }
          }}
        >
          Info
        </button>
      </div>
      <div className='media'>
        <video id='video' autoPlay muted></video>
      </div>
    </>
  )
}

export default App
