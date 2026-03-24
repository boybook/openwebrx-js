export function formatFrequency(hz: number): string {
  if (hz >= 1e9) return `${(hz / 1e9).toFixed(6)} GHz`;
  if (hz >= 1e6) return `${(hz / 1e6).toFixed(3)} MHz`;
  if (hz >= 1e3) return `${(hz / 1e3).toFixed(3)} kHz`;
  return `${hz} Hz`;
}

/** Convert raw linear smeter value (from server) to dB. */
export function smeterToDB(value: number): number {
  if (value <= 0) return -150;
  return 10 * Math.log10(value);
}

export function formatSmeter(dbfs: number): string {
  let sUnit: string;
  if (dbfs <= -127) {
    sUnit = "S0";
  } else if (dbfs <= -73) {
    const s = Math.floor((dbfs + 127) / 6);
    sUnit = `S${Math.min(s, 9)}`;
  } else {
    const over = Math.round(dbfs + 73);
    sUnit = `S9+${over}`;
  }

  const normalized = Math.max(0, Math.min(1, (dbfs + 130) / 80));
  const barLen = Math.round(normalized * 30);
  const bar = "\u2588".repeat(barLen) + "\u2591".repeat(30 - barLen);

  return `${sUnit.padEnd(6)} [${bar}] ${dbfs.toFixed(1)} dBFS`;
}

export function parseFrequency(input: string): number | null {
  const cleaned = input.trim().toLowerCase();
  const match = cleaned.match(/^([\d.]+)\s*(ghz|mhz|khz|hz)?$/);
  if (!match) return null;

  const num = parseFloat(match[1]);
  if (isNaN(num)) return null;

  const unit = match[2] || "hz";
  switch (unit) {
    case "ghz":
      return num * 1e9;
    case "mhz":
      return num * 1e6;
    case "khz":
      return num * 1e3;
    default:
      return num;
  }
}
