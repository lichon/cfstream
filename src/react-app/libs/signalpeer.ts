import {
  STUN_SERVERS,
  kickSignalSession,
  createSession,
  initDataChannel,
  SignalType,
} from './api'

interface SignalPeerConfig {
  iceServers?: RTCIceServer[];
}

type MessageCallback = (message: MessageEvent) => void;
type StatusCallback = () => void;

export interface SignalEvent {
  type: SignalType;
  content: unknown;
  sender: string;
}

export class SignalPeer {
  private peerConnection: RTCPeerConnection | null = null;
  private config: SignalPeerConfig;
  private signalDc: RTCDataChannel | null;
  private onMessageCallback: MessageCallback | null;
  private onOpenCallback: StatusCallback | null;
  private onCloseCallback: StatusCallback | null;
  private onConnectionStateCallback: StatusCallback | null;
  private remoteSid: string | undefined;
  private sessionId: string | undefined;
  private connected: boolean;

  constructor(config: SignalPeerConfig = { iceServers: STUN_SERVERS }) {
    this.config = config;
    this.peerConnection = null;
    this.signalDc = null;
    this.connected = false;
    this.onMessageCallback = null;
    this.onOpenCallback = null;
    this.onCloseCallback = null;
    this.onConnectionStateCallback = null;
  }

  async connect() {
    const peer = this._initPeer();
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    const res = await createSession(offer.sdp)
    if (!res?.sessionDescription) {
      throw new Error('failed to create session')
    }
    this.sessionId = res?.sessionId
    await peer.setRemoteDescription(res?.sessionDescription.toJSON())
  }

  static async kick(session: string): Promise<boolean> {
    const sdp = (await new RTCPeerConnection().createOffer()).sdp
    const res = await kickSignalSession(session, sdp || '');
    return res.status == 201
  }

  send(event: SignalEvent): boolean {
    if (this.isSubscriber() || !this.signalDc || !this.connected) {
      return false
    }
    if (this.signalDc.readyState == 'open') {
      this.signalDc.send(JSON.stringify(event))
      return true
    }
    return false
  }

  isSubscriber(): boolean {
    return !!this.remoteSid
  }

  isConnected(): boolean {
    return this.connected
  }

  getSessionId(): string | undefined {
    return this.sessionId
  }

  getRemoteSid(): string | undefined {
    return this.remoteSid
  }

  setRemoteSid(sid?: string): void {
    this.remoteSid = sid
  }

  startSignalDc() {
    if (!this.connected || !this.peerConnection) {
      console.error('init signal without connected')
      return
    }
    initDataChannel(this.sessionId || '', this.peerConnection, this.remoteSid, 'signal').then(signalDc => {
      this.signalDc = signalDc
      signalDc.onclose = () => {
        console.log('SignalDc', 'close')
        if (this.onCloseCallback) {
          this.onCloseCallback()
        }
      }
      signalDc.onopen = () => {
        console.log('SignalDc', 'open')
        if (this.onOpenCallback) {
          this.onOpenCallback()
        }
      }
      signalDc.onmessage = (ev) => {
        console.log('SignalDc', `recv ${ev.data}`)
        if (this.onMessageCallback) {
          this.onMessageCallback(ev)
        }
      }
    })
  }

  private _initPeer(): RTCPeerConnection {
    const peer = new RTCPeerConnection(this.config)
    peer.onconnectionstatechange = () => {
      const lastConnected = this.connected
      this.connected = peer.connectionState == 'connected'
      console.log('SignalPeer', `${this.sessionId} ${peer?.connectionState}`)
      if (!this.connected && this.connected != lastConnected) {
        this.close()
      }
      if (this.onConnectionStateCallback && this.connected != lastConnected) {
        this.onConnectionStateCallback()
      }
      if (this.connected && this.getRemoteSid()) {
        this.startSignalDc()
      }
    }
    this.peerConnection = peer
    return peer
  }

  onConnectionStateChanged(callback: StatusCallback): void {
    this.onConnectionStateCallback = callback;
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

  close(callback?: StatusCallback): void {
    if (this.signalDc && this.signalDc.readyState in ['open', 'connecting']) {
      this.signalDc.close()
      this.signalDc = null
    }
    if (this.peerConnection) {
      this.peerConnection.close()
      this.peerConnection = null
      if (callback) callback()
    }
  }
}
