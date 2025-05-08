// src/App.tsx

import { useState, useEffect } from 'react'
import './App.css'

import { getConfig } from './config'

import { WHIPClient } from '@eyevinn/whip-web-client'
import { WebRTCPlayer } from "@eyevinn/webrtc-player"
import LoggingOverlay from './components/logger'
import QROverlay from './components/qr-overlay'
import { ChatMessage, ChatOverlay } from './components/chat-overlay'
import { SignalPeer, SignalMessage, SignalEvent, patchRTCPeerConnection } from './libs/signalpeer'
import { ChromeTTS } from './libs/tts'
import {
  requestDataChannel,
  getSessionInfo,
  getSessionUrl,
  getPlayerUrl,
  extractSessionIdFromUrl,
  getSessionByName,
  setSessionByName,
} from './libs/api'

let _firstLoad = true
let sidParam = new URLSearchParams(window.location.search).get('sid') || undefined
const nameParam = new URLSearchParams(window.location.search).get('name') || undefined
const roomParam = new URLSearchParams(window.location.search).get('room') || undefined
const SYSTEM_LOG = 'System'
const APP_LOG = 'App'
const DC_LOG = 'DataChannel'

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
const ttsEnabled = getConfig().ui.ttsEnabled && ChromeTTS.isSupported()
let isDebug = getConfig().debug

function getVideoElement() {
  return window.document.querySelector<HTMLVideoElement>('#video')!
}

