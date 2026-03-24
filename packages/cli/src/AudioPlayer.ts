import { RtAudio, RtAudioFormat, RtAudioStreamFlags } from "audify";
import SpeexResampler from "speex-resampler";

const DEVICE_SAMPLE_RATE = 48000;
const FRAME_SIZE = 1024;
const FRAME_BYTES = FRAME_SIZE * 2 * 2; // stereo Int16
const MAX_BUFFER_BYTES = DEVICE_SAMPLE_RATE * 4; // 1 second
const RESAMPLER_QUALITY = 7; // 1-10, 7 = default balance

export class AudioPlayer {
  private rtAudio: RtAudio;
  private playing = false;
  private volume = 1.0;
  private pending: Buffer = Buffer.alloc(0);
  private resampler: SpeexResampler | null = null;
  private inputRate: number;

  constructor(inputRate: number = 12000) {
    this.rtAudio = new RtAudio();
    this.inputRate = inputRate;
  }

  async start(): Promise<void> {
    if (this.playing) return;

    // Wait for WASM to be ready
    await SpeexResampler.initPromise;

    // Mono, inputRate -> 48kHz, quality 7
    this.resampler = new SpeexResampler(
      1,
      this.inputRate,
      DEVICE_SAMPLE_RATE,
      RESAMPLER_QUALITY
    );

    const defaultOut = this.rtAudio.getDefaultOutputDevice();
    const devices = this.rtAudio.getDevices();
    console.log(
      `[audio] Output device: #${defaultOut} - ${devices[defaultOut]?.name}`
    );

    this.rtAudio.openStream(
      { deviceId: defaultOut, nChannels: 2 },
      null,
      RtAudioFormat.RTAUDIO_SINT16,
      DEVICE_SAMPLE_RATE,
      FRAME_SIZE,
      "openwebrx-client",
      null,
      null,
      RtAudioStreamFlags.RTAUDIO_SCHEDULE_REALTIME
    );
    this.rtAudio.start();
    this.playing = true;
    this.pending = Buffer.alloc(0);
  }

  stop(): void {
    if (!this.playing) return;
    this.playing = false;
    try {
      this.rtAudio.stop();
      this.rtAudio.closeStream();
    } catch {
      // ignore
    }
    this.pending = Buffer.alloc(0);
    this.resampler = null;
  }

  /** Reset resampler state (e.g. after profile switch). */
  async resetResampler(): Promise<void> {
    await SpeexResampler.initPromise;
    this.resampler = new SpeexResampler(
      1,
      this.inputRate,
      DEVICE_SAMPLE_RATE,
      RESAMPLER_QUALITY
    );
    this.pending = Buffer.alloc(0);
  }

  /** Push mono Int16 PCM samples (at inputRate) for playback. */
  async push(samples: Int16Array): Promise<void> {
    if (!this.playing || samples.length === 0 || !this.resampler) return;

    // Convert Int16Array to Buffer for speex-resampler
    const inputBuf = Buffer.from(
      samples.buffer,
      samples.byteOffset,
      samples.byteLength
    );

    // Resample: inputRate -> 48kHz (speex maintains cross-chunk state)
    const resampledMono = await this.resampler.processChunk(inputBuf);
    if (resampledMono.length === 0) return;

    // Apply volume and convert mono -> stereo
    const stereo = this.monoToStereo(resampledMono);
    this.pending = Buffer.concat([this.pending, stereo]);

    // Drop oldest data if buffer exceeds max
    if (this.pending.length > MAX_BUFFER_BYTES) {
      const excess = this.pending.length - MAX_BUFFER_BYTES;
      const dropBytes = Math.ceil(excess / FRAME_BYTES) * FRAME_BYTES;
      this.pending = this.pending.subarray(dropBytes);
    }

    // Write complete frames to audio device
    while (this.pending.length >= FRAME_BYTES) {
      const frame = this.pending.subarray(0, FRAME_BYTES);
      this.pending = this.pending.subarray(FRAME_BYTES);
      try {
        this.rtAudio.write(Buffer.from(frame));
      } catch {
        // ignore
      }
    }
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
  }

  getVolume(): number {
    return this.volume;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  /** Convert mono Int16 buffer to interleaved stereo Int16 buffer, applying volume. */
  private monoToStereo(mono: Buffer): Buffer {
    const sampleCount = mono.length / 2; // Int16 = 2 bytes
    const stereo = Buffer.alloc(sampleCount * 4); // 2 channels * 2 bytes
    const vol = this.volume;

    for (let i = 0; i < sampleCount; i++) {
      let sample = mono.readInt16LE(i * 2);
      if (vol < 1.0) {
        sample = Math.max(
          -32768,
          Math.min(32767, Math.round(sample * vol))
        );
      }
      const offset = i * 4;
      stereo.writeInt16LE(sample, offset); // left
      stereo.writeInt16LE(sample, offset + 2); // right
    }

    return stereo;
  }
}
