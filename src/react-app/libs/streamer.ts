import { WHIPClient } from '@eyevinn/whip-web-client'
import { SignalPeer } from './signalpeer'
import {
  requestDataChannel,
  setSessionByName,
  getSessionInfo,
  getSessionUrl,
  extractSessionIdFromUrl
} from './api'

import { getConfig } from '../config'

let debug = getConfig().debug
const videoMaxBitrate = getConfig().stream.videoBitrate
const stunServers = getConfig().api.stunServers
const broadcastInterval = getConfig().stream.broadcastInterval

const LOG_TAG = 'Streamer'

export interface WHIPStreamerConfig {
  videoElement: HTMLVideoElement
  sessionName?: string
  onChatMessage?: (message: string, from?: string) => void
  onOpen?: (sid: string) => void
  onClose?: () => void
}

export class WHIPStreamer {
  private client?: WHIPClient
  private config: WHIPStreamerConfig
  private streamerDc?: RTCDataChannel
  private streamerSid?: string
  private signalPeer?: SignalPeer

  constructor(config: WHIPStreamerConfig) {
    this.config = config
  }

  static enableDebug(enabled: boolean) {
    debug = enabled
  }

  static async getMediaStream(shareScreen?: boolean, facingMode?: string): Promise<MediaStream> {
    if (shareScreen && navigator.mediaDevices.getDisplayMedia) {
      return await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 15 },
        },
        audio: true,
      })
    } 
    return await navigator.mediaDevices.getUserMedia({
      video: {
        frameRate: { ideal: 30 },
        facingMode: facingMode || 'environment'
      },
      audio: { deviceId: 'communications' },
    })
  }

  private setVideoBitrate(peer: RTCPeerConnection, videoTrack?: MediaStreamTrack, maxBitrate = videoMaxBitrate) {
    if (!videoTrack) return
    const sender = peer.getSenders().find(s => s.track?.id == videoTrack.id)
    if (sender) {
      const params = sender.getParameters()
      params.encodings = [{
        maxBitrate: maxBitrate,
      }]
      sender.setParameters(params)
    }
  }

  async switchMedia(isScreenShare = false, isFrontCamera = false) {
    if (!this.client) return

    const video = this.config.videoElement
    const cameraFacingMode = isFrontCamera ? 'user' : 'environment'

    // Get new media stream with switched camera
    const newStream = await WHIPStreamer.getMediaStream(isScreenShare, cameraFacingMode)

    // Replace video track
    const oldStream = video.srcObject as MediaStream
    const oldTrack = oldStream.getVideoTracks()[0]
    const newTrack = newStream.getVideoTracks()[0]
    newStream.getTracks().forEach(t => {
      if (t !== newTrack) t.stop()
    })

    const anyClient = this.client as never
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

  async start(mediaStream: MediaStream) {
    const videoTrack = mediaStream.getVideoTracks().find(t => t.enabled)
    console.log(LOG_TAG, `video track ${videoTrack?.id} ${videoTrack?.kind} ${videoTrack?.label}`)

    this.client = new WHIPClient({
      endpoint: getSessionUrl(),
      opts: {
        debug: debug,
        noTrickleIce: true,
        iceServers: stunServers,
      },
      peerConnectionFactory: (config: RTCConfiguration) => {
        const peer = new RTCPeerConnection(config)
        peer.addEventListener('connectionstatechange', () => {
          console.log(LOG_TAG, `client peer ${peer.connectionState}`)
          if (peer.connectionState === 'connected') {
            this.client!.getResourceUrl().then(resUrl => {
              const sid = extractSessionIdFromUrl(resUrl)
              this.config.onOpen?.(sid!)
              requestDataChannel(sid!, peer).then(dc => {
                this.streamerDc = dc
                dc.onclose = () => {
                  console.log(LOG_TAG, 'client dc close')
                }
                dc.onopen = () => {
                  console.log(LOG_TAG, 'client dc open')
                  this.startSignalPeer(sid!, dc)
                }
              })
            })
            this.setVideoBitrate(peer, videoTrack)
          }
        })
        return peer
      }
    })

    this.config.onChatMessage?.('client starting')
    await this.client.setIceServersFromEndpoint()
    await this.client.ingest(mediaStream)
    this.config.videoElement.srcObject = mediaStream
    this.streamerSid = extractSessionIdFromUrl(await this.client.getResourceUrl() || '')
    this.setSessionName(this.streamerSid!, this.config.sessionName)
  }

  async stop() {
    if (this.client) {
      await this.client.destroy()
      this.config.onClose?.()
      this.client = undefined
    }
    if (this.signalPeer) {
      this.signalPeer.close()
      this.signalPeer = undefined
    }
  }

  private async setSessionName(sid: string, nameParam?: string) {
    if (!nameParam?.length)
      return
    const res = await setSessionByName(nameParam, sid)
    if (res.status == 200) {
      this.config.onChatMessage?.(`set room ${nameParam} session to ${sid}`)
    }
  }

  private startSignalPeer(sessionId: string, broadcastDc?: RTCDataChannel) {
    let broadcastTimeout: NodeJS.Timeout

    const signalPeer = new SignalPeer()
    signalPeer.onBootstrapReady(() => {
      clearTimeout(broadcastTimeout)
      // bootstrap connected, broadcast self to subs
      const bootSid = signalPeer.getBroadcastSid()
      const signalEvent = SignalPeer.newSignalEvent('waiting', bootSid!)
      const callback = () => {
        broadcastTimeout = setTimeout(() => {
          SignalPeer.send(broadcastDc, signalEvent, callback)
        }, broadcastInterval)
      }
      SignalPeer.send(broadcastDc, signalEvent, callback)
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
      this.config.onChatMessage?.(`${sid} joined`)
      SignalPeer.send(broadcastDc, SignalPeer.newSignalEvent('connected', sid))
    })
    signalPeer.onClose((sid: string) => {
      this.config.onChatMessage?.(`${sid} left`)
      SignalPeer.send(broadcastDc, SignalPeer.newSignalEvent('disconnected', sid))
    })
    signalPeer.onMessage((sid: string, ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'chat') {
        this.config.onChatMessage?.(msg.content, sid)
        // broadcast to all subs
        SignalPeer.send(broadcastDc, ev.data)
      }
      // TODO supoprt rpc
    })
    signalPeer.start().catch((e) => {
      console.log(LOG_TAG, e)
      this.config.onChatMessage?.('signal peer start error')
    })
    this.signalPeer = signalPeer
  }

  getStreamerSid(): string | undefined {
    return this.streamerSid
  }
  
  getStreamerDc(): RTCDataChannel | undefined {
    return this.streamerDc
  }

}
