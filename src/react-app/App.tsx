// src/App.tsx

import { useState, useEffect } from 'react'
import './App.css'

import { WHIPClient } from '@eyevinn/whip-web-client'
import { WebRTCPlayer } from "@eyevinn/webrtc-player"
import LoggingOverlay from './components/logger'
import QROverlay from './components/qr-overlay'
import SignalPeer from './libs/signalpeer'
import {
  initDataChannel,
  getSessionInfo,
  getSessionApiUrl,
  extractSessionIdFromUrl,
  STUN_SERVERS
} from './libs/api'

let _firstLoad = true
const sidParam = new URLSearchParams(window.location.search).get('sid')

function getVideoElement() {
  return window.document.querySelector<HTMLVideoElement>('#video')
}

function getPlayerUrl(sid?: string | null) {
  return `${window.location.href}?sid=${sid}`
}

const originalRTCPeerConnection = window.RTCPeerConnection
function patchPeerConnection() {
  // Create a new constructor function that wraps the original
  const patchedConstructor: typeof RTCPeerConnection = function(
    this: RTCPeerConnection,
    configuration?: RTCConfiguration
  ) {
    const peer = new originalRTCPeerConnection(configuration)
    const bootstrapDc = peer.createDataChannel('bootstrap')
    bootstrapDc.onmessage = (ev) => {
      console.log('bootstrap msg', ev)
    }
    bootstrapDc.onopen = () => {
      console.log('bootstrap open')
    }
    Object.defineProperty(peer, 'bootstrapDc', {
      enumerable: true,
      configurable: false,
      get: () => bootstrapDc,
      set: (_v) => { throw new Error('cannot set bootstrap dc')}
    })
    return peer
  } as never

  // Copy over the prototype and static methods
  patchedConstructor.prototype = originalRTCPeerConnection.prototype
  patchedConstructor.generateCertificate = originalRTCPeerConnection.generateCertificate

  // Replace the global RTCPeerConnection
  window.RTCPeerConnection = patchedConstructor;
}

function App() {
  const [session, setSession] = useState<string | null>()
  const [whipClient, setWHIPClient] = useState<WHIPClient | null>()
  const [whipDc, setWHIPDc] = useState<RTCDataChannel | null>()
  const [whepPlayer, setWHEPPlayer] = useState<WebRTCPlayer | null>()
  const [qrVisible, setQrVisible] = useState(false)
  const [showHoverMenu, setShowHoverMenu] = useState(false)
  const [signalPeer, setSignalPeer] = useState<SignalPeer | null>()

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
    if (whepPlayer || !video || !sidParam?.length)
      return

    const player = new WebRTCPlayer({
      debug: true,
      video: video,
      type: 'whep',
      statsTypeFilter: '^inbound-rtp',
      iceServers: STUN_SERVERS,
    })
    setWHEPPlayer(player)
    setSession(sidParam)

    player.on('no-media', () => {
      console.log('player media timeout occured')
      player.destroy()
      setWHEPPlayer(null)
      setSession(null)
    })
    player.load(new URL(getSessionApiUrl(sidParam))).then(() => {
      const playerObj = player as never
      const playerAdapter = playerObj['adapter'] as never
      const anyPeer = playerAdapter['localPeer'] as never
      const bootstrapDc = anyPeer['bootstrapDc'] as RTCDataChannel
      const peer = anyPeer as RTCPeerConnection

      function createWhipListener() {
        const resourceUrl = playerAdapter['resource'] as string
        const playerSid = extractSessionIdFromUrl(resourceUrl)
        console.log('player sid', playerSid)
        if (!playerSid) return
        initDataChannel(playerSid, peer, sidParam).then(dc => {
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

  function broadcastSignalSid(signalPeer: SignalPeer, broadcastDc: RTCDataChannel) {
    if (signalPeer.isConnected()) {
      const signalSid = signalPeer.getSessionId()
      console.log('broadcast signal sid', signalSid)
      broadcastDc.send(JSON.stringify({
        type: 'signal',
        sessionId: signalSid
      }))
      setTimeout(() => broadcastSignalSid(signalPeer, broadcastDc), 5000)
    }
  }

  function initSignalPeer(
    clientPeer: RTCPeerConnection,
    clientSession: string,
    clientBroadcastDc: RTCDataChannel
  ) {
    const signalPeer = new SignalPeer()
    setSignalPeer(signalPeer)

    signalPeer.onConnectionStateChanged(() => {
      if (!signalPeer.isConnected()) {
        // TODO create new connection
      }
    })
    signalPeer.onOpen(() => {
      const signalSession = signalPeer.getSessionId() as string
      if (!signalSession) return
      broadcastSignalSid(signalPeer, clientBroadcastDc)

      setTimeout(() => {
        new SignalPeer().kick(signalSession)
      }, 10000)

      // initDataChannel(clientSession, clientPeer, signalSession, 'signal').then(clientSignalDc => {
      //   clientSignalDc.onclose = () => {
      //     console.log('client signalDc close')
      //   }
      //   clientSignalDc.onopen = () => {
      //     console.log('client signalDc open')
      //     signalPeer.switchSignalDc()
      //   }
      //   clientSignalDc.onmessage = (ev) => {
      //     console.log('client signalDc msg', ev)
      //   }
      // })
    })
    signalPeer.onClose(() => {
    })
    signalPeer.onMessage((_msg: unknown) => {
    })
    signalPeer.connect()
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
    if (signalPeer) {
      signalPeer.close()
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
      endpoint: getSessionApiUrl(),
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
              setWHIPDc(dc)
              dc.onopen = () => {
                console.log('whipDc open')
              }
              initSignalPeer(peer, sid, dc)
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
    setSession(extractSessionIdFromUrl(resourceUrl))
    setWHIPClient(client)
  }

  return (
    <>
      <div id='control' className='control'>
        <div className='control-button-container'
          onMouseEnter={() => setShowHoverMenu(!sidParam?.length && true)}
          onMouseLeave={() => setShowHoverMenu(false)}
        >
          <button className='control-bt'
            onClick={() => {
              if (session) {
                deleteSession()
                stop()
              } else {
                // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                sidParam ? play() : setShowHoverMenu(!showHoverMenu)
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

              const playerUrl = getPlayerUrl(session)
              navigator.clipboard.writeText(playerUrl)
              if (import.meta.env.DEV) {
                window.open(playerUrl, '_blank')
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
              getSessionInfo(session!)
              if (whipDc && whipDc.readyState == 'open') {
                console.log('dc send msg')
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
        url={`${getPlayerUrl(session)}`}
        show={qrVisible}
        onClose={() => setQrVisible(false)}
      />
      <LoggingOverlay />
    </>
  )
}

export default App
