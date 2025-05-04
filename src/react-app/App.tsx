// src/App.tsx

import { useState, useEffect } from 'react'
import './App.css'

import { WHIPClient } from '@eyevinn/whip-web-client'
import { WebRTCPlayer } from "@eyevinn/webrtc-player"
import LoggingOverlay from './components/logger'
import QROverlay from './components/qr-overlay'
import { ChatMessage, ChatOverlay } from './components/chat-overlay'
import { SignalPeer, SignalEvent } from './libs/signalpeer'
import { ChromeTTS } from './libs/tts'
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
const SYSTEM_LOG = 'System'
const STREAMER_LOG = 'Streamer'
const PLAYER_LOG = 'Player'
const CMD_LIST = new Set<string>(['/hide', '/log'])
const ttsPlayer = new ChromeTTS()

function getVideoElement() {
  return window.document.querySelector<HTMLVideoElement>('#video')
}

function App() {
  const [streamSession, setStreamSession] = useState<string | null>()
  const [playerSession, setPlayerSession] = useState<string | null>()
  const [whipClient, setWHIPClient] = useState<WHIPClient | null>()
  const [whepPlayer, setWHEPPlayer] = useState<WebRTCPlayer | null>()
  const [qrVisible, setQrVisible] = useState(false)
  const [logVisible, setLogVisible] = useState(false)
  const [chatVisible, setChatVisible] = useState(true)
  const [showHoverMenu, setShowHoverMenu] = useState(false)
  const [signalPeer, setSignalPeer] = useState<SignalPeer | null>()
  const [playerSignalDc, setPlayerSignalDc] = useState<RTCDataChannel | null>()
  const [broadcastDc, setBroadcastDc] = useState<RTCDataChannel | null>()
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])

  useEffect(() => {
    if (!_firstLoad) return
    _firstLoad = false
    SignalPeer.patchPeerConnection()
    play()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setChatVisible(true)
        setLogVisible(false)
        setQrVisible(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Empty dependency array means this runs once on mount

  function stop() {
    if (whepPlayer) {
      whepPlayer.destroy()
      setWHEPPlayer(null)
      setStreamSession(null)
      setPlayerSignalDc(null)
    }
  }

  async function play() {
    const video = getVideoElement()
    if (whepPlayer || !video || !sidParam?.length)
      return

    const player = new WebRTCPlayer({
      debug: false,
      video: video,
      type: 'whep',
      statsTypeFilter: '^inbound-rtp',
      iceServers: STUN_SERVERS,
    })
    setWHEPPlayer(player)
    setStreamSession(sidParam)

    player.on('no-media', () => {
      console.log(PLAYER_LOG, 'media timeout occured')
      player.destroy()
      setWHEPPlayer(null)
      setStreamSession(null)
      setPlayerSignalDc(null)
    })
    player.load(new URL(getSessionUrl(sidParam))).then(() => {
      const playerObj = player as never
      const playerAdapter = playerObj['adapter'] as never
      const anyPeer = playerAdapter['localPeer'] as never
      const bootstrapDc = anyPeer['bootstrapDc'] as RTCDataChannel
      const peer = anyPeer as RTCPeerConnection

      function getPlayerSession(): string {
        const resourceUrl = playerAdapter['resource'] as string
        const playerSid = extractSessionIdFromUrl(resourceUrl)
        setPlayerSession(playerSid)
        return playerSid!
      }

      function createSignalDc(playerSid: string) {
        initDataChannel(playerSid, peer, null, 'signal').then(dc => {
          dc.onopen = () => {
            console.log(PLAYER_LOG, 'signalDc open')
          }
          setPlayerSignalDc(dc)
        })
      }

      function createBroadcastListener(playerSid: string) {
        setPlayerSession(playerSid)
        initDataChannel(playerSid, peer, sidParam).then(dc => {
          const kickedSid = new Set<string>()
          dc.onopen = () => {
            console.log(PLAYER_LOG, 'broadcast listener open')
          }
          dc.onmessage = async (ev) => {
            console.log(PLAYER_LOG, 'recv msg', ev.data as string)
            const event = JSON.parse(ev.data) as SignalEvent
            if (event.type == 'signalsession') {
              const eventContent = event.content as string
              if (kickedSid.has(eventContent)) return
              if (await SignalPeer.kick(eventContent)) {
                kickedSid.add(eventContent)
              }
              return
            }
            if (event.type == 'chat') {
              addChatMessage(event.content as string, event.sender == playerSid ? 'You' : 'Owner')
            }
          }
        })
      }

      if (bootstrapDc.readyState == 'open') {
        console.log(PLAYER_LOG, 'bootstarp opened')
        const playerSid = getPlayerSession()
        createSignalDc(playerSid)
        createBroadcastListener(playerSid)
      } else {
        bootstrapDc.onopen = () => {
          console.log(PLAYER_LOG, 'bootstarp open')
          const playerSid = getPlayerSession()
          createSignalDc(playerSid)
          createBroadcastListener(playerSid)
        }
      }
    })
  }

  function broadcastSignalSid(signalPeer: SignalPeer, broadcastDc: RTCDataChannel) {
    if (signalPeer.isConnected() && !signalPeer.isSubscriber()) {
      const signalSid = signalPeer.getSessionId()
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
    signalPeer.onOpen(() => {
      if (signalPeer.isSubscriber())
        addChatMessage(`${signalPeer.getRemoteSid()} joined`)
    })
    signalPeer.onClose(() => {
      addChatMessage(`${signalPeer.getRemoteSid()} left`)
      // sub dc closed, restart to brocasting mode
      signalPeer.close(() => {
        setTimeout(() => { initSignalPeer(client, broadcastDc) })
      })
    })
    signalPeer.onMessage((ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'chat') {
        addChatMessage(msg.content, signalPeer.getRemoteSid())
        if (ttsPlayer.isSupported()) {
          ttsPlayer.speak(msg.content, { rate: 3 })
        }
        // broadcast to all subs
        broadcastDc.send(ev.data)
      }
    })
    setSignalPeer(signalPeer)
    signalPeer.connect()
  }

  function handleCmdFromChat(text: string): boolean {
    if (CMD_LIST.has(text)) {
      switch (text) {
        case '/hide':
          setChatVisible(false)
          break
        case '/log':
          setLogVisible(true)
          break
      }
      return true
    }
    return false
  }

  function sendChatMessage(text: string, sender?: string) {
    if (handleCmdFromChat(text)) {
      return
    }
    const msgObject = {
      type: 'chat',
      content: text,
      sender: sender,
    }
    if (playerSignalDc && playerSignalDc.readyState == 'open') {
      msgObject.sender = playerSession!
      playerSignalDc.send(JSON.stringify(msgObject))
      return
    }
    if (broadcastDc && broadcastDc.readyState == 'open') {
      msgObject.sender = sender ?? 'Owner'
      broadcastDc.send(JSON.stringify(msgObject))
      addChatMessage(text, sender ?? 'You')
      return
    }
  }

  function addChatMessage(text: string, sender?: string) {
    if (!text.length) return
    if (!sender) {
      console.log(SYSTEM_LOG, text)
    }
    setChatMessages(prev => [...prev, {
      text: text,
      timestamp: new Date().toISOString(),
      sender: sender ?? 'system'
    }])
  }

  function initBroadcastDc(client: WHIPClient, peer: RTCPeerConnection) {
    client.getResourceUrl().then(resUrl => {
      const sid = resUrl.split('/').pop()
      if (!sid) return
      initDataChannel(sid, peer).then(dc => {
        setBroadcastDc(dc)
        dc.onopen = () => {
          console.log(STREAMER_LOG, 'broadcastDc open')
          initSignalPeer(client, dc)
        }
      })
    })
  }

  function setVideoBitrate(peer: RTCPeerConnection, videoTrack?: MediaStreamTrack) {
    if (!videoTrack) {
      console.error(STREAMER_LOG, 'no video track')
      return
    }
    const sender = peer.getSenders().find(s => s.track?.id == videoTrack.id)
    if (sender) {
      console.log(STREAMER_LOG, 'set sender maxBitrate')
      const params = sender.getParameters()
      params.encodings = [{
        maxBitrate: 1000000,
      }]
      sender.setParameters(params)
    } else {
      console.log(STREAMER_LOG, 'failed to get sender', peer)
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
        setStreamSession(null)
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

    addChatMessage('getting media from user')
    const mediaStream = await getMediaStream(shareScreen) 
    const videoTrack = mediaStream.getVideoTracks().find(t => t.enabled)
    console.log(STREAMER_LOG, `video track ${videoTrack?.id} ${videoTrack?.kind} ${videoTrack?.label}`)

    const client = new WHIPClient({
      endpoint: getSessionUrl(),
      opts: {
        debug: false,
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
          addChatMessage('stream client connected')
        })
        return peer
      }
    })
    await client.setIceServersFromEndpoint()
    await client.ingest(mediaStream)
    video.srcObject = mediaStream
    const resourceUrl = await client.getResourceUrl()
    setStreamSession(extractSessionIdFromUrl(resourceUrl))
    setWHIPClient(client)
    addChatMessage('stream client starting')
  }

  return (
    <>
      <div id='control' className='control'>
        <div className='control-button-container'
          onMouseEnter={() => setShowHoverMenu(!sidParam?.length && !streamSession)}
          onMouseLeave={() => setShowHoverMenu(false)}
        >
          <button className='control-bt'
            onClick={() => {
              if (streamSession) {
                stopStream()
                stop()
              } else {
                // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                sidParam ? play() : setShowHoverMenu(!showHoverMenu)
              }
            }}
          >
            {streamSession ? 'Stop' : 'Start'}
          </button>
          {!streamSession && showHoverMenu && (
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
              if (!streamSession?.length)
                return

              const playerUrl = getPlayerUrl(streamSession)
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
              setLogVisible(!logVisible)
            }}
          >
            Logs
          </button>
        </div>
      </div>
      <div className='video-wrapper'>
        <video id='video' autoPlay muted></video>
      </div>

      <ChatOverlay
        show={chatVisible}
        messages={chatMessages}
        onSend={(text) => sendChatMessage(text)}
      />
      <QROverlay
        url={`${getPlayerUrl(streamSession)}`}
        show={qrVisible}
        onClose={() => setQrVisible(false)}
      />
      <LoggingOverlay show={logVisible}/>
    </>
  )
}

export default App
