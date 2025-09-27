// src/App.tsx

import { useMemo, useState, useEffect } from 'react'
import './App.css'

import { getConfig } from './config'
import { useWakeLock } from './hooks/use-wakelock'
import { useSupabaseChannel } from './hooks/use-supabase'

import LoggingOverlay from './components/logger'
import QROverlay from './components/qr-overlay'
import { ChatMessage, ChatOverlay } from './components/chat-overlay'
import { SignalPeer, patchRTCPeerConnection } from './libs/signalpeer'
import { ChromeTTS } from './libs/tts'
import { WHEPPlayer } from './libs/player'
import { WHIPStreamer } from './libs/streamer'
import { getPlayerUrl } from './libs/api'

let _firstLoad = true
const sidParam = new URLSearchParams(window.location.search).get('sid') || undefined
const nameParam = new URLSearchParams(window.location.search).get('name') || undefined
const roomParam = new URLSearchParams(window.location.search).get('room') || undefined
const SYSTEM_LOG = 'System'

const chatCmdList = getConfig().ui.cmdList
const maxHistoryMessage = getConfig().ui.maxHistoryMessage
const openLinkOnShare = getConfig().ui.openLinkOnShare
const isMoblie = getConfig().ui.isMobilePlatform
const ownerDisplayName = getConfig().ui.streamOwnerDisplayName
const selfDisplayName = getConfig().ui.selfDisplayName
let ttsEnabled = getConfig().ui.ttsEnabled && ChromeTTS.isSupported()
let debugEnabled = getConfig().debug

function getVideoElement() {
  return window.document.querySelector<HTMLVideoElement>('#video')!
}

patchRTCPeerConnection()

function App() {
  const ttsPlayer = useMemo(() => new ChromeTTS(), [])
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
    roomName: roomParam ?? nameParam ?? '',
    onChatMessage: (msg) => {
      addChatMessage(msg.content, msg.sender)
    }
  })

  useEffect(() => {
    if (_firstLoad) {
      _firstLoad = false
      help()
      startPlayer()
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
      } else if (event.key === 'm') {
        handleCmd('/mute')
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Empty dependency array means this runs once on mount

  function help() {
    addChatMessage('type /? for help')
  }

  function stopPlayer() {
    whepPlayer?.destroy()
    setWHEPPlayer(undefined)
  }

  async function startPlayer() {
    if (whepPlayer)
      return

    if (!nameParam?.length && !sidParam?.length) {
      return
    }

    const player = new WHEPPlayer({
      videoElement: getVideoElement(),
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
    await player.start(sidParam, nameParam)
    setWHEPPlayer(player)
  }

  async function handleCmd(text: string) {
    const v = getVideoElement()!
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
    if (isChannelConnected) {
      sendChannelMessage(text)
      return
    }
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

    addChatMessage('getting media from user')
    const mediaStream = await WHIPStreamer.getMediaStream(shareScreen)

    requestWakeLock()
    const streamer = new WHIPStreamer({
      sessionName: roomParam,
      videoElement: getVideoElement(),
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
    setWHIPStreamer(streamer)
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
                releaseWakeLock()
                stopStream()
                stopPlayer()
              } else {
                // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                sidParam || nameParam ? startPlayer() : setShowHoverMenu(true)
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
                Start Camera
              </button>
              <button
                onClick={() => startStream(true)}
                className='hover-menu-item'
              >
                Start Screen
              </button>
            </div>
          )}
        </div>
        <div className='control-button-container' >
          <button className='control-bt'
            onClick={() => {
              if (!streamSession?.length)
                return

              const playerUrl = getPlayerUrl(streamSession, roomParam || nameParam)
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
        <video id='video' autoPlay playsInline
          // Add reference for Safari PiP API
          ref={(video) => {
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
        >
        </video>
      </div>

      <ChatOverlay
        show={chatVisible}
        messages={chatMessages}
        onSubmit={(text) => onTextSubmit(text)}
      />
      <QROverlay
        url={`${getPlayerUrl(streamSession, roomParam || nameParam)}`}
        show={qrVisible}
        onClose={() => setQrVisible(false)}
      />
      <LoggingOverlay show={logVisible} />
    </>
  )
}

export default App
