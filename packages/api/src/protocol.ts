export const HANDSHAKE_CLIENT = "SERVER DE CLIENT client=openwebrx-client type=receiver";
export const HANDSHAKE_SERVER_PREFIX = "CLIENT DE SERVER";

export enum BinaryOpcode {
  FFT = 0x01,
  AUDIO = 0x02,
  SECONDARY_FFT = 0x03,
  HD_AUDIO = 0x04,
}

export const DEFAULT_OUTPUT_RATE = 12000;
export const DEFAULT_HD_OUTPUT_RATE = 44100;
