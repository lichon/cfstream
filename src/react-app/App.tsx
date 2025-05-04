// src/App.tsx

import { useState, useEffect } from 'react'
import './App.css'

import { WHIPClient } from '@eyevinn/whip-web-client'
import { WebRTCPlayer } from "@eyevinn/webrtc-player"
import LoggingOverlay from './components/logger'
import QROverlay from './components/qr-overlay'
import { SignalPeer, SignalEvent } from './libs/signalpeer'
import {
  initDataChannel,
  getSessionInfo,
  getSessionUrl,
  getPlayerUrl,
  extractSessionIdFromUrl,
  STUN_SERVERS
} from './libs/api'

let _firstLoad = true
const sidParam = new URLSearchParams(window.location.search).get('sid')

function getVideoElement() {
  return window.document.querySelector<HTMLVideoElement>('#video')
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
  const [whepPlayer, setWHEPPlayer] = useState<WebRTCPlayer | null>()
  const [qrVisible, setQrVisible] = useState(false)
  const [showHoverMenu, setShowHoverMenu] = useState(false)
  const [signalPeer, setSignalPeer] = useState<SignalPeer | null>()
  const [playerSignalDc, setPlayerSignalDc] = useState<RTCDataChannel | null>()

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
      setPlayerSignalDc(null)
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
      setPlayerSignalDc(null)
    })
    player.load(new URL(getSessionUrl(sidParam))).then(() => {
      const playerObj = player as never
      const playerAdapter = playerObj['adapter'] as never
      const anyPeer = playerAdapter['localPeer'] as never
      const bootstrapDc = anyPeer['bootstrapDc'] as RTCDataChannel
      const peer = anyPeer as RTCPeerConnection

      function createSignalDc() {
        const resourceUrl = playerAdapter['resource'] as string
        const playerSid = extractSessionIdFromUrl(resourceUrl)
        if (!playerSid) return
        initDataChannel(playerSid, peer, null, 'signal').then(dc => {
          dc.onopen = () => {
            console.log('signalDc open')
          }
          setPlayerSignalDc(dc)
        })
      }

      function createBroadcastListener() {
        const resourceUrl = playerAdapter['resource'] as string
        const playerSid = extractSessionIdFromUrl(resourceUrl)
        if (!playerSid) return
        initDataChannel(playerSid, peer, sidParam).then(dc => {
          const kickedSid = new Set<string>()
          dc.onopen = () => {
            console.log('broadcast listener open')
          }
          dc.onmessage = async (ev) => {
            console.log('broadcast listener msg', ev.data as string)
            const event = JSON.parse(ev.data) as SignalEvent
            if (event.type == 'signalsession') {
              if (kickedSid.has(event.content)) return
              if (await SignalPeer.kick(event.content)) {
                kickedSid.add(event.content)
              }
            }
          }
        })
      }

      if (bootstrapDc.readyState == 'open') {
        createSignalDc()
        createBroadcastListener()
      } else {
        bootstrapDc.onopen = () => {
          console.log('player bootstarp open')
          createSignalDc()
          createBroadcastListener()
        }
      }
    })
  }

  function broadcastSignalSid(signalPeer: SignalPeer, broadcastDc: RTCDataChannel) {
    if (signalPeer.isConnected() && !signalPeer.isSubscriber()) {
      const signalSid = signalPeer.getSessionId()
      // console.log('broadcast signal', signalSid)
      broadcastDc.send(JSON.stringify({
        type: 'signalsession',
        content: signalSid,
      }))
      setTimeout(() => broadcastSignalSid(signalPeer, broadcastDc), 5000)
    }
  }

  function initSignalPeer(client: WHIPClient, broadcastDc: RTCDataChannel) {
    const signalPeer = new SignalPeer()
    signalPeer.onConnectionStateChanged(() => {
      if (signalPeer.isConnected()) {
        // new signal connected, broadcast self to subs
        broadcastSignalSid(signalPeer, broadcastDc)
      } else {
        // signal disconnected, connect signal to new sub
        client.getResourceUrl().then(resUrl => {
          const sid = resUrl.split('/').pop()
          return getSessionInfo(sid || '')
        }).then(info => {
          if (info?.subs?.length) {
            // TODO support multiple subs
            signalPeer.setRemoteSid(info.subs[0])
          }
          signalPeer.connect()
        })
      }
    })
    signalPeer.onClose(() => {
      // reset subs
      signalPeer.setRemoteSid()
      // sub dc closed, restart to brocasting mode
      signalPeer.connect()
    })
    signalPeer.onMessage((ev) => {
      console.log('recv subs msg', ev.data)
      if (broadcastDc && broadcastDc.readyState == 'open') {
        // TODO broadcast received msg to all subs
        broadcastDc.send(ev.data)
      }
    })
    setSignalPeer(signalPeer)
    signalPeer.connect()
  }

  function initBroadcastDc(client: WHIPClient, peer: RTCPeerConnection) {
    client.getResourceUrl().then(resUrl => {
      const sid = resUrl.split('/').pop()
      if (!sid) return
      initDataChannel(sid, peer).then(dc => {
        dc.onopen = () => {
          console.log('broadcastDc open')
          initSignalPeer(client, dc)
        }
      })
    })
  }

  function setVideoBitrate(peer: RTCPeerConnection, videoTrack?: MediaStreamTrack) {
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
  }

  async function getMediaStream(shareScreen?: boolean) {
    let ret
    if (shareScreen && navigator.mediaDevices.getDisplayMedia) {
      ret = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 60 },
        },
        audio: true,
      })
    } else {
      ret = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: { deviceId: 'communications' },
      })
    }
    return ret
  }

  async function stopStream() {
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
      setSignalPeer(null)
    }
  }

  async function startStream(shareScreen?: boolean) {
    const video = getVideoElement()
    if (!video)
      throw Error('video tag not found')

    const mediaStream = await getMediaStream(shareScreen) 
    const videoTrack = mediaStream.getVideoTracks().find(t => t.enabled)
    console.log(`video track ${videoTrack?.id} ${videoTrack?.kind} ${videoTrack?.label}`)

    const client = new WHIPClient({
      endpoint: getSessionUrl(),
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
          initBroadcastDc(client, peer)
          setVideoBitrate(peer, videoTrack)
        })
        return peer
      }
    })
    await client.setIceServersFromEndpoint()
    await client.ingest(mediaStream)
    video.srcObject = mediaStream
    const resourceUrl = await client.getResourceUrl()
    setSession(extractSessionIdFromUrl(resourceUrl))
    setWHIPClient(client)
  }

  return (
    <>
      <div id='control' className='control'>
        <div className='control-button-container'
          onMouseEnter={() => setShowHoverMenu(!sidParam?.length && !session)}
          onMouseLeave={() => setShowHoverMenu(false)}
        >
          <button className='control-bt'
            onClick={() => {
              if (session) {
                stopStream()
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
                onClick={() => startStream(false)}
                className='hover-menu-item'
              >
                Start with Camera
              </button>
              <button
                onClick={() => startStream(true)}
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
              if (playerSignalDc && playerSignalDc.readyState == 'open') {
                console.log('player dc send msg')
                playerSignalDc.send(JSON.stringify({ type: 'message', content: 'hello' }))
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
