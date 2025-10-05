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

let _firstLoad = true
const urlParams = new URLSearchParams(window.location.search)
const sidParam = urlParams.get('s') || undefined
const roomParam = urlParams.get('r') || undefined
const hideMsg = urlParams.get('hidemsg') || undefined
const isPlayer = window.location.pathname.startsWith('/watch')
const SYSTEM_LOG = 'System'

const chatCmdList = getConfig().ui.cmdList
const maxHistoryMessage = getConfig().ui.maxHistoryMessage
const openLinkOnShare = getConfig().ui.openLinkOnShare
const isMobile = getConfig().ui.isMobilePlatform
const ownerDisplayName = getConfig().ui.streamOwnerDisplayName
const selfDisplayName = getConfig().ui.selfDisplayName
let ttsEnabled = getConfig().ui.ttsEnabled && ChromeTTS.isSupported()
let debugEnabled = getConfig().debug

function App() {
  const ttsPlayer = useMemo(() => new ChromeTTS(), [])
  const videoRef = useRef<HTMLVideoElement>(null);
  const { request: requestWakeLock, release: releaseWakeLock } = useWakeLock()
  const [streamSession, setStreamSession] = useState<string>()
  const [whipStreamer, setWHIPStreamer] = useState<WHIPStreamer>()
  const [whepPlayer, setWHEPPlayer] = useState<WHEPPlayer>()
  const [qrVisible, setQrVisible] = useState(false)
  const [logVisible, setLogVisible] = useState(false)
  const [chatVisible, setChatVisible] = useState(true)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [isFrontCamera, setIsFrontCamera] = useState(false)
  const [isScreenShare, setScreenShare] = useState(false)
  const [copied, setCopied] = useState(false)

  const { sendChannelMessage, isChannelConnected, onlineMembers } = useSupabaseChannel({
    roomName: roomParam ?? '',
    onChatMessage: (msg) => {
      addChatMessage(msg.content as string, msg.sender)
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

  function firstLoad() {
    addChatMessage('type /? for help')
    if (isPlayer) {
      patchRTCPeerConnection()
      startPlayer()
    }
  }

  function stopPlayer() {
    whepPlayer?.destroy()
    setWHEPPlayer(undefined)
  }

  async function startPlayer() {
    if (whepPlayer)
      return

    if (!roomParam?.length && !sidParam?.length) {
      return
    }

    const player = new WHEPPlayer({
      videoElement: videoRef.current!,
      onChatMessage: (message: string, from?: string) => {
        addChatMessage(message, from)
      },
      onOpen: (sid: string) => {
        requestWakeLock()
        setStreamSession(sid)
      },
      onClose: () => {
        releaseWakeLock()
        setWHEPPlayer(undefined)
        setStreamSession(undefined)
      },
    })
    await player.start(sidParam, roomParam)
    setWHEPPlayer(player)
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
        ttsEnabled = !ttsEnabled && ChromeTTS.isSupported()
        addChatMessage(`tts enabled ${ttsEnabled}`)
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
    const playerDc = whepPlayer?.getPlayerDc()
    if (playerDc) {
      msgObject.sender = whepPlayer?.getPlayerSid()
      SignalPeer.send(playerDc, msgObject)
      return
    }
    const streamerDc = whipStreamer?.getStreamerDc()
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
    setIsFrontCamera(!isFrontCamera)
    setScreenShare(!isScreenShare)
    whipStreamer?.switchMedia(!isScreenShare, !isFrontCamera)
  }

  async function stopStream() {
    if (whipStreamer) {
      try {
        await whipStreamer.stop()
      } finally {
        setWHIPStreamer(undefined)
        setStreamSession(undefined)
      }
    }
  }

  async function startStream(shareScreen?: boolean) {
    setScreenShare(shareScreen ?? false)
    const mediaStream = await WHIPStreamer.getMediaStream(shareScreen)
    const streamer = new WHIPStreamer({
      sessionName: roomParam,
      videoElement: videoRef.current!,
      onChatMessage: (message: string, from?: string) => {
        addChatMessage(message, from)
      },
      onOpen: (sid) => {
        setStreamSession(sid)
        if (roomParam) {
          const watchUrl = getPlayerUrl(sid, roomParam)
          sendChannelMessage(`new stream: ${watchUrl}`)
        }
      },
      onClose: () => {
        // addChatMessage('client closed')
      }
    })
    await streamer.start(mediaStream)
    requestWakeLock()
    setWHIPStreamer(streamer)
  }

  // Added control bar buttons mirroring the top action buttons
  const controlBarButtons: ControlBarButton[] = [
    (
      () => {
        if (streamSession) {
          return {
            label: 'Stop',
            onClick: () => {
              releaseWakeLock()
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
          onClick: () => { if (isMobile) startStream(false) },
          menu: isMobile ? undefined : {
            items: [
              {
                label: 'Start Camera',
                onClick: () => startStream(false)
              },
              {
                label: 'Start Screen',
                onClick: () => startStream(true)
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
        const playerUrl = getPlayerUrl(streamSession, roomParam)
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
        url={`${getPlayerUrl(streamSession, roomParam)}`}
        show={qrVisible}
        onClose={() => setQrVisible(false)}
      />
      <LoggingOverlay show={logVisible} />
    </div>
  )
}

export default App
