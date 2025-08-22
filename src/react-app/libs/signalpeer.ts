import { getConfig } from '../config'
import {
  kickSignalSession,
  createSession,
  requestDataChannel,
} from './api'

let debug = getConfig().debug
const broadcastInterval = getConfig().stream.broadcastInterval
const SIGNAL_LABEL = getConfig().stream.signalLabel;
const STUN_SERVERS = getConfig().api.stunServers;
const SIGNAL_TAG = 'SignalPeer';
const DC_TAG = 'SignalDc';

const OriginalRTCPeerConnection = window.RTCPeerConnection;
export const patchRTCPeerConnection = () => {
  // Create a new constructor function that wraps the original
  const patchedConstructor: typeof RTCPeerConnection = function (
    this: RTCPeerConnection,
    configuration?: RTCConfiguration
  ) {
    const peer = new OriginalRTCPeerConnection(configuration)
    const bootstrapDc = peer.createDataChannel('bootstrap')
    Object.defineProperty(peer, 'bootstrapDc', {
      enumerable: true,
      configurable: false,
      get: () => bootstrapDc,
      set: (_v) => { throw new Error('cannot set bootstrap dc') }
    })
    return peer
  } as never

  // Copy over the prototype and static methods
  patchedConstructor.prototype = OriginalRTCPeerConnection.prototype
  patchedConstructor.generateCertificate = OriginalRTCPeerConnection.generateCertificate

  // Replace the global RTCPeerConnection
  window.RTCPeerConnection = patchedConstructor;
  console.log('peerconnection patched')
}

type MessageCallback = (sid: string, message: MessageEvent) => void;
type StatusCallback = (sid: string) => void;
type NotifyCallback = () => void;

type SignalMessageType = 'signal' | 'chat' | 'rpc';
type SignalStatus = 'waiting' | 'connected' | 'disconnected';

export interface SignalEvent {
  sid: string;
  status: SignalStatus;
}

export interface SignalMessage {
  type: SignalMessageType;
  content: unknown;
  sender?: string;
}

export class SignalPeer {
  private config: RTCConfiguration;
  private bootstrapPeer: RTCPeerConnection | null = null;
  private signalPeer: RTCPeerConnection | null = null;
  private signalDcMap: Map<string, RTCDataChannel> = new Map<string, RTCDataChannel>();
  private onMessageCallback: MessageCallback | null = null;
  private onOpenCallback: StatusCallback | null = null;
  private onCloseCallback: StatusCallback | null = null;
  private onBootstrapCallback: NotifyCallback | null = null;
  private onBootstrapKickedCallback: NotifyCallback | null = null;

  private bootstrapSid: string | undefined;
  private signalSid: string | undefined;
  private closed: boolean = false;

  constructor(config: RTCConfiguration = { iceServers: STUN_SERVERS }) {
    this.config = config;
  }

  static label = SIGNAL_LABEL

  static newSignalEvent(status: string, sid: string): SignalMessage {
    return {
      type: 'signal',
      content: {
        sid: sid,
        status: status
      } as SignalEvent
    }
  }

  static newChatMsg(text: string, sender?: string): SignalMessage {
    return {
      type: 'chat',
      content: text,
      sender: sender,
    }
  }

  static async kickSignal(session: string): Promise<boolean> {
    const tmpPeer = new RTCPeerConnection()
    try {
      const sdp = (await tmpPeer.createOffer()).sdp
      const res = await kickSignalSession(session, sdp || '')
      return res.status == 201
    } finally {
      tmpPeer.close()
    }
  }

  static enableDebug(enable: boolean) {
    debug = enable
  }

  static send(dc?: RTCDataChannel, msg?: SignalMessage, callback?: () => void) {
    if (dc && dc.readyState == 'open') { const msgString = typeof msg === 'string' ? msg : JSON.stringify(msg)
      dc.send(msgString)
      if (debug) console.log(DC_TAG, `send >>>`, msgString)
      if (callback) callback()
    }
  }

  async start() {
    await this.startSignal()
    await this.startBootstrap()
  }

  getBroadcastSid(): string | undefined {
    return this.bootstrapSid
  }

