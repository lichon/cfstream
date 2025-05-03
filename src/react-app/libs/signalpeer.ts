import {
  STUN_SERVERS,
  kickSession,
  createSession,
  initDataChannel,
  createDataChannel,
} from './api'

interface DataChannelConfig {
    iceServers?: RTCIceServer[];
}

type MessageCallback = (message: unknown) => void;
type StatusCallback = () => void;

class SignalPeer {
    private peerConnection: RTCPeerConnection;
    private bootstrapDc: RTCDataChannel | null;
    private signalDc: RTCDataChannel | null;
    private onMessageCallback: MessageCallback | null;
    private onOpenCallback: StatusCallback | null;
    private onCloseCallback: StatusCallback | null;
    private onErrorCallback: StatusCallback | null;
    private onConnectionStateCallback: StatusCallback | null;
    private signalDcId: number | null;
    private sessionId: string | undefined;
    private connected: boolean;

    constructor(config: DataChannelConfig = { iceServers: STUN_SERVERS }) {
        this.peerConnection = new RTCPeerConnection(config);
        this.bootstrapDc = (this.peerConnection as never)['bootstrapDc'] as RTCDataChannel;
        this.signalDc = null;
        this.signalDcId = null;
        this.onMessageCallback = null;
        this.onOpenCallback = null;
        this.onCloseCallback = null;
        this.onErrorCallback = null;
        this.onConnectionStateCallback = null;
        this.connected = false;
    }

    async connect() {
        try {
            this._setupDataChannelHandlers();
            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);
            const res = await createSession(offer.sdp)
            if (!res || !res.sessionDescription) {
                this.close()
                return
            }
            this.sessionId = res.sessionId
            await this.peerConnection.setRemoteDescription(res.sessionDescription.toJSON())
        } catch (e) {
            console.log('connect failed', e)
            if (this.onErrorCallback) {
                this.onErrorCallback()
            }
        }
    }

    async kick(session: string) {
        let sdp = this.peerConnection.currentLocalDescription?.sdp
        if (!sdp) {
            sdp = (await this.peerConnection.createOffer()).sdp
        }
        await kickSession(session, sdp || '')
    }

    isConnected(): boolean {
        return this.connected
    }

    getSessionId(): string | undefined {
        return this.sessionId
    }

    initSignalDc() {
        if (!this.connected) return
        if (this.signalDcId) {
            this.signalDc = this.peerConnection.createDataChannel('signal', {
                negotiated: true,
                id: this.signalDcId,
            })
            this.signalDc.onclose = () => {
                console.log('SignalDc', 'close')
            }
            this.signalDc.onopen = () => {
                console.log('SignalDc', 'open')
                if (this.onOpenCallback) {
                    this.onOpenCallback();
                }
            }
            return
        }
        initDataChannel(this.sessionId || '', this.peerConnection, null, 'signal').then(signalDc => {
            this.signalDc = signalDc
            this.signalDcId = signalDc.id
            signalDc.onclose = () => {
                console.log('SignalDc', 'close')
            }
            signalDc.onopen = () => {
                console.log('SignalDc', 'open')
            }
        })
    }

    switchSignalDc() {
        if (this.signalDc) {
            this.signalDc.close()
            this.signalDc = null
        }
    }

    private _setupDataChannelHandlers(): void {
        this.peerConnection.onconnectionstatechange = () => {
            const newConnected = this.peerConnection.connectionState == 'connected'
            console.log('SignalPeer', `connection state ${this.peerConnection.connectionState}`)
            if (this.onConnectionStateCallback && newConnected != this.connected) {
                this.onConnectionStateCallback()
            }
            this.connected = newConnected
            if (this.peerConnection.connectionState == 'failed') {
                this.close()
                if (this.onErrorCallback) {
                    this.onErrorCallback()
                }
            }
        }
        if (!this.bootstrapDc) return;

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
        if (this.bootstrapDc) {
            this.bootstrapDc.close();
        }
        this.peerConnection.close();
    }
}

export default SignalPeer;