import { getConfig } from '../config'
import {
  kickSignalSession,
  createSession,
  initDataChannel as requestDataChannel,
} from './api'

const broadcastInterval = getConfig().stream.broadcastInterval
const SIGNAL_LABEL = getConfig().stream.signalLabel;
const STUN_SERVERS = getConfig().api.stunServers;
const BOOT_TAG = 'BootstrapPeer';
const SIGNAL_TAG = 'SignalPeer';
const DC_TAG = 'SignalDc';

const OriginalRTCPeerConnection = window.RTCPeerConnection;

type MessageCallback = (sid: string, message: MessageEvent) => void;
type StatusCallback = (sid: string) => void;
type NotifyCallback = () => void;

type SignalMessageType = 'signal' | 'chat' | 'rpc';
type SignalStatus = 'waiting' | 'connected' | 'disonnected';

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
  private bootstrapPeer: RTCPeerConnection;
  private signalPeer: RTCPeerConnection;
  private signalDcMap: Map<string, RTCDataChannel> = {} as Map<string, RTCDataChannel>;
  private onMessageCallback: MessageCallback | null = null;
  private onOpenCallback: StatusCallback | null = null;
  private onCloseCallback: StatusCallback | null = null;
  private onBootstrapCallback: NotifyCallback | null = null;
  private onBootstrapKickedCallback: NotifyCallback | null = null;

  private bootstrapSid: string | undefined;
  private bootstrapConnected: boolean = false;
  private signalSid: string | undefined;
  private signalConnected: boolean = false;
  private closed: boolean = false;

  constructor(config: RTCConfiguration = { iceServers: STUN_SERVERS }) {
    this.config = config;
    this.bootstrapPeer = new RTCPeerConnection(config);
    this.signalPeer = new RTCPeerConnection(config);
  }

  static label = SIGNAL_LABEL

  static patchPeerConnection() {
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
  }

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

  static async kick(session: string): Promise<boolean> {
    const tmpPeer = new RTCPeerConnection()
    try {
      const sdp = (await tmpPeer.createOffer()).sdp
      const res = await kickSignalSession(session, sdp || '')
      return res.status == 201
    } finally {
      tmpPeer.close()
    }
  }

  async start() {
    this.startBootstrap()
    this.startSignal()
  }

  isConnected(): boolean {
    return this.bootstrapConnected
  }

  getSessionId(): string | undefined {
    return this.bootstrapSid
  }

  newSignalDc(remoteSid: string) {
    if (this.signalConnected) {
      console.error(DC_TAG, 'new signal dc without connected')
      return
    }
    if (this.signalDcMap.has(remoteSid)) {
      return
    }
    requestDataChannel(this.bootstrapSid!,
      this.signalPeer,
      remoteSid,
      SignalPeer.label
    ).then(signalDc => {
      if (this.signalDcMap.has(remoteSid)) {
        signalDc.close()
        return
      }

      this.signalDcMap.set(remoteSid, signalDc)
      signalDc.onclose = () => {
        console.log(DC_TAG, 'close')
        if (this.onCloseCallback) {
          this.onCloseCallback(remoteSid)
        }
      }
      signalDc.onopen = () => {
        console.log(DC_TAG, 'open')
        if (this.onOpenCallback) {
          this.onOpenCallback(remoteSid)
        }
      }
      signalDc.onmessage = (ev) => {
        console.log(DC_TAG, `recv ${ev.data}`)
        if (this.onMessageCallback) {
          this.onMessageCallback(remoteSid, ev)
        }
      }
    })
  }

  private async startBootstrap() {
    if (this.bootstrapConnected)
      return

    const peer = this.bootstrapPeer
    peer.onconnectionstatechange = () => {
      console.log(BOOT_TAG, `${peer.connectionState}`)

      const lastConnected = this.bootstrapConnected
      this.bootstrapConnected = peer.connectionState == 'connected'
      const changed = lastConnected != this.bootstrapConnected

      if (changed) {
        if (this.bootstrapConnected) {
          if (this.onBootstrapCallback) this.onBootstrapCallback()
        } else {
          if (this.onBootstrapKickedCallback) this.onBootstrapKickedCallback()
          // todo restart
          peer.close()
          this.bootstrapPeer = new RTCPeerConnection(this.config)
          setTimeout(() => this.startBootstrap(), broadcastInterval)
        }
      }
    }

    const offer = await peer.createOffer()
    await peer.setLocalDescription(offer)
    const res = await createSession(offer.sdp)
    if (!res?.sessionDescription) {
      throw new Error('failed to create session')
    }
    this.bootstrapSid = res?.sessionId
    await peer.setRemoteDescription(res?.sessionDescription.toJSON())
  }

  private async startSignal() {
    const peer = this.signalPeer
    peer.onconnectionstatechange = () => {
      console.log(SIGNAL_TAG, `${peer.connectionState}`)

      const lastConnected = this.signalConnected
      this.signalConnected = peer.connectionState == 'connected'
      const changed = lastConnected != this.signalConnected

      if (this.signalConnected != lastConnected) {
        // TODO
      }
      if (lastConnected && changed) {
        // restart bootstarp peer
      }
    }

    const offer = await peer.createOffer()
    await peer.setLocalDescription(offer)
    const res = await createSession(offer.sdp)
    if (!res?.sessionDescription) {
      throw new Error('failed to create session')
    }
    this.signalSid = res?.sessionId
    await peer.setRemoteDescription(res?.sessionDescription.toJSON())
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

  clearInvalidDc(activeSids: string[]) {
    const activeSet = new Set<string>(activeSids)
    const keysToDel: string[] = []
    this.signalDcMap.forEach((v, k) => {
      if (activeSet.has(k)) return
      keysToDel.push(k)
      v.close()
    })
    keysToDel.forEach(k => {
      this.signalDcMap.delete(k)
    })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    // do not notify user if close by self
    this.onCloseCallback = null
    this.signalDcMap.forEach(dc => dc.close())
    this.signalDcMap.clear()
    // close peers
    this.bootstrapPeer.close()
    this.signalPeer.close()
  }
}
