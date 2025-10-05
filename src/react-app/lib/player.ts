import { WebRTCPlayer } from "@eyevinn/webrtc-player"
import { SignalMessage, SignalEvent, SignalPeer } from './signalpeer'
import { getSessionUrl, requestDataChannel, extractSessionIdFromUrl } from './api'
import { getConfig } from '../config'

let debug = getConfig().debug
const stunServers = getConfig().api.stunServers
const defaultBufferTarget = getConfig().stream.jitterBufferTarget || 500
const selfDisplayName = getConfig().ui.selfDisplayName

const LOG_TAG = 'Player'

export interface PlayerConfig {
  videoElement: HTMLVideoElement
  onLocalOffer?: (pc: RTCPeerConnection, candidates: RTCIceCandidateInit[]) => Promise<void>
  onChatMessage?: (message: string, from?: string) => void
  onOpen?: (sid?: string) => void
  onClose?: () => void
}

export class WHEPPlayer {
  private player?: WebRTCPlayer
  private playerDc?: RTCDataChannel
  private playerSid?: string
  private config: PlayerConfig
  private signalConnected = false
  private lastKick = 0

  constructor(config: PlayerConfig) {
    this.config = config
  }

  static enableDebug(enabled: boolean) {
    debug = enabled
  }

  private handleSignalEvent = async (event: SignalMessage, selfSid: string) => {
    const now = Date.now()
    const signalEvent = event.content as SignalEvent
    if (signalEvent.status == 'waiting') {
      if (this.signalConnected || now - this.lastKick < 60000) return
      if (await SignalPeer.kickSignal(signalEvent.sid)) {
        console.log(LOG_TAG, `signal session kicked ${signalEvent.sid}`)
        this.lastKick = now
      }
    } else if (signalEvent.status == 'connected') {
      if (selfSid === signalEvent.sid) {
        this.signalConnected = true
        this.config.onChatMessage?.(`${signalEvent.sid} joined (self)`)
      } else {
        this.config.onChatMessage?.(`${signalEvent.sid} joined`)
      }
    } else if (signalEvent.status == 'disconnected') {
      this.config.onChatMessage?.(`${signalEvent.sid} left`)
    }
  }

  // @ts-expect-error keep
  private initPlayerSignal = (peer: RTCPeerConnection, playerAdapter: never, streamSid: string) => {
    const resourceUrl = playerAdapter['resource'] as string
    const playerSid = extractSessionIdFromUrl(resourceUrl)
    if (!playerSid?.length) {
      console.error(LOG_TAG, 'invalid session id')
      return
    }
    this.playerSid = playerSid

    // signal publisher
    requestDataChannel(playerSid, peer, null, SignalPeer.label).then(dc => {
      dc.onopen = () => {
        console.log(LOG_TAG, 'publisher dc open')
      }
      this.playerDc = dc
    })
    // signal subscriber
    requestDataChannel(playerSid, peer, streamSid).then(dc => {
      dc.onopen = () => {
        console.log(LOG_TAG, 'subscriber dc open')
      }
      dc.onmessage = async (ev) => {
        if (debug)
          console.log('SignalDc', 'recv <<<', ev.data as string)
        const event = JSON.parse(ev.data) as SignalMessage
        if (event.type === 'signal') {
          this.handleSignalEvent(event, playerSid)
        } else if (event.type === 'chat') {
          const text = event.content as string
          const sender = event.sender === playerSid ? selfDisplayName : event.sender
          this.config.onChatMessage?.(text, sender)
        }
      }
    })
  }

  private jitterBufferConfig = (peer: RTCPeerConnection) => {
    peer.getReceivers().forEach(r => {
      r.jitterBufferTarget = defaultBufferTarget
    })
  }

  public async start(sidParam?: string) {
    const { videoElement, onOpen, onChatMessage } = this.config
    if (this.player || !videoElement) return
    // if (nameParam?.length) {
    //   sidParam = await getSessionByName(nameParam)
    // }

    const player = new WebRTCPlayer({
      debug: debug,
      video: videoElement,
      type: sidParam?.length ? 'whep' : 'custom',
      statsTypeFilter: '^inbound-rtp',
      iceServers: stunServers,
      detectTimeout: sidParam?.length ? true : false,
      adapterFactory: (playerPeer, _url, _onError, _mediaConstraints, _authKey) => {
        let peer = playerPeer
        return {
          enableDebug: () => { },
          getPeer: () => peer,
          resetPeer: (newPeer: RTCPeerConnection) => { peer = newPeer },
          connect: async () => {
            const stream = videoElement.srcObject as MediaStream | null
            if (stream) {
              stream.getTracks().forEach(t => t.stop())
            }
            console.log('connect with channel rpc')
            const newStream = new MediaStream()
            peer.ontrack = (event) => {
              if (!event.track) return
              newStream.addTrack(event.track)
              if (!videoElement.srcObject) {
                videoElement.srcObject = newStream
              }
            }
            // prepare offer
            peer.addTransceiver('video', { direction: 'recvonly' })
            peer.addTransceiver('audio', { direction: 'recvonly' })
            const setLocalPromise = peer.setLocalDescription(await peer.createOffer())
            // ice candidates gathering after setLocalDescription
            await new Promise<void>((resolve) => {
              setTimeout(() => resolve(), 1000)
            })
            await setLocalPromise
            this.config.onLocalOffer?.(peer, [])
          },
          disconnect: async () => {
            peer?.close()
          }
        }
      },
    })

    player.on('no-media', () => {
      onChatMessage?.('media timeout')
      this.stop()
    })
    player.on('initial-connection-failed', () => {
      onChatMessage?.('initial connection failed')
      this.stop()
      setTimeout(() => { this.start() }, 1000)
    })
    player.on('peer-connection-failed', () => {
      onChatMessage?.('peer connection failed')
      this.stop()
    })

    onChatMessage?.(`loading ${sidParam ?? 'p2p'}`)
    player.load(new URL(getSessionUrl(sidParam) + '/play')).then(() => {
      const playerObj = player as never
      const peer = playerObj['peer'] as never
      const bootstrapDc = peer['bootstrapDc'] as RTCDataChannel

      bootstrapDc.onopen = () => {
        this.jitterBufferConfig(peer)
        onOpen?.(sidParam)
      }
    })
    this.player = player
  }

  public getPlayerDc() {
    return this.playerDc
  }

  public getPlayerSid() {
    return this.playerSid
  }

  public stop() {
    const video = this.config.videoElement
    if (video && video.srcObject) {
      (video.srcObject as MediaStream).getTracks().forEach(track => track.stop())
      video.srcObject = null
    }
    if (this.player) {
      this.player.destroy()
      this.player = undefined
      this.playerDc = undefined
      this.config.onClose?.()
    }
  }
}
