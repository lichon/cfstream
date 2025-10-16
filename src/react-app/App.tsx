// src/App.tsx

import { useRef, useMemo, useState, useEffect } from 'react'

import { getConfig } from './config'
import { useWakeLock } from './hooks/use-wakelock'
import { useSupabaseChannel } from './hooks/use-supabase'

import StreamVideo from './components/stream-video'
import LoggingOverlay from './components/logger'
import QROverlay from './components/qr-overlay'
import { ControlBar, ControlBarButton } from './components/control-bar'
import { ChatMessage, ChatOverlay } from './components/chat-overlay'
import { AvatarStack } from './components/avatar-stack'
import { patchRTCPeerConnection, SignalPeer } from './lib/signalpeer'
import { ChromeTTS } from './lib/tts'
import { WHEPPlayer } from './lib/player'
import { WHIPStreamer } from './lib/streamer'
import { getPlayerUrl } from './lib/api'

const urlParams = new URLSearchParams(window.location.search)
const sidParam = urlParams.get('s') || undefined
const roomParam = urlParams.get('r') || undefined
const hideMsg = urlParams.get('hidemsg') || undefined
const p2pMode = roomParam || urlParams.get('p2p')
const isPlayer = window.location.pathname.startsWith('/watch')
const SYSTEM_LOG = 'System'

const chatCmdList = getConfig().ui.cmdList
const maxHistoryMessage = getConfig().ui.maxHistoryMessage
const openLinkOnShare = getConfig().ui.openLinkOnShare
const isMobile = getConfig().ui.isMobilePlatform
const ownerDisplayName = getConfig().ui.streamOwnerDisplayName
const selfDisplayName = getConfig().ui.selfDisplayName
const STUN_SERVERS = getConfig().api.stunServers
let ttsEnabled = getConfig().ui.ttsEnabled && ChromeTTS.isSupported()
let debugEnabled = getConfig().debug
let _firstLoad = true

