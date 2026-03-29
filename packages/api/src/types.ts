export interface ServerConfig {
  samp_rate?: number;
  center_freq?: number;
  start_mod?: string;
  start_freq?: number;
  start_offset_freq?: number;
  audio_compression?: "adpcm" | "none";
  fft_compression?: "adpcm" | "none";
  fft_size?: number;
  sdr_id?: string;
  profile_id?: string;
  initial_squelch_level?: number;
  tuning_step?: number;
  tuning_precision?: number;
  allow_center_freq_changes?: boolean;
  allow_audio_recording?: boolean;
  allow_chat?: boolean;
  waterfall_auto_level_default_mode?: string;
  [key: string]: unknown;
}

export interface Profile {
  id: string; // "sdr_id|profile_id"
  name: string;
}

export interface Mode {
  modulation: string;
  name: string;
  type: "analog" | "digimode";
  requirements?: string[];
  squelch?: boolean;
  bandpass?: { low_cut: number; high_cut: number };
  underlying?: string[];
}

export interface ReceiverDetails {
  name?: string;
  admin?: string;
  gps?: { lat: number; lon: number };
  asl?: number;
  photo_title?: string;
  photo_desc?: string;
  [key: string]: unknown;
}

export interface ConnectionOptions {
  url: string; // e.g. "ws://localhost:8073"
  outputRate?: number; // default 12000
  hdOutputRate?: number; // default 44100
}

export interface DspParams {
  offset_freq?: number;
  mod?: string;
  low_cut?: number;
  high_cut?: number;
  squelch_level?: number;
  secondary_mod?: string | false;
  secondary_offset_freq?: number;
  dmr_filter?: number;
}

export interface SecondaryDspConfig {
  secondary_fft_size?: number;
  if_samp_rate?: number;
  [key: string]: unknown;
}

export interface OpenWebRXSpectrumFrame {
  bins: Float32Array;
  fftSize: number | null;
  centerFreq: number | null;
  sampleRate: number | null;
  compression: "adpcm" | "none";
  timestamp: number;
  isSecondary?: boolean;
  secondaryMode?: string | false | null;
  secondaryOffsetFreq?: number | null;
  tunedFrequency?: number | null;
  ifSampleRate?: number | null;
  lowCut?: number | null;
  highCut?: number | null;
  absoluteRange?: { min: number; max: number } | null;
  rawBinCount?: number;
}

export type ClientEventMap = {
  connected: [version: string];
  disconnected: [code: number, reason: string];
  config: [config: ServerConfig];
  profiles: [profiles: Profile[]];
  modes: [modes: Mode[]];
  smeter: [level: number];
  audio: [pcmData: Int16Array];
  hdAudio: [pcmData: Int16Array];
  fft: [frame: OpenWebRXSpectrumFrame];
  secondaryFft: [frame: OpenWebRXSpectrumFrame];
  secondaryConfig: [config: SecondaryDspConfig];
  receiverDetails: [details: ReceiverDetails];
  log: [message: string];
  error: [error: Error];
  metadata: [data: Record<string, unknown>];
  secondaryDemod: [data: Record<string, unknown>];
  backoff: [reason: string];
  clients: [count: number];
};
