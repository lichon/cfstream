interface TTSOptions {
  voice?: number;
  rate?: number;
  pitch?: number;
  onEnd?: () => void;
}

export class ChromeTTS {
  private voices: SpeechSynthesisVoice[];
  private currentUtterance: SpeechSynthesisUtterance | null;
  onVoicesLoaded: ((voices: SpeechSynthesisVoice[]) => void) | null;

  constructor() {
    this.voices = [];
    this.currentUtterance = null;
    this.onVoicesLoaded = null;

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

  public speak(text: string, options: TTSOptions = {}): void {
    this.stop();

    const utterance = new SpeechSynthesisUtterance(text);

    if (options.voice !== undefined && this.voices[options.voice]) {
      utterance.voice = this.voices[options.voice];
    }

    if (options.rate !== undefined) {
      utterance.rate = options.rate;
    }

    if (options.pitch !== undefined) {
      utterance.pitch = options.pitch;
    }

    if (options.onEnd) {
      utterance.onend = options.onEnd;
    }

    this.currentUtterance = utterance;
    window.speechSynthesis.speak(utterance);
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

  public isSupported(): boolean {
    return 'speechSynthesis' in window;
  }
}
