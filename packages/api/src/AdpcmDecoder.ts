const IMA_INDEX_TABLE = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];

const IMA_STEP_TABLE = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41,
  45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209,
  230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876,
  963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024,
  3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493,
  10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086,
  29794, 32767,
];

// ASCII codes for "SYNC"
const SYNC_CHAR_CODES = [0x53, 0x59, 0x4e, 0x43];

export class AdpcmDecoder {
  private stepIndex = 0;
  private predictor = 0;
  private step = 0;
  private synchronized = 0;
  private phase = 0;
  private syncBuffer = new Uint8Array(4);
  private syncBufferIndex = 0;
  private syncCounter = 0;

  reset(): void {
    this.stepIndex = 0;
    this.predictor = 0;
    this.step = 0;
    this.synchronized = 0;
    this.phase = 0;
    this.syncBufferIndex = 0;
    this.syncCounter = 0;
  }

  /** Decode ADPCM data without SYNC markers (for FFT data). */
  decode(data: Uint8Array): Int16Array {
    const output = new Int16Array(data.length * 2);
    for (let i = 0; i < data.length; i++) {
      output[i * 2] = this.decodeNibble(data[i] & 0x0f);
      output[i * 2 + 1] = this.decodeNibble((data[i] >> 4) & 0x0f);
    }
    return output;
  }

  /** Decode ADPCM data with embedded SYNC markers (for audio data). */
  decodeWithSync(data: Uint8Array): Int16Array {
    const output = new Int16Array(data.length * 2);
    let oi = 0;

    for (let index = 0; index < data.length; index++) {
      switch (this.phase) {
        case 0:
          // Search for sync word "SYNC"
          if (data[index] !== SYNC_CHAR_CODES[this.synchronized++]) {
            this.synchronized = 0;
          }
          if (this.synchronized === 4) {
            this.syncBufferIndex = 0;
            this.phase = 1;
          }
          break;

        case 1:
          // Read 4-byte codec state (stepIndex: Int16LE, predictor: Int16LE)
          this.syncBuffer[this.syncBufferIndex++] = data[index];
          if (this.syncBufferIndex === 4) {
            const view = new DataView(this.syncBuffer.buffer);
            this.stepIndex = view.getInt16(0, true);
            this.predictor = view.getInt16(2, true);
            this.syncCounter = 1000;
            this.phase = 2;
          }
          break;

        case 2:
          // Decode audio samples
          output[oi++] = this.decodeNibble(data[index] & 0x0f);
          output[oi++] = this.decodeNibble(data[index] >> 4);
          if (this.syncCounter-- === 0) {
            this.synchronized = 0;
            this.phase = 0;
          }
          break;
      }
    }

    return output.slice(0, oi);
  }

  private decodeNibble(nibble: number): number {
    this.stepIndex += IMA_INDEX_TABLE[nibble];
    this.stepIndex = Math.min(Math.max(this.stepIndex, 0), 88);

    let diff = this.step >> 3;
    if (nibble & 1) diff += this.step >> 2;
    if (nibble & 2) diff += this.step >> 1;
    if (nibble & 4) diff += this.step;
    if (nibble & 8) diff = -diff;

    this.predictor += diff;
    this.predictor = Math.min(Math.max(this.predictor, -32768), 32767);

    this.step = IMA_STEP_TABLE[this.stepIndex];

    return this.predictor;
  }
}
