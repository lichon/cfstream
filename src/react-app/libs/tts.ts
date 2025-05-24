interface TTSOptions {
  voice?: number;
  rate?: number;
  pitch?: number;
  sinkId?: string;
  mediaStream?: MediaStream;
  onEnd?: () => void;
}

export class ChromeTTS {
  private voices: SpeechSynthesisVoice[];
  onVoicesLoaded: ((voices: SpeechSynthesisVoice[]) => void) | null;
  private audioElement;

  constructor() {
    this.voices = [];
    this.onVoicesLoaded = null;
    this.audioElement = document.createElement('audio');

    if (!ChromeTTS.isSupported()) return;
    window.speechSynthesis.onvoiceschanged = () => {
      this.voices = window.speechSynthesis.getVoices();
      if (this.onVoicesLoaded) {
        this.onVoicesLoaded(this.voices);
      }
    };
  }

  public getVoices(): SpeechSynthesisVoice[] {
    return this.voices;
  }

  private async setSinkId(sinkId: string, mediaStream?: MediaStream): Promise<void> {
    if (!('setSinkId' in HTMLAudioElement.prototype)) {
      console.warn('setSinkId is not supported in this browser.');
      return Promise.resolve();
    }
    if (!mediaStream) {
      return Promise.resolve();
    }

    const audioTrack = mediaStream.getAudioTracks()[0]
    const systemDefaultAudio = new MediaStream();
    systemDefaultAudio.addTrack(audioTrack);

    this.audioElement.srcObject = systemDefaultAudio
    this.audioElement.setSinkId(sinkId).then(() => {
      this.audioElement.play();
    });
  }

  private configureUtterance(utterance: SpeechSynthesisUtterance, options: TTSOptions = {}): void {
    if (this.voices.length > 0) {
      utterance.voice = this.voices[0];
    }
    utterance.rate = 1;
    utterance.pitch = 1;

    if (options.voice !== undefined && this.voices[options.voice]) {
      utterance.voice = this.voices[options.voice];
    }

    if (options.rate !== undefined) {
      utterance.rate = options.rate;
    }

    if (options.pitch !== undefined) {
      utterance.pitch = options.pitch;
    }
  }

  public speak(text: string, options: TTSOptions = {}): void {
    this.stop();
    const utterance = new SpeechSynthesisUtterance(text);
    this.configureUtterance(utterance, options);
    utterance.onend = () => {
      if (this.audioElement.srcObject) {
        setTimeout(() => {
          this.audioElement.pause();
          this.audioElement.srcObject = null;
        }, 500);
      }
      if (options.onEnd) {
        options.onEnd();
      }
    };
    if (options.sinkId !== undefined) {
      this.setSinkId(options.sinkId, options.mediaStream).then(() => {
        window.speechSynthesis.speak(utterance);
      }).catch(error => {
        console.error('Error setting sink ID:', error);
      });
    } else {
      window.speechSynthesis.speak(utterance);
    }
  }

  public pause(): void {
    window.speechSynthesis.pause();
  }

  public resume(): void {
    window.speechSynthesis.resume();
  }

  public stop(): void {
    window.speechSynthesis.cancel();
  }

  static isSupported(): boolean {
    return 'speechSynthesis' in window;
  }
}
