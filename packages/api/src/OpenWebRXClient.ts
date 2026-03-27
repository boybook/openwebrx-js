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
} from "./types";

export class OpenWebRXClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private config: ServerConfig = {};
  private profiles: Profile[] = [];
  private modes: Mode[] = [];
  private adpcmAudioDecoder = new AdpcmDecoder();
  private adpcmHdDecoder = new AdpcmDecoder();
  private audioCompression: "adpcm" | "none" = "adpcm";
  private outputRate: number;
  private hdOutputRate: number;
  private url: string;
  private serverVersion = "";
  private dspStarted = false;
  private clientCount = 0;
  private pendingProfileSwitch = false;
  private audioBuffer: AudioBuffer;
  private hdAudioBuffer: AudioBuffer;
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

  // --- Audio Buffer Access ---

  /** Get the audio ring buffer for reading decoded PCM samples. */
  getAudioBuffer(): AudioBuffer {
    return this.audioBuffer;
  }

  /** Get the HD audio ring buffer for reading decoded PCM samples. */
  getHdAudioBuffer(): AudioBuffer {
    return this.hdAudioBuffer;
  }

  // --- DSP Control ---

  startDsp(): void {
    this.sendJson({ type: "dspcontrol", action: "start" });
    this.dspStarted = true;
  }

  setDspParams(params: DspParams): void {
    // Accumulate user-set params so they survive profile switches.
    Object.assign(this.userDspParams, params);
    this.sendJson({ type: "dspcontrol", params });
  }

  /** Clear all user-set DSP overrides (e.g. after manually selecting a new profile). */
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

  // --- Profile Control ---

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

  getOutputRate(): number {
    return this.outputRate;
  }

  getClientCount(): number {
    return this.clientCount;
  }

  // --- Internal ---

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
          this.audioCompression = incoming.audio_compression as
            | "adpcm"
            | "none";
        }

        if (this.pendingProfileSwitch && this.dspStarted) {
          this.pendingProfileSwitch = false;
          this.adpcmAudioDecoder.reset();
          this.adpcmHdDecoder.reset();
          this.audioBuffer.clear();
          this.hdAudioBuffer.clear();

          // Profile defaults (lowest priority)
          const profileParams: DspParams = {};
          if (incoming.start_mod) profileParams.mod = incoming.start_mod;
          if (incoming.start_offset_freq !== undefined)
            profileParams.offset_freq = incoming.start_offset_freq;
          if (incoming.initial_squelch_level !== undefined)
            profileParams.squelch_level = incoming.initial_squelch_level;

          // User-set params override profile defaults (highest priority)
          const mergedParams: DspParams = { ...profileParams, ...this.userDspParams };

          this.startDsp();
          if (Object.keys(mergedParams).length > 0) {
            // Send directly — these are not new user choices, don't update userDspParams
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
        this.emit(
          "backoff",
          (msg as Record<string, unknown>).reason as string
        );
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
        this.handleAudio(
          payload,
          this.adpcmAudioDecoder,
          this.audioBuffer,
          "audio"
        );
        break;

      case BinaryOpcode.HD_AUDIO:
        this.handleAudio(
          payload,
          this.adpcmHdDecoder,
          this.hdAudioBuffer,
          "hdAudio"
        );
        break;

      case BinaryOpcode.FFT:
      case BinaryOpcode.SECONDARY_FFT:
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
      const uint8 = new Uint8Array(
        payload.buffer,
        payload.byteOffset,
        payload.length
      );
      pcm = decoder.decodeWithSync(uint8);
    } else {
      const aligned = payload.buffer.slice(
        payload.byteOffset,
        payload.byteOffset + payload.length
      );
      pcm = new Int16Array(aligned);
    }

    if (pcm.length > 0) {
      buffer.write(pcm);
      this.emit(event, pcm);
    }
  }
}
