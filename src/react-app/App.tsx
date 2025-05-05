// src/App.tsx

import { useState, useEffect } from 'react'
import './App.css'

import { getConfig } from './config'

import { WHIPClient } from '@eyevinn/whip-web-client'
import { WebRTCPlayer } from "@eyevinn/webrtc-player"
import LoggingOverlay from './components/logger'
import QROverlay from './components/qr-overlay'
import { ChatMessage, ChatOverlay } from './components/chat-overlay'
import { SignalPeer, SignalMessage, SignalEvent } from './libs/signalpeer'
import { ChromeTTS } from './libs/tts'
import {
  initDataChannel,
  getSessionInfo,
  getSessionUrl,
  getPlayerUrl,
  extractSessionIdFromUrl,
} from './libs/api'

let _firstLoad = true
const sidParam = new URLSearchParams(window.location.search).get('sid')
const SYSTEM_LOG = 'System'
const STREAMER_LOG = 'Streamer'
const PLAYER_LOG = 'Player'
const ttsPlayer = new ChromeTTS()

const chatCmdList = getConfig().ui.cmdList
const broadcastInterval = getConfig().stream.broadcastInterval
const jitterBufferTarget = getConfig().stream.jitterBufferTarget
const videoMaxBitrate = getConfig().stream.videoBitrate
const maxHistoryMessage = getConfig().ui.maxHistoryMessage
const openLinkOnShare = getConfig().ui.openLinkOnShare
const stunServers = getConfig().api.stunServers
const isMoblie = getConfig().ui.isMobilePlatform
const ownerDisplayName = getConfig().ui.streamOwnerDisplayName
const selfDisplayName = getConfig().ui.selfDisplayName

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
  const [isFrontCamera, setIsFrontCamera] = useState(true);
  const [isScreenShare, setScreenShare] = useState(true);
  const [ttsEnabled, enableTTS] = useState(true);

  useEffect(() => {
    if (!_firstLoad) return
    _firstLoad = false
    SignalPeer.patchPeerConnection()
    help()
    play()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setChatVisible(false)
        setLogVisible(false)
        setQrVisible(false)
      } else if (event.key === 'Enter') {
        setChatVisible(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Empty dependency array means this runs once on mount

  function help() {
    addChatMessage('type /? for help')
  }

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

    enableTTS(false)
    const player = new WebRTCPlayer({
      debug: false,
      video: video,
      type: 'whep',
      statsTypeFilter: '^inbound-rtp',
      iceServers: stunServers,
    })
    setWHEPPlayer(player)
    setStreamSession(sidParam)

    addChatMessage(`player loading ${sidParam}`)
    player.on('no-media', () => {
      addChatMessage('media timeout')
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

      const kickedSid = new Set<string>()
      async function handleSignalEvent(event: SignalMessage, selfSid: string) {
        const signalEvent = event.content as SignalEvent
        if (signalEvent.status == 'waiting') {
          if (kickedSid.has(signalEvent.sid)) return
          if (await SignalPeer.kick(signalEvent.sid)) {
            addChatMessage(`signal waiting`)
            kickedSid.add(signalEvent.sid)
          }
        } else if (signalEvent.status == 'connected') {
          if (selfSid === signalEvent.sid) {
            addChatMessage(`signal connected`)
          }
        }
      }

      function getPlayerSession(): string {
        const resourceUrl = playerAdapter['resource'] as string
        const playerSid = extractSessionIdFromUrl(resourceUrl)
        setPlayerSession(playerSid)
        addChatMessage(`player connected ${playerSid}`)
        return playerSid!
      }

      function createSignalDc(playerSid: string) {
        initDataChannel(playerSid, peer, null, SignalPeer.label).then(dc => {
          dc.onopen = () => {
            console.log(PLAYER_LOG, 'signalDc open')
          }
          setPlayerSignalDc(dc)
        })
      }

      function createBroadcastListener(playerSid: string) {
        setPlayerSession(playerSid)
        initDataChannel(playerSid, peer, sidParam).then(dc => {
          dc.onopen = () => {
            console.log(PLAYER_LOG, 'broadcast listener open')
          }
          dc.onmessage = async (ev) => {
            console.log(PLAYER_LOG, 'recv msg', ev.data as string)
            const event = JSON.parse(ev.data) as SignalMessage
            if (event.type == 'signal') {
              handleSignalEvent(event, playerSid)
            } else if (event.type == 'chat') {
              addChatMessage(event.content as string, event.sender == playerSid ? selfDisplayName : event.sender)
            }
          }
        })
      }

      function jitterBufferConfig() {
        // set all receiver with the same buffer
        peer.getReceivers().forEach(r => {
          r.jitterBufferTarget = jitterBufferTarget
        })
      }

      bootstrapDc.onopen = () => {
        console.log(PLAYER_LOG, 'bootstarp open')
        const playerSid = getPlayerSession()
        jitterBufferConfig()
        createSignalDc(playerSid)
        createBroadcastListener(playerSid)
      }
    })
  }

  function broadcastSignalSid(signalPeer: SignalPeer, broadcastDc: RTCDataChannel) {
    if (signalPeer.isConnected() && broadcastDc.readyState == 'open') {
      const sid = signalPeer.getSessionId()
      broadcastDc.send(JSON.stringify(SignalPeer.newSignalEvent('waiting', sid!)))
      setTimeout(() => broadcastSignalSid(signalPeer, broadcastDc), broadcastInterval)
    }
  }

  function initSignalPeer(client: WHIPClient, broadcastDc: RTCDataChannel) {
    const signalPeer = new SignalPeer()
    signalPeer.onBootstrapReady(() => {
      // bootstrap connected, broadcast self to subs
      broadcastSignalSid(signalPeer, broadcastDc)
    })
    signalPeer.onBootstrapKicked(() => {
      // bootstrap kicked, connect signal to new sub
      client.getResourceUrl().then(resUrl => {
        const sid = resUrl.split('/').pop()
        return getSessionInfo(sid || '')
      }).then(info => {
        info.subs.forEach(sid => signalPeer.newSignalDc(sid))
        signalPeer.clearInvalidDc(info.subs)
      })
    })
    signalPeer.onOpen((sid: string) => {
      addChatMessage(`${sid} joined`)
      broadcastDc.send(JSON.stringify(SignalPeer.newSignalEvent('connected', sid)))
    })
    signalPeer.onClose((sid: string) => {
      addChatMessage(`${sid} left`)
      broadcastDc.send(JSON.stringify(SignalPeer.newSignalEvent('disconnected', sid)))
    })
    signalPeer.onMessage((sid: string, ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'chat') {
        addChatMessage(msg.content, sid)
        // broadcast to all subs
        broadcastDc.send(ev.data)
      }
      // TODO supoprt rpc
    })
    setSignalPeer(signalPeer)
    signalPeer.start()
  }

  function handleCmdFromChat(text: string): boolean {
    if (chatCmdList.has(text)) {
      const v = getVideoElement()!
      switch (text) {
        case '/?':
          addChatMessage(`TODO add help tips`)
          break
        case '/c':
        case '/clear':
          setChatMessages([])
          break
        case '/h':
        case '/hide':
          setChatVisible(false)
          break
        case '/l':
        case '/log':
          setLogVisible(true)
          break
        case '/m':
        case '/mute':
          v.muted = true
          addChatMessage(`video muted`)
          break
        case '/u':
        case '/unmute':
          v.muted = false
          addChatMessage(`video unmuted`)
          break
        case '/vu':
        case '/volumeUp':
          if (v.volume <= 0.9)
            v.volume = v.volume + 0.1
          addChatMessage(`video volume is ${v.volume * 100}`)
          break
        case '/vd':
        case '/volumeDown':
          if (v.volume >= 0.1)
            v.volume = v.volume - 0.1
          addChatMessage(`video volume is ${v.volume * 100}`)
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
    const msgObject = SignalPeer.newChatMsg(text, sender)
    if (playerSignalDc && playerSignalDc.readyState == 'open') {
      msgObject.sender = playerSession!
      playerSignalDc.send(JSON.stringify(msgObject))
      return
    }
    if (broadcastDc && broadcastDc.readyState == 'open') {
      msgObject.sender = sender ?? ownerDisplayName
      broadcastDc.send(JSON.stringify(msgObject))
      addChatMessage(text, sender ?? selfDisplayName)
      return
    }
  }

  function addChatMessage(text: string, sender?: string) {
    if (!text.length) return
    if (!sender) {
      console.log(SYSTEM_LOG, text)
    } else {
      const isSelfMsg = sender == selfDisplayName
      if (ttsEnabled && !isSelfMsg && ttsPlayer.isSupported()) {
        ttsPlayer.speak(text, { rate: 3 })
      }
    }
    setChatMessages(prev => {
      const msgs = [...prev, {
        text: text,
        timestamp: new Date().toISOString(),
        sender: sender ?? SYSTEM_LOG
      }]
      return msgs.slice(-maxHistoryMessage)
    })
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
        maxBitrate: videoMaxBitrate,
      }]
      sender.setParameters(params)
    } else {
      console.log(STREAMER_LOG, 'failed to get sender', peer)
    }
  }

  async function switchMedia() {
    const video = getVideoElement()
    if (!video || !whipClient) return

    const newFacingMode = isFrontCamera ? 'environment' : 'user'
    setIsFrontCamera(!isFrontCamera)
    setScreenShare(!isScreenShare)

    // Get new media stream with switched camera
    const newStream = await getMediaStream(!isScreenShare, newFacingMode)

    // Replace video track
    const oldStream = video.srcObject as MediaStream
    const oldTrack = oldStream.getVideoTracks()[0]
    const newTrack = newStream.getVideoTracks()[0]
    newStream.getTracks().forEach(t => {
      if (t !== newTrack) t.stop()
    })

    const anyClient = whipClient as never
    const peer = anyClient['peer'] as RTCPeerConnection
    // Replace track in peer connection
    const sender = peer.getSenders().find(
      s => s.track?.id === oldTrack.id
    )
    if (sender) {
      await sender.replaceTrack(newTrack)
    }

    // Replace track in video element
    oldTrack.stop()
    oldStream.removeTrack(oldTrack)
    oldStream.addTrack(newTrack)
  }

  async function getMediaStream(shareScreen?: boolean, facingMode?: string) {
    let ret
    if (shareScreen && navigator.mediaDevices.getDisplayMedia) {
      setScreenShare(true)
      ret = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 60 },
        },
        audio: true,
      })
    } else {
      setScreenShare(false)
      ret = await navigator.mediaDevices.getUserMedia({
        video: {
          frameRate: { ideal: 30 },
          facingMode: facingMode || 'environment'
        },
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
      addChatMessage('stream client closed')
    }
    if (signalPeer) {
      signalPeer.close()
      setSignalPeer(null)
    }
  }

  async function startStream(shareScreen?: boolean) {
    setShowHoverMenu(false)
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
        iceServers: stunServers,
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
    addChatMessage('stream client starting')
    await client.setIceServersFromEndpoint()
    await client.ingest(mediaStream)
    video.srcObject = mediaStream
    const resourceUrl = await client.getResourceUrl()
    setStreamSession(extractSessionIdFromUrl(resourceUrl))
    setWHIPClient(client)
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
              if (openLinkOnShare) {
                window.open(playerUrl, '_blank')
              }
              setQrVisible(true)
              navigator.clipboard?.writeText(playerUrl)
            }}
          >
            Player link
          </button>
        </div>
        <div className='control-button-container' >
          <button className='control-bt'
            onClick={() => { switchMedia() }}
          >
            Switch Camera
          </button>
        </div>
      </div>

      <div className='video-wrapper'>
        <video id='video' autoPlay muted
          // Add reference for Safari PiP API
          ref={(video) => {
            if (video && isMoblie) {
              video.disablePictureInPicture = false
              video.playsInline = true
            }
          }}
          onClick={(ev) => {
            setLogVisible(false)
            if (!isMoblie) return
            const video = ev.target as HTMLVideoElement
            if (video.paused) {
              video.requestPictureInPicture()
              video.play()
            } else {
              video.pause()
            }
          }}
          onDoubleClick={(ev) => {
            const video = ev.target as HTMLVideoElement
            if (!document.fullscreenElement) {
              video.requestFullscreen()
            } else {
              document.exitFullscreen()
            }
          }}
        >
        </video>
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
      <LoggingOverlay show={logVisible} />
    </>
  )
}

export default App
