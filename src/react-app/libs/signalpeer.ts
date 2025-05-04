import {
  STUN_SERVERS,
  kickSession,
  createSession,
  initDataChannel,
} from './api'

interface DataChannelConfig {
    iceServers?: RTCIceServer[];
}

interface SignalEvent {
    type: string;
    event: unknown;
}

type MessageCallback = (message: unknown) => void;
type StatusCallback = () => void;

class SignalPeer {
    private peerConnection: RTCPeerConnection | null = null;
    private bootstrapDc: RTCDataChannel | null;
    private config: DataChannelConfig;
    private signalDc: RTCDataChannel | null;
    private onMessageCallback: MessageCallback | null;
    private onOpenCallback: StatusCallback | null;
    private onCloseCallback: StatusCallback | null;
    private onErrorCallback: StatusCallback | null;
    private onConnectionStateCallback: StatusCallback | null;
    private remoteSid: string | undefined;
    private sessionId: string | undefined;
    private connected: boolean;

    constructor(config: DataChannelConfig = { iceServers: STUN_SERVERS }) {
        this.config = config;
        this.peerConnection = null;
        this.bootstrapDc = null;
        this.signalDc = null;
        this.onMessageCallback = null;
        this.onOpenCallback = null;
        this.onCloseCallback = null;
        this.onErrorCallback = null;
        this.onConnectionStateCallback = null;
        this.connected = false;
    }

    async connect() {
        try {
            this.peerConnection = new RTCPeerConnection(this.config);
            this.bootstrapDc = (this.peerConnection as never)['bootstrapDc'] as RTCDataChannel;
            this._setupDataChannelHandlers();
            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);
            const res = await createSession(offer.sdp)
            if (!res?.sessionDescription) {
                throw new Error('failed to create session')
            }

            this.sessionId = res?.sessionId
            await this.peerConnection.setRemoteDescription(res?.sessionDescription.toJSON())
        } catch (e) {
            console.log('connect failed', e)
            if (this.onErrorCallback) {
                this.onErrorCallback()
            }
        }
    }

    static async kick(session: string) {
        const sdp = (await new RTCPeerConnection().createOffer()).sdp
        await kickSession(session, sdp || '');
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

    initSignalDc(remoteSid: string | undefined) {
        if (!this.connected || !this.peerConnection) return
        this.remoteSid = remoteSid
        initDataChannel(this.sessionId || '', this.peerConnection, remoteSid, 'signal').then(signalDc => {
            this.signalDc = signalDc
            signalDc.onclose = () => {
                console.log('SignalDc', 'close')
            }
            signalDc.onopen = () => {
                console.log('SignalDc', 'open')
            }
        })
    }

    publishEvent(signal: SignalEvent): boolean {
        if (this.isSubscriber() || !this.signalDc || !this.connected) {
            return false
        }
        if (this.signalDc.readyState == 'open') {
            this.signalDc.send(JSON.stringify(signal))
            return true
        }
        return false
    } 

    private _setupDataChannelHandlers(): void {
        if (!this.peerConnection) return

        const peer = this.peerConnection
        peer.onconnectionstatechange = () => {
            const lastConnected = this.connected
            this.connected = peer.connectionState == 'connected'
            console.log('SignalPeer', `connection state ${peer?.connectionState}`)
            if (this.onConnectionStateCallback && this.connected != lastConnected) {
                this.onConnectionStateCallback()
            }
            if (peer.connectionState == 'failed') {
                this.close()
                if (this.onErrorCallback) {
                    this.onErrorCallback()
                }
            }
        }

        if (!this.bootstrapDc) return

        this.bootstrapDc.onmessage = (event: MessageEvent) => {
            console.log('SignalPeer', 'message')
            if (this.onMessageCallback) {
                this.onMessageCallback(event.data);
            }
        };

        this.bootstrapDc.onopen = () => {
            this.connected = true
            console.log('SignalPeer', 'open')
            if (this.onOpenCallback) {
                this.onOpenCallback();
            }
            // this.initSignalDc()
        };

        this.bootstrapDc.onclose = () => {
            this.connected = false
            console.log('SignalPeer', 'close')
            if (this.onCloseCallback) {
                this.onCloseCallback();
            }
        };
    }

    onConnectionStateChanged(callback: StatusCallback): void {
        this.onConnectionStateCallback = callback;
    }

    onError(callback: StatusCallback): void {
        this.onErrorCallback = callback;
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

    close(): void {
        this.bootstrapDc?.close();
        if (this.peerConnection) {
            this.peerConnection.close();
        }
    }
}

export default SignalPeer;