function App() {
  let wakeLock: WakeLockSentinel | null = null
  const ttsPlayer = new ChromeTTS()
  const signalPeer = new SignalPeer()
  const [streamSession, setStreamSession] = useState<string>()
  const [playerSession, setPlayerSession] = useState<string>()
  const [whipClient, setWHIPClient] = useState<WHIPClient>()
  const [whepPlayer, setWHEPPlayer] = useState<WebRTCPlayer>()
  const [qrVisible, setQrVisible] = useState(false)
  const [logVisible, setLogVisible] = useState(false)
  const [chatVisible, setChatVisible] = useState(true)
  const [showHoverMenu, setShowHoverMenu] = useState(false)
  const [playerDc, setPlayerDc] = useState<RTCDataChannel>()
  const [streamerDc, setStreamerDc] = useState<RTCDataChannel>()
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [isFrontCamera, setIsFrontCamera] = useState(true);
  const [isScreenShare, setScreenShare] = useState(true);

  useEffect(() => {
    if (!_firstLoad) return
    _firstLoad = false
    patchRTCPeerConnection()
    help()
    play()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setChatVisible(false)
        setLogVisible(false)
        setQrVisible(false)
      } else if (event.key === 'Enter') {
        setChatVisible(true)
      } else if (event.key === 'm') {
        const v = getVideoElement()
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        v?.muted ? handleCmd('/unmute') : handleCmd('/mute')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Empty dependency array means this runs once on mount

  function help() {
    addChatMessage('type /? for help')
  }

  async function requestWakeLock() {
    if (wakeLock) return
    if ('wakeLock' in navigator) {
      try {
        wakeLock = await navigator.wakeLock.request('screen');
        console.log(APP_LOG, 'Wake lock acquired');

        // 监听释放事件（如页面隐藏）
        document.addEventListener('visibilitychange', async () => {
          if (wakeLock !== null && !document.hidden) {
            wakeLock = await navigator.wakeLock.request('screen')
          }
        });
      } catch (err) {
        console.error(APP_LOG, 'Failed to acquire wake lock:', err);
      }
    } else {
      console.warn(APP_LOG, 'Wake Lock API not supported');
    }
  }

  async function releaseWakeLock() {
    if (wakeLock) {
      await wakeLock.release()
      wakeLock = null
      console.log(APP_LOG, 'Wake lock released')
    }
  }

  function stop() {
    if (whepPlayer) {
      whepPlayer.destroy()
      setWHEPPlayer(undefined)
      setStreamSession(undefined)
      setPlayerDc(undefined)
      addChatMessage('closed')
    }
  }

  async function play() {
    const video = getVideoElement()
    if (whepPlayer || !video)
      return

    if (nameParam?.length) {
      sidParam = await getSessionByName(nameParam)
      if (!sidParam?.length)
        addChatMessage('session not found')
    }

    if (!sidParam?.length) {
      return
    }

    requestWakeLock()
    const player = new WebRTCPlayer({
      debug: false,
      video: video,
      type: 'whep',
      statsTypeFilter: '^inbound-rtp',
      iceServers: stunServers,
    })
    setWHEPPlayer(player)
    setStreamSession(sidParam)

    addChatMessage(`loading ${sidParam}`)
    player.on('no-media', () => {
      addChatMessage('media timeout')
      player.destroy()
      setWHEPPlayer(undefined)
      setStreamSession(undefined)
      setPlayerDc(undefined)
    })
    player.load(new URL(getSessionUrl(sidParam))).then(() => {
      const playerObj = player as never
      const playerAdapter = playerObj['adapter'] as never
      const anyPeer = playerAdapter['localPeer'] as never
      const bootstrapDc = anyPeer['bootstrapDc'] as RTCDataChannel
      const peer = anyPeer as RTCPeerConnection

      let signalConnected = false
      let lastKick: number = 0
      async function handleSignalEvent(event: SignalMessage, selfSid: string) {
        const now = Date.now()
        const signalEvent = event.content as SignalEvent
        if (signalEvent.status == 'waiting') {
          if (signalConnected || now - lastKick < 60000) return
          if (await SignalPeer.kickSignal(signalEvent.sid)) {
            console.log(APP_LOG, `${signalEvent.sid} kicked`)
            lastKick = now
          }
        } else if (signalEvent.status == 'connected') {
          if (selfSid === signalEvent.sid) {
            signalConnected = true
            addChatMessage(`${signalEvent.sid} joined (self)`)
          } else {
            addChatMessage(`${signalEvent.sid} joined`)
          }
        } else if (signalEvent.status == 'disconnected') {
            addChatMessage(`${signalEvent.sid} left`)
        }
      }

      function getPlayerSession(): string {
        const resourceUrl = playerAdapter['resource'] as string
        const playerSid = extractSessionIdFromUrl(resourceUrl)
        setPlayerSession(playerSid)
        return playerSid!
      }

      function initPlayerSignal() {
        const playerSid = getPlayerSession()
        // signal publisher
        requestDataChannel(playerSid, peer, null, SignalPeer.label).then(dc => {
          dc.onopen = () => {
            console.log(APP_LOG, 'publisher dc open')
          }
          setPlayerDc(dc)
        })
        // signal subscriber
        requestDataChannel(playerSid, peer, sidParam).then(dc => {
          dc.onopen = () => {
            console.log(APP_LOG, 'subscriber dc open')
          }
          dc.onmessage = async (ev) => {
            if (isDebug)
              console.log(DC_LOG, 'recv <<<', ev.data as string)
            const event = JSON.parse(ev.data) as SignalMessage
            if (event.type == 'signal') {
              handleSignalEvent(event, playerSid)
            } else if (event.type == 'chat') {
              const text = event.content as string
              const sender = event.sender == playerSid ? selfDisplayName : event.sender
              addChatMessage(text, sender)
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
        addChatMessage(`connected ${sidParam}`)
        console.log(APP_LOG, 'bootstarp open')
        jitterBufferConfig()
        initPlayerSignal()
      }
    })
  }

  function dataChannelSend(dc: RTCDataChannel, msg: SignalMessage, callback?: () => void) {
    if (dc.readyState == 'open') { const msgString = typeof msg === 'string' ? msg : JSON.stringify(msg)
      dc.send(msgString)

      if (isDebug)
        console.log(DC_LOG, `send >>>`, msgString)

      if (callback) callback()
    }
  }

  function startSignalPeer(signalPeer: SignalPeer, sessionId: string, broadcastDc: RTCDataChannel) {
    let broadcastTimeout: NodeJS.Timeout

    signalPeer.onBootstrapReady(() => {
      clearTimeout(broadcastTimeout)
      // bootstrap connected, broadcast self to subs
      const bootSid = signalPeer.getBroadcastSid()
      const signalEvent = SignalPeer.newSignalEvent('waiting', bootSid!)
      const callback = () => {
        broadcastTimeout = setTimeout(() => {
          dataChannelSend(broadcastDc, signalEvent, callback)
        }, broadcastInterval)
      }
      dataChannelSend(broadcastDc, signalEvent, callback)
    })
    signalPeer.onBootstrapKicked(() => {
      clearTimeout(broadcastTimeout)
      // bootstrap kicked, connect signal to new sub
      getSessionInfo(sessionId).then(info => {
        info.subs.forEach(sid => signalPeer.newSignalDc(sid))
        signalPeer.clearInvalidDc(info.subs)
      })
    })
    signalPeer.onOpen((sid: string) => {
      addChatMessage(`${sid} joined`)
      dataChannelSend(broadcastDc, SignalPeer.newSignalEvent('connected', sid))
    })
    signalPeer.onClose((sid: string) => {
      addChatMessage(`${sid} left`)
      dataChannelSend(broadcastDc, SignalPeer.newSignalEvent('disconnected', sid))
    })
    signalPeer.onMessage((sid: string, ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'chat') {
        addChatMessage(msg.content, sid)
        // broadcast to all subs
        dataChannelSend(broadcastDc, ev.data)
      }
      // TODO supoprt rpc
    })
    signalPeer.start()
  }

  function handleCmd(text: string): boolean {
    if (chatCmdList.has(text)) {
      const v = getVideoElement()!
      switch (text) {
        case '/?':
          addChatMessage(`TODO add help tips`)
          break
        case '/debug':
          isDebug = !isDebug
          if (isDebug)
            setLogVisible(true)
          addChatMessage(`debug enabled ${isDebug}`)
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

  function sendChatMessage(text: string) {
    if (handleCmd(text)) {
      return
    }
    const msgObject = SignalPeer.newChatMsg(text)
    if (playerDc) {
      msgObject.sender = playerSession!
      dataChannelSend(playerDc, msgObject)
      return
    }
    if (streamerDc) {
      msgObject.sender = ownerDisplayName
      dataChannelSend(streamerDc, msgObject, () => {
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

  function setVideoBitrate(peer: RTCPeerConnection, videoTrack?: MediaStreamTrack) {
    if (!videoTrack) {
      console.error(APP_LOG, 'no video track')
      return
    }
    const sender = peer.getSenders().find(s => s.track?.id == videoTrack.id)
    if (sender) {
      console.log(APP_LOG, 'set sender maxBitrate')
      const params = sender.getParameters()
      params.encodings = [{
        maxBitrate: videoMaxBitrate,
      }]
      sender.setParameters(params)
    } else {
      console.log(APP_LOG, 'failed to get sender', peer)
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

  async function setSessionName(sid: string) {
    if (!roomParam?.length)
      return
    const res = await setSessionByName(roomParam, sid)
    if (res.status == 200) {
      addChatMessage(`set room ${roomParam} session to ${sid}`)
    }
  }

  async function stopStream() {
    if (whipClient) {
      try {
        await whipClient.destroy()
      } finally {
        setWHIPClient(undefined)
        setStreamSession(undefined)
      }
      signalPeer.close()
      addChatMessage('client closed')
    }
  }

  async function startStream(shareScreen?: boolean) {
    requestWakeLock()
    setShowHoverMenu(false)
    const video = getVideoElement()

    addChatMessage('getting media from user')
    const mediaStream = await getMediaStream(shareScreen)
    const videoTrack = mediaStream.getVideoTracks().find(t => t.enabled)
    console.log(APP_LOG, `video track ${videoTrack?.id} ${videoTrack?.kind} ${videoTrack?.label}`)

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
          console.log(APP_LOG, `client peer ${peer.connectionState}`)
          if (peer.connectionState == 'connected') {
            client.getResourceUrl().then(resUrl => {
              const sid = extractSessionIdFromUrl(resUrl)
              requestDataChannel(sid!, peer).then(dc => {
                dc.onclose = () => {
                  console.log(DC_LOG, 'client dc close')
                }
                dc.onopen = () => {
                  console.log(DC_LOG, 'client dc open')
                  startSignalPeer(signalPeer, sid!, dc)
                }
                setStreamerDc(dc)
              })
              setSessionName(sid!)
            })
            addChatMessage('client connected')
            setVideoBitrate(peer, videoTrack)
          }
        })
        return peer
      }
    })
    addChatMessage('client starting')
    await client.setIceServersFromEndpoint()
    await client.ingest(mediaStream)
    video!.srcObject = mediaStream
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
                releaseWakeLock()
                stopStream()
                stop()
              } else {
                // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                sidParam || nameParam ? play() : setShowHoverMenu(true)
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
        <video id='video' autoPlay muted playsInline
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
        onSend={(text) => sendChatMessage(text)}
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