  // create new signal dc subs to remote session
  async newSignalDc(remoteSid: string) {
    if (!this.signalPeer || !this.signalSid) {
      console.log(DC_TAG, 'signal peer not ready')
      return
    }
    if (this.signalDcMap.has(remoteSid)) {
      return
    }

    console.log(DC_TAG, `request new signalDc for ${remoteSid}`)
    const signalDc = await requestDataChannel(
      this.signalSid,
      this.signalPeer,
      remoteSid,
      SignalPeer.label
    )

    if (this.signalDcMap.has(remoteSid)) {
      const oldDc = this.signalDcMap.get(remoteSid)
      oldDc?.close()
      console.log(DC_TAG, `close old signalDc for ${remoteSid}`)
    }
    this.signalDcMap.set(remoteSid, signalDc)
    if (!signalDc.id) {
      // skip closed remote dc, but keep them in dc map
      return
    }

    signalDc.onclose = () => {
      console.log(DC_TAG, remoteSid, 'close')
      if (this.onCloseCallback) {
        this.onCloseCallback(remoteSid)
      }
    }
    signalDc.onopen = () => {
      console.log(DC_TAG, remoteSid, 'open')
      if (this.onOpenCallback) {
        this.onOpenCallback(remoteSid)
      }
    }
    signalDc.onmessage = (ev) => {
      if (debug) console.log(DC_TAG, remoteSid, `recv <<< ${ev.data}`)
      if (this.onMessageCallback) {
        this.onMessageCallback(remoteSid, ev)
      }
    }
  }

  private async startBootstrap() {
    let lastConnected = false
    const peer = new RTCPeerConnection(this.config)
    const connected = new Promise((resolve, reject) => {
      peer.onconnectionstatechange = () => {
        console.log(SIGNAL_TAG, `bootstrap ${this.bootstrapSid} ${peer.connectionState}`)
        if (peer.connectionState == 'failed') {
          reject()
          return
        }

        if (peer.connectionState == 'connected') {
          lastConnected = true
          resolve(undefined)
          if (this.onBootstrapCallback) this.onBootstrapCallback()
        } else if (lastConnected) {
          this.bootstrapSid = undefined
          this.bootstrapPeer = null
          // restart
          peer.close()
          setTimeout(() => this.startBootstrap(), broadcastInterval)
          // callback
          if (this.onBootstrapKickedCallback) this.onBootstrapKickedCallback()
        }
      }
    })

    await peer.setLocalDescription(await peer.createOffer())
    const res = await createSession(peer.localDescription?.sdp)
    if (!res?.sessionDescription) {
      peer.close()
      throw new Error('failed to create session')
    }
    this.bootstrapSid = res?.sessionId
    await peer.setRemoteDescription(res?.sessionDescription.toJSON())
    await connected
    this.bootstrapPeer = peer
    if (this.closed)
      peer.close()
  }

  private async startSignal() {
    let lastConnected = false
    const peer = new RTCPeerConnection(this.config)
    const connected = new Promise((resolve, reject) => {
      peer.onconnectionstatechange = () => {
        console.log(SIGNAL_TAG, `signal ${this.signalSid} ${peer.connectionState}`)
        if (peer.connectionState == 'failed') {
          reject()
          return
        }

        if (peer.connectionState == 'connected') {
          lastConnected = true
          resolve(undefined)
        } else if (lastConnected) {
          this.signalDcMap.forEach(dc => dc.close())
          this.signalDcMap.clear()
          // restart
          peer.close()
          setTimeout(() => this.startSignal())
        }
      }
    })

    await peer.setLocalDescription(await peer.createOffer())
    const res = await createSession(peer.localDescription?.sdp)
    if (!res?.sessionDescription) {
      peer.close()
      throw new Error('failed to create session')
    }
    this.signalSid = res?.sessionId
    await peer.setRemoteDescription(res?.sessionDescription.toJSON())
    await connected
    this.signalPeer = peer
    if (this.closed)
      peer.close()
  }

  onBootstrapReady(callback: NotifyCallback): void {
    this.onBootstrapCallback = callback
  }

  onBootstrapKicked(callback: NotifyCallback): void {
    this.onBootstrapKickedCallback = callback
  }

  onMessage(callback: MessageCallback): void {
    this.onMessageCallback = callback;
  }

  onOpen(callback: StatusCallback): void {
    this.onOpenCallback = callback;
  }

  onClose(callback: StatusCallback): void {
    this.onCloseCallback = callback;
  }

  // activeSid would expire in server side
  clearInvalidDc(activeSids: string[]) {
    const activeSet = new Set<string>(activeSids)
    const keysToDel: string[] = []
    this.signalDcMap.forEach((v, k) => {
      if (v.readyState == 'closed' && !activeSet.has(k))
        keysToDel.push(k)
    })
    keysToDel.forEach(k => {
      this.signalDcMap.delete(k)
    })
  }

  close(): void {
    console.log(SIGNAL_LABEL, 'close')
    if (this.closed) return
    this.closed = true
    // do not notify user if close by self
    this.onCloseCallback = null
    this.signalDcMap.forEach(dc => dc.close())
    this.signalDcMap.clear()
    // close peers
    if (this.bootstrapPeer) {
      this.bootstrapPeer.close()
      this.bootstrapPeer = null
    }
    if (this.signalPeer) {
      this.signalPeer.close()
      this.signalPeer = null
    }
  }
}
