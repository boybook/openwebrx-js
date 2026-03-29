# openwebrx-js

A Node.js/TypeScript client library and CLI tool for [OpenWebRX+](https://github.com/luarvique/openwebrx) SDR receivers. Connect to any OpenWebRX+ server via WebSocket, receive real-time audio streams, and control the receiver — all without a web browser.

## Packages

This is a monorepo with two packages:

### `@openwebrx-js/api`

Pure TypeScript API client library with **zero native dependencies** (only `ws`). Designed to be embedded into other Node.js applications.

Features:
- WebSocket connection with automatic handshake
- Real-time audio stream (PCM Int16) via events or ring buffer
- Real-time FFT spectrum stream from the main receiver and secondary waterfall
- Explicit FT8/FT4 secondary demodulator control for fine spectrum
- ADPCM decoding (ported from the OpenWebRX+ frontend)
- Full receiver control: frequency tuning, modulation, profile switching, squelch, bandpass
- Automatic DSP restart on profile/SDR device changes

### `@openwebrx-js/cli`

Interactive command-line client with real-time audio playback via [audify](https://github.com/nickarora/audify) (RtAudio bindings). Uses `@openwebrx-js/api` under the hood.

## Quick Start

### CLI Usage

```bash
# Install dependencies
npm install

# Run the CLI (development mode)
npm run dev -- --url ws://your-server:8073

# Or build and run
npm run build
node packages/cli/dist/index.js --url ws://your-server:8073
```

### CLI Commands

| Command | Description |
|---------|-------------|
| `profiles` | List available SDR profiles |
| `profile <n\|id>` | Switch profile (by index or full ID) |
| `tune <freq>` | Set frequency (e.g. `14.074mhz`, `7200khz`) |
| `center <freq>` | Set SDR center frequency |
| `mod <mode>` | Set modulation (`am`, `fm`, `usb`, `lsb`, `cw`, etc.) |
| `squelch <level>` | Set squelch level in dBFS |
| `bandpass <low> <high>` | Set filter bandpass in Hz |
| `volume <0-100>` | Set playback volume |
| `modes` | List available modulation modes |
| `info` | Show current configuration |
| `smeter` | Show signal strength |
| `help` | Show help |
| `quit` | Exit |

### API Usage

```typescript
import { OpenWebRXClient } from "@openwebrx-js/api";

const client = new OpenWebRXClient({ url: "ws://your-server:8073" });

await client.connect();
client.startDsp();

// Listen for decoded audio (mono Int16 PCM at 12kHz)
client.on("audio", (pcm: Int16Array) => {
  // Process audio data...
});

// Listen for full FFT waterfall rows
client.on("fft", (frame) => {
  console.log(frame.centerFreq, frame.sampleRate, frame.bins.length);
});

// Listen for FT8/FT4 fine spectrum rows from the secondary demodulator
client.on("secondaryFft", (frame) => {
  console.log(frame.secondaryMode, frame.absoluteRange, frame.bins.length);
});

// Control the receiver
client.selectProfile("sdr_id|profile_id");
client.setFrequency(14074000);
client.setModulation("usb");
client.setSquelch(-80);
client.enableDigitalDetailSpectrum({ mode: "ft8", offsetHz: 1500 });

// Or use the ring buffer for pull-based access
const buffer = client.getAudioBuffer();
const samples = buffer.read(1024); // read up to 1024 samples
```

## Architecture

```
@openwebrx-js/api (no native deps)
  ├── OpenWebRXClient    WebSocket client, protocol handling, event emitter
  ├── AudioBuffer        Ring buffer for PCM audio (write by client, read by consumer)
  ├── AdpcmDecoder       IMA ADPCM decoder with SYNC marker support
  ├── protocol           Binary opcodes, handshake constants
  └── types              TypeScript interfaces

@openwebrx-js/cli (depends on @openwebrx-js/api + audify)
  ├── AudioPlayer        Resampling (12kHz→48kHz), stereo conversion, RtAudio output
  ├── commands           Interactive command parser
  └── display            S-meter formatting, frequency display
```

## Important Notes

- **Profile switching is manual.** The server does not auto-select profiles based on frequency. You must switch to the appropriate profile first, then tune.
- **Audio buffer strategy:** Max 1 second buffer. When the buffer is full, oldest samples are dropped to keep latency bounded (same strategy as the OpenWebRX+ web frontend).
- **Bot detection:** The server tracks rapid profile changes. Avoid switching profiles faster than once every few seconds.
- **WSJT fine spectrum:** FT8/FT4 detail spectrum is enabled by sending `secondary_mod` and `secondary_offset_freq`. Use `enableDigitalDetailSpectrum()` / `disableDigitalDetailSpectrum()` and subscribe to `secondaryConfig` plus `secondaryFft`.

## Requirements

- Node.js 16+
- For CLI audio playback: a working audio output device (macOS, Linux, Windows supported via RtAudio)

## License

MIT
