// src/App.tsx

import { useState, useEffect } from 'react'
import './App.css'

import { WHIPClient } from '@eyevinn/whip-web-client'
import { WebRTCPlayer } from "@eyevinn/webrtc-player"
import QRCode from 'qrcode'

async function newSession() {
  const res = await fetch('/api/sessions/new', { method: 'POST' })
  const json = await res.json() as { sessionId: string }
  return json.sessionId
}

let _firstLoad = true

function App() {
  const [session, setSession] = useState<string | null>()
  const [whipClient, setWHIPClient] = useState<WHIPClient | null>()
  const [whepPlayer, setWHEPPlayer] = useState<WebRTCPlayer | null>()
  const [qrVisible, setQrVisible] = useState(false)

  useEffect(() => {
    if (!_firstLoad) return
    _firstLoad = false
    const params = new URLSearchParams(window.location.search)
    const sid = params.get('sid')
    if (sid?.length) {
      playSession(sid)
    }
  }, []) // Empty dependency array means this runs once on mount

  async function playSession(sid: string) {
    const video = document.querySelector<HTMLVideoElement>('#video')
    if (whepPlayer || !video)
      return

    const player = new WebRTCPlayer({
      video: video,
      type: 'whep',
      statsTypeFilter: '^candidate-*|^inbound-rtp',
      debug: true,
      iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
    })
    setWHEPPlayer(player)
    setSession(sid)

    const sourceUrl = new URL(window.location.href)
    sourceUrl.pathname = `api/session/${sid}/join`
    sourceUrl.search = ''
    await player.load(sourceUrl)
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

  // Add this function to generate QR code
  async function generateQR(url: string) {
    try {
      const canvas = document.getElementById('qrCode') as HTMLCanvasElement
      await QRCode.toCanvas(canvas, url, {
        width: 240,
        margin: 0
      })
    } catch (err) {
      console.error('Error generating QR code:', err)
    }
  }

  return (
    <>
      <div id='control' className='control'>
        <button className='control-bt'
          onClick={() => {
            if (session) {
              deleteSession()
            } else {
              createSession()
            }
          }}
        >
          {session ? 'stop' : 'start'}
        </button>
        <button className='control-bt'
          onClick={() => {
            const shareUrl = new URL(window.location.href)
            if (session?.length)
              shareUrl.searchParams.set('sid', session)
            const urlString = shareUrl.toString()
            
            navigator.clipboard.writeText(urlString)
              .catch((err) => {
                console.error('Failed to copy:', err)
                alert('Failed to copy link')
              })

            // Generate and show QR code
            setQrVisible(true)
            // generate after canvas has shown in DOM
            setTimeout(() => generateQR(urlString))
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
        <video id='video' autoPlay muted controls></video>
      </div>

      {/* Add QR code canvas */}
      {qrVisible && (
        <div className='qr-overlay' onClick={() => setQrVisible(false)}>
          <div className='qr-container'>
            <canvas id='qrCode'></canvas>
            <p>Click anywhere to close</p>
          </div>
        </div>
      )}
    </>
  )
}

export default App
