// src/App.tsx

import { useState, useEffect } from 'react'
import './App.css'

import { WHIPClient } from '@eyevinn/whip-web-client'
import { WebRTCPlayer } from "@eyevinn/webrtc-player"
import LoggingOverlay from './components/logger'
import QROverlay from './components/qr-overlay'

let _firstLoad = true
const sid = new URLSearchParams(window.location.search).get('sid')
const STUN_SERVERS = [{ urls: 'stun:stun.cloudflare.com:3478' }]

function getVideoElement() {
  return window.document.querySelector<HTMLVideoElement>('#video')
}

function getSessionUrl(sid?: string | null) {
  return `${window.location.href}?sid=${sid}`
}

function App() {
  const [session, setSession] = useState<string | null>()
  const [whipClient, setWHIPClient] = useState<WHIPClient | null>()
  const [whepPlayer, setWHEPPlayer] = useState<WebRTCPlayer | null>()
  const [qrVisible, setQrVisible] = useState(false)
  const [showHoverMenu, setShowHoverMenu] = useState(false)

  useEffect(() => {
    if (!_firstLoad) return
    _firstLoad = false
    play()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Empty dependency array means this runs once on mount

  async function stop() {
    if (whepPlayer) {
      whepPlayer.destroy()
      setWHEPPlayer(null)
      setSession(null)
    }
  }

  function play() {
    const video = getVideoElement()
    if (whepPlayer || !video || !sid?.length)
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

    player.on('no-media', () => {
      console.log('player media timeout occured')
      player.destroy()
      setWHEPPlayer(null)
      setSession(null)
    })
    player.load(sourceUrl)
    video.controls = true
  }

  async function deleteSession() {
    if (whipClient) {
      try {
        await whipClient.destroy()
      } finally {
        setWHIPClient(null)
        setSession(null)
      }
    }
  }

  async function createSession(shareScreen?: boolean) {
    const video = getVideoElement()
    if (!video)
      throw Error('video tag not found')

    let mediaStream
    if (shareScreen && navigator.mediaDevices.getDisplayMedia) {
      mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 60 },
        },
        audio: true,
      })
    } else {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: { deviceId: 'communications' },
      })
    }
    video.srcObject = mediaStream
    const videoTrack = mediaStream.getVideoTracks().find(t => t.enabled)
    console.log(`video track ${videoTrack?.id} ${videoTrack?.kind} ${videoTrack?.label}`)

    const client = new WHIPClient({
      endpoint: `${window.location.href}api/sessions`,
      opts: {
        debug: true,
        noTrickleIce: true,
        iceServers: STUN_SERVERS,
      },
      peerConnectionFactory: (config: RTCConfiguration) => {
        const peer = new RTCPeerConnection(config)
        const dc = peer.createDataChannel('server-events')
        dc.onmessage = (ev) => {
          console.log('dc msg', ev)
        }
        dc.onopen = (ev) => {
          console.log('dc open', ev)
        }
        peer.addEventListener('connectionstatechange', () => {
          if (peer.connectionState != 'connected' || !videoTrack) {
            return
          }
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

  return (
    <>
      <div id='control' className='control'>
        <div className='control-button-container'
          onMouseEnter={() => setShowHoverMenu(!sid?.length && true)}
          onMouseLeave={() => setShowHoverMenu(false)}
        >
          <button className='control-bt'
            onClick={() => {
              if (session) {
                deleteSession()
                stop()
              } else {
                // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                sid ? play() : setShowHoverMenu(!showHoverMenu)
              }
            }}
          >
            {session ? 'Stop' : 'Start'}
          </button>
          {!session && showHoverMenu && (
            <div className='hover-menu'>
              <button
                onClick={() => createSession(false)}
                className='hover-menu-item'
              >
                Start with Camera
              </button>
              <button
                onClick={() => createSession(true)}
                className='hover-menu-item'
              >
                Start Screen Share
              </button>
            </div>
          )}
        </div>
        <div className='control-button-container' >
          <button className='control-bt'
            onClick={() => {
              if (!session?.length)
                return
              const shareUrl = new URL(window.location.href)
              shareUrl.searchParams.set('sid', session)
              const urlString = shareUrl.toString()

              navigator.clipboard.writeText(urlString)
              setQrVisible(true)
            }}
          >
            Copy view link
          </button>
        </div>
        <div className='control-button-container' >
          <button className='control-bt'
            onClick={async () => {
              await fetch(`${window.location.href}api/sessions/${session}`, {
                method: 'PATCH',
                body: JSON.stringify({
                  dataChannels: [{
                    sessionId: session,
                    location: 'local',
                    dataChannelName: 'server-event',
                  }]
                })
              })
              fetch(`${window.location.href}api/sessions/${session}`)
            }}
          >
            Info
          </button>
        </div>
      </div>
      <div className='video-wrapper'>
        <video id='video' autoPlay muted></video>
      </div>

      <QROverlay
        url={`${getSessionUrl(session)}`}
        show={qrVisible}
        onClose={() => setQrVisible(false)}
      />
      <LoggingOverlay />
    </>
  )
}

export default App