function App() {
  const ttsPlayer = useMemo(() => new ChromeTTS(), [])
  const videoRef = useRef<HTMLVideoElement>(null)
  const [activeSessionId, setActiveSessionId] = useState<string>()
  const [streamer, setStreamer] = useState<WHIPStreamer>()
  const [player, setPlayer] = useState<WHEPPlayer>()
  const [qrVisible, setQrVisible] = useState(false)
  const [logVisible, setLogVisible] = useState(false)
  const [chatVisible, setChatVisible] = useState(true)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [isFrontCamera, setIsFrontCamera] = useState(true)
  const [isScreenShare, setScreenShare] = useState(false)
  const [copied, setCopied] = useState(false)
  const [_, forceUpdate] = useState(0)

  const { request: requestWakeLock, release: releaseWakeLock } = useWakeLock()
  const {
    sendChannelMessage,
    sendChannelRequest,
    isChannelConnected,
    onlineMembers
  } = useSupabaseChannel({
    roomName: roomParam ?? '',
    onChatMessage: (msg) => {
      addChatMessage(msg.content as string, msg.sender)
    },
    onChannelRequest: async (req) => {
      if (req.method !== 'connect')
        return
      return await connectRequestHandler(req.body)
    },
    onChannelEvent: (msg) => {
      if (typeof msg.content === 'string') {
        addChatMessage(msg.content)
      }
    }
  })

  useEffect(() => {
    if (_firstLoad) {
      _firstLoad = false
      firstLoad()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setChatVisible(false)
        setLogVisible(false)
        setQrVisible(false)
        return
      }
      if (event.target !== document.body) return
      if (event.key === 'Enter') {
        setChatVisible(true)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isChannelConnected && isPlayer) {
      patchRTCPeerConnection()
      startPlayer()
    }
  }, [isChannelConnected]) // eslint-disable-line react-hooks/exhaustive-deps

  function firstLoad() {
    addChatMessage('type /? for help')
  }

  async function connectRequestHandler(params: unknown) {
    const mediaStream = videoRef.current?.srcObject as MediaStream | null
    if (isPlayer || !mediaStream) {
      // TODO support player to player p2p?
      return
    }
    console.log('handle p2p request', params)
    const { offer, ice } = params as { offer: string, ice: RTCIceCandidateInit[] }
    if (!offer?.length) {
      return
    }
    const peer = new RTCPeerConnection({ iceServers: STUN_SERVERS })
    peer.addTrack(mediaStream.getAudioTracks()[0])
    peer.addTrack(mediaStream.getVideoTracks()[0])
    peer.onconnectionstatechange = (() => {
      console.log('p2p peer', peer.connectionState)
      // TODO set bit rate based on connection quality
      if (peer.connectionState === 'failed') {
        peer.onicecandidate = null
        peer.close()
      }
    })
    await peer.setRemoteDescription({ sdp: offer, type: 'offer' })
    const setLocalPromise = peer.setLocalDescription(await peer.createAnswer())
    // ice candidates gathering after setLocalDescription
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 1000)
    })
    await setLocalPromise

    // start connection after remote peer send stun request
    setTimeout(() => {
      ice.map(candidate => peer.addIceCandidate(candidate))
    }, 500)
    return { answer: peer.localDescription?.sdp, ice: [] }
  }

  function stopPlayer() {
    player?.stop()
    setPlayer(undefined)
  }

  async function startPlayer() {
    if (player)
      return

    if (!roomParam?.length && !sidParam?.length) {
      return
    }

    let lastPeer: RTCPeerConnection | null = null
    const whep = new WHEPPlayer({
      videoElement: videoRef.current!,
      p2pConnect: async (peer) => {
        const video = videoRef.current!
        const stream = video.srcObject as MediaStream | null
        if (stream) {
          stream.getTracks().forEach(t => t.stop())
          video.srcObject = null
        }
        console.log('start p2p connect')
        const newStream = new MediaStream()
        peer.ontrack = (event) => {
          if (!event.track) {
            return
          }
          newStream.addTrack(event.track)
          if (!video.srcObject) {
            video.srcObject = newStream
          }
        }
        // prepare offer
        peer.addTransceiver('video', { direction: 'recvonly' })
        peer.addTransceiver('audio', { direction: 'recvonly' })
        const candidates: RTCIceCandidateInit[] = []
        peer.onicecandidate = (event) => {
          if (event.candidate && event.candidate.protocol === 'udp') {
            candidates.push(event.candidate.toJSON())
          }
        }
        const offer = await peer.createOffer()
        const setLocalPromise = peer.setLocalDescription(offer)
        // ice candidates gathering after setLocalDescription
        await new Promise<void>((resolve) => {
          setTimeout(() => resolve(), 1000)
        })
        await setLocalPromise

        // use offer without ice candidates at first time, make sure local start stun request
        // after first try, use full offer with ice candidates, make sure remote start stun first
        const res = await sendChannelRequest({
          method: 'connect',
          body: {
            offer: lastPeer == null ? offer.sdp : peer.localDescription?.sdp,
            ice: candidates
          }
        })
        lastPeer = peer
        if (res.error) {
          addChatMessage(`connect error: ${res.error}`)
          stopPlayer()
          return
        }
        const { answer, ice } = res.body as {
          answer: string, ice: RTCIceCandidateInit[]
        }
        if (!answer?.length) {
          addChatMessage('connect error: no answer')
          stopPlayer()
          return
        }
        await peer.setRemoteDescription({ sdp: answer, type: 'answer' })
        await Promise.all(ice.map(candidate => peer.addIceCandidate(candidate)))
      },
      onChatMessage: (msg, from) => {
        addChatMessage(msg, from)
      },
      onOpen: (sid?: string) => {
        forceUpdate(n => n + 1)
        requestWakeLock()
        setActiveSessionId(sid)
      },
      onClose: () => {
        releaseWakeLock()
        setPlayer(undefined)
        setActiveSessionId(undefined)
      },
    })
    await whep.start(sidParam, p2pMode ? '' : roomParam)
    setPlayer(whep)
  }

  async function handleCmd(text: string) {
    const v = videoRef.current!
    switch (text) {
      case '/?':
        addChatMessage(`TODO add help tips`)
        break
      case '/debug':
        debugEnabled = !debugEnabled
        setLogVisible(debugEnabled)
        SignalPeer.enableDebug(debugEnabled)
        WHEPPlayer.enableDebug(debugEnabled)
        WHIPStreamer.enableDebug(debugEnabled)
        addChatMessage(`debug enabled ${debugEnabled}`)
        break
      case '/t':
      case '/test':
        break
      case '/buffer':
        // TODO config player buffer
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
        v.muted = !v.muted
        addChatMessage(`video muted ${v.muted}`)
        break
      case '/f':
      case '/fullscreen':
        v.requestFullscreen()
        break
      case '/pip':
        v.requestPictureInPicture()
        break
      case '/tts':
        if (!ChromeTTS.isSupported()) {
          addChatMessage('TTS not supported')
          break
        }
        ttsEnabled = !ttsEnabled
        addChatMessage(`TTS enabled ${ttsEnabled}`)
        break
      case '/input':
        ttsPlayer.pipInput(false, onTextSubmit)
        break
      case '/rinput':
        // request display sound, and redirect to certain audio device
        if (ttsEnabled) ttsPlayer.pipInput(true)
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
  }

  function onTextSubmit(text: string) {
    if (chatCmdList.has(text)) {
      handleCmd(text)
      return
    }
    sendChannelMessage(text)
  }

  // @ts-expect-error keep
  function _sendDcMessage(text: string) {
    const msgObject = SignalPeer.newChatMsg(text)
    const playerDc = player?.getPlayerDc()
    if (playerDc) {
      msgObject.sender = player?.getPlayerSid()
      SignalPeer.send(playerDc, msgObject)
      return
    }
    const streamerDc = streamer?.getStreamerDc()
    if (streamerDc) {
      msgObject.sender = ownerDisplayName
      SignalPeer.send(streamerDc, msgObject, () => {
        addChatMessage(text, selfDisplayName)
      })
      return
    }
  }

  function addChatMessage(text: string, sender?: string) {
    if (!text.length) return
    if (!sender) {
      console.log(SYSTEM_LOG, text)
    } else {
      const isSelfMsg = sender == selfDisplayName
      if (ttsEnabled && !isSelfMsg) {
        ttsPlayer.speak(text)
      }
      if (hideMsg) {
        console.log(sender, text)
        return
      }
    }
    setChatMessages(prev => {
      const msgs = [...prev, {
        content: text,
        timestamp: new Date().toISOString(),
        sender: sender ?? SYSTEM_LOG
      }]
      return msgs.slice(-maxHistoryMessage)
    })
  }

  async function switchMedia() {
    if (isPlayer) {
      handleCmd('/mute')
      return
    }
    // TODO support p2p mode
    setIsFrontCamera(!isFrontCamera)
    setScreenShare(!isScreenShare)
    streamer?.switchMedia(!isScreenShare, !isFrontCamera)
  }

  function startMediaStream(mediaStream: MediaStream) {
    videoRef.current!.srcObject = mediaStream
    forceUpdate(n => n + 1)
  }

  function stopMediaStream() {
    const video = videoRef.current
    if (video?.srcObject) {
      (video.srcObject as MediaStream).getTracks().forEach(track => track.stop())
      video.srcObject = null
      forceUpdate(n => n + 1)
    }
  }

  async function stopStream() {
    if (streamer) {
      try {
        await streamer.stop()
      } finally {
        setStreamer(undefined)
        setActiveSessionId(undefined)
      }
    }
  }

  async function startStreamer(shareScreen?: boolean) {
    setScreenShare(shareScreen ?? false)
    let mediaStream: MediaStream
    try {
      mediaStream = await WHIPStreamer.getMediaStream(shareScreen)
    } catch (e) {
      addChatMessage(`get media failed: ${(e as Error).toString()}`)
      return
    }
    if (p2pMode) {
      startMediaStream(mediaStream)
      return
    }

    // TODO start whip on 'connect' request
    const streamer = new WHIPStreamer({
      sessionName: roomParam,
      videoElement: videoRef.current!,
      onChatMessage: (msg, from) => {
        addChatMessage(msg, from)
      },
      onOpen: (sid) => {
        setActiveSessionId(sid)
        if (roomParam) {
          const watchUrl = getPlayerUrl(sid, roomParam)
          sendChannelMessage(`new stream: ${watchUrl}`, 'event')
        }
      },
      onClose: () => {
      }
    })
    await streamer.start(mediaStream)
    requestWakeLock()
    setStreamer(streamer)
  }

  // Added control bar buttons mirroring the top action buttons
  const controlBarButtons: ControlBarButton[] = [
    (
      () => {
        if (videoRef.current?.srcObject) {
          return {
            label: 'Stop',
            onClick: () => {
              releaseWakeLock()
              stopMediaStream()
              stopStream()
              stopPlayer()
            },
          }
        }
        if (isPlayer) {
            return {
              label: 'Play',
              onClick: () => {
                startPlayer()
              },
            }
        }
        // Not streaming and not player: provide hover menu (camera / screen)
        return {
          label: 'Start',
          title: 'Start camera or screen share',
          onClick: () => { if (isMobile) startStreamer(false) },
          menu: isMobile ? undefined : {
            items: [
              {
                label: 'Start Camera',
                onClick: () => startStreamer(false)
              },
              {
                label: 'Start Screen',
                onClick: () => startStreamer(true)
              }
            ],
            openOn: 'hover',
            align: 'left'
          }
        }
      }
    )(),
    {
      label: (
        <span className="flex items-center gap-1">
          {copied && <span className="ml-2 text-green-400 text-xs">Copied!</span>}
          {!copied && 'Share'}
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
            <rect x="6" y="6" width="10" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/>
            <rect x="4" y="2" width="10" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" opacity="0.5"/>
          </svg>
        </span>
      ),
      title: 'Share player link, copy to clipboard',
      onClick: () => {
        const playerUrl = getPlayerUrl(activeSessionId, roomParam)
        if (openLinkOnShare) {
          window.open(playerUrl, '_blank')
        }
        setQrVisible(true)
        navigator.clipboard?.writeText(playerUrl)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      },
    },
    {
      label: isPlayer ? 'Switch Mute' : 'Switch Media',
      title: isPlayer ? 'Toggle mute' : 'Switch between camera and screen',
      onClick: () => { switchMedia() },
    }
  ]

  return (
    <div className="min-h-screen flex flex-col font-sans bg-neutral-900">
      <div className="fixed top-8 left-1/2 -translate-x-1/2 z-50 flex gap-4 bg-black/50 p-2 rounded-lg">
        <ControlBar buttons={controlBarButtons} />
      </div>

      <StreamVideo
        videoRef={videoRef}
        isMobile={isMobile}
        onClick={() => { setLogVisible(false) }}
      />
      <AvatarStack
        orientation='horizontal'
        avatars={onlineMembers}
      />
      <ChatOverlay
        show={chatVisible}
        messages={chatMessages}
        online={isChannelConnected}
        onSubmit={(text: string) => onTextSubmit(text)}
      />
      <QROverlay
        url={`${getPlayerUrl(activeSessionId, roomParam)}`}
        show={qrVisible}
        onClose={() => setQrVisible(false)}
      />
      <LoggingOverlay show={logVisible} />
    </div>
  )
}

export default App
