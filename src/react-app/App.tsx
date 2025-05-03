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

function getSessionApi(sid?: string | null) {
  const hostUrl = new URL(window.location.href)
  hostUrl.pathname = sid ? `api/sessions/${sid}` : 'api/sessions'
  hostUrl.search = ''
  return hostUrl.toString()
}

let whipDc: RTCDataChannel
let bootstrapDc: RTCDataChannel
let peer: RTCPeerConnection
const originalRTCPeerConnection = window.RTCPeerConnection
function patchPeerConnection() {
  // Create a new constructor function that wraps the original
  const patchedConstructor: typeof RTCPeerConnection = function(
    this: RTCPeerConnection,
    configuration?: RTCConfiguration
  ) {
    peer = new originalRTCPeerConnection(configuration)
    bootstrapDc = peer.createDataChannel('bootstrap')
    bootstrapDc.onmessage = (ev) => {
      console.log('bootstrap msg', ev)
    }
    bootstrapDc.onopen = () => {
      console.log('bootstrap open')
    }
    return peer
  } as never

  // Copy over the prototype and static methods
  patchedConstructor.prototype = originalRTCPeerConnection.prototype
  patchedConstructor.generateCertificate = originalRTCPeerConnection.generateCertificate

  // Replace the global RTCPeerConnection
  window.RTCPeerConnection = patchedConstructor;
}

async function initDataChannel(
  sid: string,
  peer: RTCPeerConnection,
  remoteSid?: string | null,
): Promise<RTCDataChannel> {
  const dcRes = await fetch(getSessionApi(sid), {
    method: 'PATCH',
    body: JSON.stringify({
      dataChannels: [{
        sessionId: remoteSid ?? sid,
        location: remoteSid ? 'remote' : 'local',
        dataChannelName: 'whip',
      }]
    })
  }).then(res => res.json())
  const dc = peer.createDataChannel('whip', {
    negotiated: true,
    id: dcRes.dataChannels[0].id
  })
  return dc
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
    patchPeerConnection()
    play()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Empty dependency array means this runs once on mount

  function stop() {
    if (whepPlayer) {
      whepPlayer.destroy()
      setWHEPPlayer(null)
      setSession(null)
    }
  }

  async function play() {
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

    player.on('no-media', () => {
      console.log('player media timeout occured')
      player.destroy()
      setWHEPPlayer(null)
      setSession(null)
    })
    player.load(new URL(getSessionApi(sid))).then(() => {
      if (!bootstrapDc || !peer)
        return

      function createWhipListener() {
        const playerObj = player as never
        const playerAdapter = playerObj['adapter'] as never
        const resourceUlr = playerAdapter['resource'] as string
        const playerSid = resourceUlr.split('/').pop()
        console.log('player sid', playerSid)
        if (!playerSid) return
        initDataChannel(playerSid, peer, sid).then(dc => {
          dc.onopen = () => {
            console.log('whip listener open')
          }
          dc.onmessage = (ev) => {
            console.log('whip listener msg', ev.data as string)
          }
        })
      }

      if (bootstrapDc.readyState == 'open') {
        createWhipListener()
      } else {
        bootstrapDc.onopen = () => {
          console.log('bootstarp open 2')
          createWhipListener()
        }
      }
    })
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
      endpoint: getSessionApi(),
      opts: {
        debug: true,
        noTrickleIce: true,
        iceServers: STUN_SERVERS,
      },
      peerConnectionFactory: (config: RTCConfiguration) => {
        const peer = new RTCPeerConnection(config)
        peer.addEventListener('connectionstatechange', () => {
          if (peer.connectionState != 'connected')
            return
          client.getResourceUrl().then(resUrl => {
            const sid = resUrl.split('/').pop()
            if (!sid) return
            initDataChannel(sid, peer).then(dc => {
              dc.onopen = () => {
                whipDc = dc
                console.log('whip dc open')
              }
            })
          })

          if (!videoTrack) {
            console.log('no video track')
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

              navigator.clipboard.writeText(getSessionUrl(session))
              if (import.meta.env.DEV) {
                window.open(getSessionUrl(session), '_blank')
              } else {
                setQrVisible(true)
              }
            }}
          >
            Copy view link
          </button>
        </div>
        <div className='control-button-container' >
          <button className='control-bt'
            onClick={async () => {
              fetch(getSessionApi(session))
              if (whipDc) {
                console.log('whip dc send msg')
                whipDc.send('hello 123')
              }
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
