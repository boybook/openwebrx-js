/**
 * Ring buffer for PCM audio samples (Int16, mono).
 * The API layer writes decoded audio into this buffer;
 * consumers (e.g. an audio player) read from it.
 *
 * When the buffer is full, oldest samples are silently dropped
 * to keep latency bounded (same strategy as the original OpenWebRX+ frontend).
 */
export class AudioBuffer {
  private buffer: Int16Array;
  private capacity: number;
  private readPos = 0;
  private writePos = 0;
  private count = 0;

  /**
   * @param sampleRate  Expected input sample rate (used to compute capacity)
   * @param maxDurationMs  Maximum buffer duration in milliseconds (default 1000)
   */
  constructor(sampleRate: number = 12000, maxDurationMs: number = 1000) {
    this.capacity = Math.ceil((sampleRate * maxDurationMs) / 1000);
    this.buffer = new Int16Array(this.capacity);
  }

  /** Write samples into the buffer. Drops oldest data if full. */
  write(samples: Int16Array): void {
    let toWrite = samples;

    // If incoming data is larger than capacity, keep only the tail
    if (toWrite.length >= this.capacity) {
      toWrite = toWrite.subarray(toWrite.length - this.capacity);
      this.readPos = 0;
      this.writePos = 0;
      this.count = 0;
    }

    // If not enough space, advance readPos to make room (drop old data)
    const spaceNeeded = toWrite.length;
    const spaceAvailable = this.capacity - this.count;
    if (spaceNeeded > spaceAvailable) {
      const toDrop = spaceNeeded - spaceAvailable;
      this.readPos = (this.readPos + toDrop) % this.capacity;
      this.count -= toDrop;
    }

    // Write data, handling wrap-around
    for (let i = 0; i < toWrite.length; i++) {
      this.buffer[this.writePos] = toWrite[i];
      this.writePos = (this.writePos + 1) % this.capacity;
    }
    this.count += toWrite.length;
  }

  /**
   * Read up to maxSamples from the buffer.
   * Returns null if no data is available.
   */
  read(maxSamples: number): Int16Array | null {
    if (this.count === 0) return null;

    const toRead = Math.min(maxSamples, this.count);
    const result = new Int16Array(toRead);

    for (let i = 0; i < toRead; i++) {
      result[i] = this.buffer[this.readPos];
      this.readPos = (this.readPos + 1) % this.capacity;
    }
    this.count -= toRead;

    return result;
  }

  /** Number of samples available for reading. */
  available(): number {
    return this.count;
  }

  /** Clear the buffer. */
  clear(): void {
    this.readPos = 0;
    this.writePos = 0;
    this.count = 0;
  }
}
