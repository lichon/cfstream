import { WebRTCPlayer } from "@eyevinn/webrtc-player"
import { SignalChatMessage, SignalMessage, SignalEvent, SignalPeer } from './signalpeer'
import { getSessionUrl, requestDataChannel, getSessionByName, extractSessionIdFromUrl } from './api'
  
import { getConfig } from '../config'

let debug = getConfig().debug
const stunServers = getConfig().api.stunServers
const defaultBufferTarget = getConfig().stream.jitterBufferTarget || 500
const selfDisplayName = getConfig().ui.selfDisplayName

const PLAYER_LOG = 'Player'

export interface PlayerConfig {
  videoElement: HTMLVideoElement
  onChatMessage?: (event: SignalChatMessage) => void
  onClose?: () => void
}

export class WHEPPlayer {
  private player?: WebRTCPlayer
  private playerDc?: RTCDataChannel
  private playerSid?: string
  private playingStream?: string
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
        console.log(PLAYER_LOG, `${signalEvent.sid} kicked`)
        this.lastKick = now
      }
    } else if (signalEvent.status == 'connected') {
      if (selfSid === signalEvent.sid) {
        this.signalConnected = true
        this.config.onChatMessage?.({ content: `${signalEvent.sid} joined (self)` })
      } else {
        this.config.onChatMessage?.({ content: `${signalEvent.sid} joined` })
      }
    } else if (signalEvent.status == 'disconnected') {
      this.config.onChatMessage?.({ content: `${signalEvent.sid} left` })
    }
  }

  private initPlayerSignal = (peer: RTCPeerConnection, playerAdapter: never, sidParam: string) => {
    const resourceUrl = playerAdapter['resource'] as string
    const playerSid = extractSessionIdFromUrl(resourceUrl)
    if (!playerSid?.length) {
      console.error(PLAYER_LOG, 'invalid session id')
      return
    }
    this.playerSid = playerSid

    // signal publisher
    requestDataChannel(playerSid, peer, null, SignalPeer.label).then(dc => {
      dc.onopen = () => {
        console.log(PLAYER_LOG, 'publisher dc open')
      }
      this.playerDc = dc
    })
    // signal subscriber
    requestDataChannel(playerSid, peer, sidParam).then(dc => {
      dc.onopen = () => {
        console.log(PLAYER_LOG, 'subscriber dc open')
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
          this.config.onChatMessage?.({ content: text, sender })
        }
      }
    })
  }

  private jitterBufferConfig = (peer: RTCPeerConnection) => {
    peer.getReceivers().forEach(r => {
      r.jitterBufferTarget = defaultBufferTarget
    })
  }

  public async start(sidParam?: string, nameParam?: string) {
    const { videoElement, onChatMessage } = this.config

    if (this.player || !videoElement) return

    if (nameParam?.length) {
      sidParam = await getSessionByName(nameParam)
      if (!sidParam?.length) {
        onChatMessage?.({ content: 'session not found' })
        return
      }
    }

    if (!sidParam?.length) return

    const player = new WebRTCPlayer({
      debug: debug,
      video: videoElement,
      type: 'whep',
      statsTypeFilter: '^inbound-rtp',
      iceServers: stunServers,
    })

    player.on('no-media', () => {
      onChatMessage?.({ content: 'media timeout' })
      this.destroy()
    })

    onChatMessage?.({ content: `loading ${sidParam}` })
    player.load(new URL(getSessionUrl(sidParam))).then(() => {
      const playerObj = player as never
      const playerAdapter = playerObj['adapter'] as never
      const localPeer = playerAdapter['localPeer'] as never
      const bootstrapDc = localPeer['bootstrapDc'] as RTCDataChannel
      const peer = localPeer as RTCPeerConnection

      bootstrapDc.onopen = () => {
        onChatMessage?.({ content: `connected ${sidParam}` })
        this.jitterBufferConfig(peer)
        this.initPlayerSignal(peer, playerAdapter, sidParam)
      }
    })
    this.playingStream = sidParam
    this.player = player
  }

  public getPlayerDc() {
    return this.playerDc
  }

  public getPlayerSid() {
    return this.playerSid
  }

  public getPlayingStream() {
    return this.playingStream
  }

  public stop() {
    if (this.player) {
      this.player.destroy()
      this.player = undefined
      this.playerDc = undefined
      this.config.onClose?.()
    }
  }

  public destroy() {
    this.stop()
  }
}
