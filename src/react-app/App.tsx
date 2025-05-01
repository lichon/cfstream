// src/App.tsx

import { useState, useEffect } from 'react'
import './App.css'

import { WHIPClient } from '@eyevinn/whip-web-client'
import { WebRTCPlayer } from "@eyevinn/webrtc-player"
import LoggingOverlay from './components/logger'
import QRCode from 'qrcode'

let _firstLoad = true
const sid = new URLSearchParams(window.location.search).get('sid')
const STUN_SERVERS = [{ urls: 'stun:stun.cloudflare.com:3478' }]

function getVideoElement() {
  return window.document.querySelector<HTMLVideoElement>('#video')
}

function App() {
  const [session, setSession] = useState<string | null>()
  const [whipClient, setWHIPClient] = useState<WHIPClient | null>()
  const [whepPlayer, setWHEPPlayer] = useState<WebRTCPlayer | null>()
  const [qrVisible, setQrVisible] = useState(false)

  useEffect(() => {
    if (!_firstLoad) return
    _firstLoad = false
    if (sid?.length) {
      play()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Empty dependency array means this runs once on mount

  async function stop() {
    if (!whepPlayer)
      return

    whepPlayer.destroy()
    setWHEPPlayer(null)
    setSession(null)
  }

  async function play() {
    const video = getVideoElement()
    if (whepPlayer || !video)
      return

    const player = new WebRTCPlayer({
      debug: true,
      video: video,
      type: 'whep',
      statsTypeFilter: '^inbound-rtp',
      iceServers: STUN_SERVERS,
    })
    setWHEPPlayer(player)
    setSession(sid)

    const sourceUrl = new URL(window.location.href)
    sourceUrl.pathname = `api/sessions/${sid}`
    sourceUrl.search = ''
    await player.load(sourceUrl)

    player.on('no-media', () => {
      console.log('player media timeout occured')
      player.destroy()
      setWHEPPlayer(null)
      setSession(null)
    })
    video.controls = true
  }

  async function deleteSession() {
    const video = getVideoElement()
    if (video?.srcObject && whipClient) {
      const mediaStream = video.srcObject as MediaStream
      mediaStream.getTracks().forEach(track => track.stop())
      video.srcObject = null
      await whipClient.destroy()
      setWHIPClient(null)
      setSession(null)
    }
  }

  async function createSession() {
    const video = getVideoElement()
    if (!video)
      throw Error('video tag not found')

    const mediaStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: { deviceId: 'communications' },
    })
    video.srcObject = mediaStream
    const videoTrack = mediaStream.getVideoTracks().find(t => t.enabled)

    const client = new WHIPClient({
      endpoint: `${window.location.href}api/sessions`,
      opts: {
        debug: true,
        noTrickleIce: true,
        iceServers: STUN_SERVERS,
      },
      peerConnectionFactory: (config: RTCConfiguration) => {
        const peer = new RTCPeerConnection(config)
        peer.addEventListener('connectionstatechange', () => {
          if (peer.connectionState != 'connected' || !videoTrack) {
            return
          }
          console.log('peer senders', peer.getSenders())
          const sender = peer.getSenders().find(s => s.track?.id == videoTrack.id)
          if (sender) {
            console.log('set sender params')
            const params = sender.getParameters()
            params.encodings = [{
              maxBitrate: 1000000,
            }]
            sender.setParameters(params)
          } else {
            console.log('failed to get sender', peer)
          }
        })
        return peer
      }
    })
    await client.setIceServersFromEndpoint()
    await client.ingest(mediaStream)
    const resourceUrl = await client.getResourceUrl()
    const sid = resourceUrl.split('/').pop()
    setSession(sid)
    setWHIPClient(client)
  }

  async function checkFacingCamera() {
    const mediaDevices = await navigator.mediaDevices.enumerateDevices()
    mediaDevices.forEach(d => {
      console.log('device', d)
    })
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
            if (sid?.length) {
              // eslint-disable-next-line @typescript-eslint/no-unused-expressions
              whepPlayer ? stop() : play()
            } else {
              // eslint-disable-next-line @typescript-eslint/no-unused-expressions
              whipClient ? deleteSession() : createSession()
            }
          }}
        >
          {session ? 'stop' : 'start'}
        </button>
        <button className='control-bt'
          onClick={() => {
            if (!session?.length)
              return
            const shareUrl = new URL(window.location.href)
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
            checkFacingCamera()
          }}
        >
          Info
        </button>
      </div>
      <div className='media'>
        <video id='video' autoPlay muted></video>
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
      <LoggingOverlay />
    </>
  )
}

export default App
