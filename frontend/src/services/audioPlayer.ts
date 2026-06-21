const CROSSFADE_MS = 2_000;
const BLUETOOTH_BUFFER_MS = 150;

export class AudioPlayerService {
  private static instance: AudioPlayerService;
  private ctx: AudioContext | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private currentGain: GainNode | null = null;

  static getInstance(): AudioPlayerService {
    if (!AudioPlayerService.instance) {
      AudioPlayerService.instance = new AudioPlayerService();
    }
    return AudioPlayerService.instance;
  }

  private getContext(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') {
      this.ctx = new AudioContext();
    }
    return this.ctx;
  }

  private async fetchBuffer(uri: string): Promise<AudioBuffer> {
    const ctx = this.getContext();
    const res = await fetch(uri);
    if (!res.ok) throw new Error(`Audio fetch failed: ${res.status}`);
    const raw = await res.arrayBuffer();
    return ctx.decodeAudioData(raw);
  }

  async play(uri: string): Promise<void> {
    this.stop();
    const ctx = this.getContext();
    if (ctx.state === 'suspended') await ctx.resume();

    const buffer = await this.fetchBuffer(uri);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(1, ctx.currentTime);
    gain.connect(ctx.destination);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    source.start(ctx.currentTime + BLUETOOTH_BUFFER_MS / 1000);

    this.currentSource = source;
    this.currentGain = gain;
  }

  async crossfadeTo(nextUri: string, durationMs: number = CROSSFADE_MS): Promise<void> {
    const ctx = this.getContext();
    if (ctx.state === 'suspended') await ctx.resume();

    const durationSec = durationMs / 1000;

    // Fetch first — then compute timing from fresh ctx.currentTime
    const buffer = await this.fetchBuffer(nextUri);
    const startAt = ctx.currentTime + BLUETOOTH_BUFFER_MS / 1000;

    if (this.currentGain && this.currentSource) {
      this.currentGain.gain.setValueAtTime(this.currentGain.gain.value, ctx.currentTime);
      this.currentGain.gain.linearRampToValueAtTime(0, startAt + durationSec);
      const dyingSource = this.currentSource;
      setTimeout(
        () => { try { dyingSource.stop(); } catch { /* already ended */ } },
        BLUETOOTH_BUFFER_MS + durationMs + 200
      );
    }

    const nextGain = ctx.createGain();
    nextGain.gain.setValueAtTime(0, ctx.currentTime);
    nextGain.gain.linearRampToValueAtTime(1, startAt + durationSec);
    nextGain.connect(ctx.destination);

    const nextSource = ctx.createBufferSource();
    nextSource.buffer = buffer;
    nextSource.connect(nextGain);
    nextSource.start(startAt);

    this.currentSource = nextSource;
    this.currentGain = nextGain;
  }

  stop(): void {
    if (this.currentGain) {
      this.currentGain.gain.setValueAtTime(0, this.getContext().currentTime);
    }
    try { this.currentSource?.stop(); } catch { /* already stopped */ }
    this.currentSource = null;
    this.currentGain = null;
  }
}

export const audioPlayer = AudioPlayerService.getInstance();
