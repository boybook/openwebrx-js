import { EventEmitter } from "events";
import WebSocket from "ws";
import { AdpcmDecoder } from "./AdpcmDecoder";
import { AudioBuffer } from "./AudioBuffer";
import {
  HANDSHAKE_CLIENT,
  HANDSHAKE_SERVER_PREFIX,
  BinaryOpcode,
  DEFAULT_OUTPUT_RATE,
  DEFAULT_HD_OUTPUT_RATE,
} from "./protocol";
import type {
  ConnectionOptions,
  ServerConfig,
  Profile,
  Mode,
  DspParams,
  OpenWebRXSpectrumFrame,
  SecondaryDspConfig,
} from "./types";

const COMPRESS_FFT_PAD_N = 10;

export class OpenWebRXClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private config: ServerConfig = {};
  private profiles: Profile[] = [];
  private modes: Mode[] = [];
  private adpcmAudioDecoder = new AdpcmDecoder();
  private adpcmHdDecoder = new AdpcmDecoder();
  private adpcmFftDecoder = new AdpcmDecoder();
  private audioCompression: "adpcm" | "none" = "adpcm";
  private fftCompression: "adpcm" | "none" = "none";
  private outputRate: number;
  private hdOutputRate: number;
  private url: string;
  private serverVersion = "";
  private dspStarted = false;
  private clientCount = 0;
  private pendingProfileSwitch = false;
  private audioBuffer: AudioBuffer;
  private hdAudioBuffer: AudioBuffer;
  private secondaryConfig: SecondaryDspConfig = {};
  /** DSP params explicitly set by the user; persisted across profile switches. */
  private userDspParams: DspParams = {};

  constructor(options: ConnectionOptions) {
    super();
    this.url = options.url.replace(/\/$/, "");
    this.outputRate = options.outputRate ?? DEFAULT_OUTPUT_RATE;
    this.hdOutputRate = options.hdOutputRate ?? DEFAULT_HD_OUTPUT_RATE;
    this.audioBuffer = new AudioBuffer(this.outputRate);
    this.hdAudioBuffer = new AudioBuffer(this.hdOutputRate);
  }

  connect(): Promise<string> {
    return new Promise((resolve, reject) => {
      const wsUrl = `${this.url}/ws/`;
      this.ws = new WebSocket(wsUrl);

      let handshakeDone = false;

      this.ws.on("open", () => {
        this.ws!.send(HANDSHAKE_CLIENT);
      });

      this.ws.on("message", (data: WebSocket.RawData, isBinary: boolean) => {
        if (isBinary) {
          this.handleBinaryMessage(data as Buffer);
          return;
        }

        const text = data.toString();

        if (!handshakeDone) {
          if (text.startsWith(HANDSHAKE_SERVER_PREFIX)) {
            handshakeDone = true;
            const match = text.match(/version=(\S+)/);
            this.serverVersion = match ? match[1] : "unknown";
            this.sendConnectionProperties();
            this.emit("connected", this.serverVersion);
            resolve(this.serverVersion);
          }
          return;
        }

        this.handleTextMessage(text);
      });

      this.ws.on("close", (code: number, reason: Buffer) => {
        this.emit("disconnected", code, reason.toString());
      });

      this.ws.on("error", (err: Error) => {
        this.emit("error", err);
        if (!handshakeDone) reject(err);
      });

      this.ws.on("ping", () => {
        this.ws?.pong();
      });
    });
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  getServerVersion(): string {
    return this.serverVersion;
  }

  getAudioBuffer(): AudioBuffer {
    return this.audioBuffer;
  }

  getHdAudioBuffer(): AudioBuffer {
    return this.hdAudioBuffer;
  }

  startDsp(): void {
    this.sendJson({ type: "dspcontrol", action: "start" });
    this.dspStarted = true;
  }

  setDspParams(params: DspParams): void {
    Object.assign(this.userDspParams, params);
    this.sendJson({ type: "dspcontrol", params });
  }

  resetDspParams(): void {
    this.userDspParams = {};
  }

  setFrequency(absoluteHz: number): void {
    const centerFreq = this.config.center_freq ?? 0;
    const offset = absoluteHz - centerFreq;
    this.setDspParams({ offset_freq: offset });
  }

  setCenterFrequency(hz: number): void {
    this.sendJson({ type: "setfrequency", params: { frequency: hz } });
  }

  setModulation(mod: string): void {
    const params: DspParams = { mod };
    const mode = this.modes.find((m) => m.modulation === mod);
    if (mode?.bandpass) {
      params.low_cut = mode.bandpass.low_cut;
      params.high_cut = mode.bandpass.high_cut;
    }
    this.setDspParams(params);
  }

  setSquelch(level: number): void {
    this.setDspParams({ squelch_level: level });
  }

  setBandpass(lowCut: number, highCut: number): void {
    this.setDspParams({ low_cut: lowCut, high_cut: highCut });
  }

  setSecondaryDemod(mod: string | false): void {
    this.setDspParams({ secondary_mod: mod });
  }

  setSecondaryOffsetFrequency(offsetHz: number): void {
    this.setDspParams({ secondary_offset_freq: offsetHz });
  }

  enableDigitalDetailSpectrum(options: { mode: "ft8" | "ft4"; offsetHz: number }): void {
    this.setDspParams({
      secondary_mod: options.mode,
      secondary_offset_freq: options.offsetHz,
    });
  }

  disableDigitalDetailSpectrum(): void {
    this.setDspParams({ secondary_mod: false });
  }

  selectProfile(profileId: string): void {
    this.pendingProfileSwitch = true;
    this.sendJson({ type: "selectprofile", params: { profile: profileId } });
  }

  getProfiles(): Profile[] {
    return this.profiles;
  }

  getModes(): Mode[] {
    return this.modes;
  }

  getConfig(): ServerConfig {
    return { ...this.config };
  }

  getSecondaryConfig(): SecondaryDspConfig {
    return { ...this.secondaryConfig };
  }

  getOutputRate(): number {
    return this.outputRate;
  }

  getClientCount(): number {
    return this.clientCount;
  }

  private sendConnectionProperties(): void {
    this.sendJson({
      type: "connectionproperties",
      params: {
        output_rate: this.outputRate,
        hd_output_rate: this.hdOutputRate,
      },
    });
  }

  private sendJson(obj: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  private handleTextMessage(text: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }

    const type = msg.type as string;
    const value = msg.value;

    switch (type) {
      case "config": {
        const incoming = value as ServerConfig;
        Object.assign(this.config, incoming);

        if (incoming.audio_compression !== undefined) {
          this.audioCompression = incoming.audio_compression as "adpcm" | "none";
        }
        if (incoming.fft_compression !== undefined) {
          this.fftCompression = incoming.fft_compression as "adpcm" | "none";
        }

        if (this.pendingProfileSwitch && this.dspStarted) {
          this.pendingProfileSwitch = false;
          this.adpcmAudioDecoder.reset();
          this.adpcmHdDecoder.reset();
          this.adpcmFftDecoder.reset();
          this.audioBuffer.clear();
          this.hdAudioBuffer.clear();

          const profileParams: DspParams = {};
          if (incoming.start_mod) profileParams.mod = incoming.start_mod;
          if (incoming.start_offset_freq !== undefined) {
            profileParams.offset_freq = incoming.start_offset_freq;
          }
          if (incoming.initial_squelch_level !== undefined) {
            profileParams.squelch_level = incoming.initial_squelch_level;
          }

          const mergedParams: DspParams = { ...profileParams, ...this.userDspParams };

          this.startDsp();
          if (Object.keys(mergedParams).length > 0) {
            this.sendJson({ type: "dspcontrol", params: mergedParams });
          }
        }

        this.emit("config", { ...this.config });
        break;
      }

      case "profiles":
        this.profiles = value as Profile[];
        this.emit("profiles", this.profiles);
        break;

      case "modes":
        this.modes = value as Mode[];
        this.emit("modes", this.modes);
        break;

      case "smeter":
        this.emit("smeter", value as number);
        break;

      case "receiver_details":
        this.emit("receiverDetails", value);
        break;

      case "metadata":
        this.emit("metadata", value);
        break;

      case "secondary_demod":
        this.emit("secondaryDemod", value);
        break;

      case "secondary_config":
        this.secondaryConfig = {
          ...this.secondaryConfig,
          ...(value as SecondaryDspConfig),
        };
        this.emit("secondaryConfig", { ...this.secondaryConfig });
        break;

      case "log_message":
        this.emit("log", value as string);
        break;

      case "sdr_error":
        this.emit("error", new Error(`SDR error: ${value}`));
        break;

      case "demodulator_error":
        this.emit("error", new Error(`Demodulator error: ${value}`));
        break;

      case "clients":
        this.clientCount = value as number;
        this.emit("clients", this.clientCount);
        break;

      case "backoff":
        this.emit("backoff", (msg as Record<string, unknown>).reason as string);
        break;

      default:
        break;
    }
  }

  private handleBinaryMessage(data: Buffer): void {
    if (data.length < 2) return;

    const opcode = data[0];
    const payload = data.subarray(1);

    switch (opcode) {
      case BinaryOpcode.AUDIO:
        this.handleAudio(payload, this.adpcmAudioDecoder, this.audioBuffer, "audio");
        break;

      case BinaryOpcode.HD_AUDIO:
        this.handleAudio(payload, this.adpcmHdDecoder, this.hdAudioBuffer, "hdAudio");
        break;

      case BinaryOpcode.FFT:
        this.handleSpectrum(payload, "fft");
        break;

      case BinaryOpcode.SECONDARY_FFT:
        this.handleSpectrum(payload, "secondaryFft");
        break;
    }
  }

  private handleAudio(
    payload: Buffer,
    decoder: AdpcmDecoder,
    buffer: AudioBuffer,
    event: "audio" | "hdAudio"
  ): void {
    let pcm: Int16Array;

    if (this.audioCompression === "adpcm") {
      const uint8 = new Uint8Array(payload.buffer, payload.byteOffset, payload.length);
      pcm = decoder.decodeWithSync(uint8);
    } else {
      const aligned = payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.length);
      pcm = new Int16Array(aligned);
    }

    if (pcm.length > 0) {
      buffer.write(pcm);
      this.emit(event, pcm);
    }
  }

  private handleSpectrum(payload: Buffer, event: "fft" | "secondaryFft"): void {
    const decodedBins = this.decodeSpectrum(payload);
    if (!decodedBins || decodedBins.length === 0) return;

    const frame = event === "secondaryFft"
      ? this.buildSecondarySpectrumFrame(decodedBins)
      : this.buildPrimarySpectrumFrame(decodedBins);

    this.emit(event, frame);
  }

  private buildPrimarySpectrumFrame(bins: Float32Array): OpenWebRXSpectrumFrame {
    return {
      bins,
      fftSize: this.config.fft_size ?? bins.length,
      centerFreq: this.config.center_freq ?? null,
      sampleRate: this.config.samp_rate ?? null,
      compression: this.fftCompression,
      timestamp: Date.now(),
      isSecondary: false,
      tunedFrequency: this.getCurrentTunedFrequency(),
      rawBinCount: bins.length,
      absoluteRange: this.getPrimaryAbsoluteRange(),
    };
  }

  private buildSecondarySpectrumFrame(decodedBins: Float32Array): OpenWebRXSpectrumFrame {
    const rawBinCount = decodedBins.length;
    const tunedFrequency = this.getCurrentTunedFrequency();
    const secondaryMode = this.userDspParams.secondary_mod ?? null;
    const secondaryOffsetFreq = this.userDspParams.secondary_offset_freq ?? null;
    const lowCut = typeof this.userDspParams.low_cut === "number" ? this.userDspParams.low_cut : null;
    const highCut = typeof this.userDspParams.high_cut === "number" ? this.userDspParams.high_cut : null;
    const ifSampleRate = typeof this.secondaryConfig.if_samp_rate === "number" ? this.secondaryConfig.if_samp_rate : null;

    let bins = decodedBins;
    let centerFreq = tunedFrequency;
    let sampleRate = ifSampleRate;
    let absoluteRange: { min: number; max: number } | null = null;

    if (
      tunedFrequency !== null &&
      ifSampleRate !== null &&
      lowCut !== null &&
      highCut !== null &&
      highCut > lowCut
    ) {
      const visibleBins = this.cropSecondarySpectrum(decodedBins, ifSampleRate, lowCut, highCut);
      bins = visibleBins.length > 0 ? visibleBins : decodedBins;
      centerFreq = tunedFrequency + (lowCut + highCut) / 2;
      sampleRate = highCut - lowCut;
      absoluteRange = {
        min: tunedFrequency + lowCut,
        max: tunedFrequency + highCut,
      };
    }

    return {
      bins,
      fftSize: this.secondaryConfig.secondary_fft_size ?? bins.length,
      centerFreq,
      sampleRate,
      compression: this.fftCompression,
      timestamp: Date.now(),
      isSecondary: true,
      secondaryMode,
      secondaryOffsetFreq,
      tunedFrequency,
      ifSampleRate,
      lowCut,
      highCut,
      absoluteRange,
      rawBinCount,
    };
  }

  private cropSecondarySpectrum(
    decodedBins: Float32Array,
    ifSampleRate: number,
    lowCut: number,
    highCut: number,
  ): Float32Array {
    if (decodedBins.length === 0 || ifSampleRate <= 0) {
      return decodedBins;
    }

    const halfSpan = ifSampleRate / 2;
    const startRatio = (lowCut + halfSpan) / ifSampleRate;
    const endRatio = (highCut + halfSpan) / ifSampleRate;
    const startIndex = Math.max(0, Math.floor(startRatio * decodedBins.length));
    const endIndex = Math.min(decodedBins.length, Math.ceil(endRatio * decodedBins.length));

    if (endIndex <= startIndex) {
      return new Float32Array(0);
    }

    return decodedBins.slice(startIndex, endIndex);
  }

  private getCurrentTunedFrequency(): number | null {
    const centerFreq = this.config.center_freq;
    const offsetFreq = this.userDspParams.offset_freq ?? this.config.start_offset_freq;

    if (typeof centerFreq !== "number" || typeof offsetFreq !== "number") {
      return null;
    }

    return centerFreq + offsetFreq;
  }

  private getPrimaryAbsoluteRange(): { min: number; max: number } | null {
    const centerFreq = this.config.center_freq;
    const sampleRate = this.config.samp_rate;

    if (typeof centerFreq !== "number" || typeof sampleRate !== "number") {
      return null;
    }

    return {
      min: centerFreq - sampleRate / 2,
      max: centerFreq + sampleRate / 2,
    };
  }

  private decodeSpectrum(payload: Buffer): Float32Array | null {
    if (this.fftCompression === "none") {
      const aligned = payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.length);
      return new Float32Array(aligned);
    }

    if (this.fftCompression === "adpcm") {
      this.adpcmFftDecoder.reset();
      const uint8 = new Uint8Array(payload.buffer, payload.byteOffset, payload.length);
      const decoded = this.adpcmFftDecoder.decode(uint8);
      const decodedLength = Math.max(0, decoded.length - COMPRESS_FFT_PAD_N);
      const bins = new Float32Array(decodedLength);
      for (let i = 0; i < decodedLength; i++) {
        bins[i] = decoded[i + COMPRESS_FFT_PAD_N] / 100;
      }
      return bins;
    }

    return null;
  }
}
