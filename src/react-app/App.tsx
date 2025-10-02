// src/App.tsx

import { useRef, useMemo, useState, useEffect } from 'react'

import { getConfig } from './config'
import { useWakeLock } from './hooks/use-wakelock'
import { useSupabaseChannel } from './hooks/use-supabase'

import LoggingOverlay from './components/logger'
import QROverlay from './components/qr-overlay'
import { ChatMessage, ChatOverlay } from './components/chat-overlay'
import { SignalPeer } from './libs/signalpeer'
import { ChromeTTS } from './libs/tts'
import { WHEPPlayer } from './libs/player'
import { WHIPStreamer } from './libs/streamer'
import { getPlayerUrl } from './libs/api'

let _firstLoad = true
const urlParams = new URLSearchParams(window.location.search)
const sidParam = urlParams.get('s') || undefined
const roomParam = urlParams.get('r') || undefined
const isPlayer = window.location.pathname.startsWith('/watch')
const SYSTEM_LOG = 'System'

const chatCmdList = getConfig().ui.cmdList
const maxHistoryMessage = getConfig().ui.maxHistoryMessage
const openLinkOnShare = getConfig().ui.openLinkOnShare
const isMoblie = getConfig().ui.isMobilePlatform
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
  const [showHoverMenu, setShowHoverMenu] = useState(false)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [isFrontCamera, setIsFrontCamera] = useState(false)
  const [isScreenShare, setScreenShare] = useState(false)

  const { sendChannelMessage, isChannelConnected } = useSupabaseChannel({
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Empty dependency array means this runs once on mount

  function firstLoad() {
    addChatMessage('type /? for help')
    if (isPlayer) {
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
    setShowHoverMenu(false)
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
        addChatMessage('client connected')
      },
      onClose: () => {
        addChatMessage('client closed')
      }
    })
    await streamer.start(mediaStream)
    requestWakeLock()
    setWHIPStreamer(streamer)
  }

  return (
    <div className="min-h-screen flex flex-col font-sans bg-neutral-900 text-white">
      <div
        className="fixed top-8 left-1/2 -translate-x-1/2 z-50 flex gap-4 bg-black/50 p-2 rounded-lg"
      >
        <div
          className="relative inline-block"
          onMouseEnter={() => setShowHoverMenu(!isPlayer && !streamSession)}
          onMouseLeave={() => setShowHoverMenu(false)}
        >
          <button
            className="h-full px-4 py-2 rounded bg-neutral-900 text-white hover:bg-neutral-600 transition"
            onClick={() => {
              if (streamSession) {
                releaseWakeLock()
                stopStream()
                stopPlayer()
              } else {
                // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                isPlayer ? startPlayer() : setShowHoverMenu(true)
              }
            }}
          >
            {streamSession ? 'Stop' : isPlayer ? 'Play' : 'Start'}
          </button>
          {!streamSession && showHoverMenu && (
            <div className="absolute top-full left-0 bg-neutral-800 border border-neutral-700 rounded-lg shadow-lg z-50 min-w-[150px]">
              <button
                onClick={() => startStream(false)}
                className="block w-full px-3 py-2 text-left text-gray-200 hover:bg-neutral-700 transition"
              >
                Start Camera
              </button>
              <button
                onClick={() => startStream(true)}
                className="block w-full px-3 py-2 text-left text-gray-200 hover:bg-neutral-700 transition"
              >
                Start Screen
              </button>
            </div>
          )}
        </div>
        <div className="relative inline-block">
          <button
            className="h-full px-4 py-2 rounded bg-neutral-900 text-white hover:bg-neutral-600 transition"
            onClick={() => {
              const playerUrl = getPlayerUrl(streamSession, roomParam)
              if (openLinkOnShare) {
                window.open(playerUrl, '_blank')
              }
              setQrVisible(true)
              navigator.clipboard?.writeText(playerUrl)
            }}
          >
            Share
          </button>
        </div>
        <div className="relative inline-block">
          <button
            className="h-full px-4 py-2 rounded bg-neutral-900 text-white hover:bg-neutral-600 transition"
            onClick={() => {
              switchMedia()
            }}
          >
            {isPlayer ? 'Switch Mute' : 'Switch Media'}
          </button>
        </div>
      </div>

      <div className="fixed inset-0 overflow-hidden">
        <video
          muted
          autoPlay
          playsInline
          ref={(video) => {
            videoRef.current = video
            if (video) {
              let playTriggered = Date.now()
              video.disablePictureInPicture = false
              video.playsInline = true
              video.onplay = () => {
                playTriggered = Date.now()
                video.controls = false
              }
              video.onclick = () => {
                setLogVisible(false)
                if (!isMoblie) return
                if (video.paused) {
                  video.controls = false
                  video.play()
                } else if (Date.now() - playTriggered > 100) {
                  video.controls = true
                  video.pause()
                }
              }
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
          className="absolute top-0 left-0 w-full h-full"
        ></video>
      </div>

      <ChatOverlay
        show={chatVisible}
        messages={chatMessages}
        online={isChannelConnected}
        onSubmit={(text) => onTextSubmit(text)}
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
