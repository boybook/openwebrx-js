import { OpenWebRXClient } from "@openwebrx-js/api";
import { AudioPlayer } from "./AudioPlayer";
import { formatFrequency, formatSmeter, parseFrequency } from "./display";

export interface CliContext {
  client: OpenWebRXClient;
  player: AudioPlayer;
  lastSmeter: number;
}

const HELP_TEXT = `
Commands:
  profiles              List available profiles
  profile <n|id>        Switch profile (by index or full ID like "sdr_id|profile_id")
  tune <freq>           Set absolute frequency (e.g. "14.074mhz", "7200khz", "145800000")
  center <freq>         Set center frequency (changes SDR hardware frequency)
  mod <mode>            Set modulation (am, fm, usb, lsb, cw, etc.)
  squelch <level>       Set squelch level in dBFS (e.g. -80)
  bandpass <low> <high> Set filter bandpass in Hz (e.g. "300 3000")
  volume <0-100>        Set playback volume
  modes                 List available modulation modes
  info                  Show current configuration
  smeter                Show current S-meter reading
  help                  Show this help
  quit / exit           Exit
`.trim();

export function handleCommand(line: string, ctx: CliContext): boolean {
  const parts = line.trim().split(/\s+/);
  if (parts.length === 0 || parts[0] === "") return true;

  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);

  switch (cmd) {
    case "help":
    case "?":
      console.log(HELP_TEXT);
      break;

    case "profiles": {
      const profiles = ctx.client.getProfiles();
      if (profiles.length === 0) {
        console.log("No profiles available yet.");
      } else {
        const config = ctx.client.getConfig();
        const currentId = `${config.sdr_id}|${config.profile_id}`;
        profiles.forEach((p, i) => {
          const marker = p.id === currentId ? " <--" : "";
          console.log(`  [${i}] ${p.name} (${p.id})${marker}`);
        });
      }
      break;
    }

    case "profile": {
      if (args.length < 1) {
        console.log("Usage: profile <index|id>");
        break;
      }
      const profiles = ctx.client.getProfiles();
      const idx = parseInt(args[0], 10);
      let profileId: string;

      if (!isNaN(idx) && idx >= 0 && idx < profiles.length) {
        profileId = profiles[idx].id;
      } else {
        profileId = args[0];
      }

      console.log(`Switching to profile: ${profileId}`);
      ctx.client.selectProfile(profileId);
      break;
    }

    case "tune": {
      if (args.length < 1) {
        console.log("Usage: tune <frequency> (e.g. 14.074mhz, 7200khz)");
        break;
      }
      const freq = parseFrequency(args[0]);
      if (freq === null) {
        console.log("Invalid frequency format.");
        break;
      }
      console.log(`Tuning to ${formatFrequency(freq)}`);
      ctx.client.setFrequency(freq);
      break;
    }

    case "center": {
      if (args.length < 1) {
        console.log("Usage: center <frequency>");
        break;
      }
      const freq = parseFrequency(args[0]);
      if (freq === null) {
        console.log("Invalid frequency format.");
        break;
      }
      console.log(`Setting center frequency to ${formatFrequency(freq)}`);
      ctx.client.setCenterFrequency(freq);
      break;
    }

    case "mod": {
      if (args.length < 1) {
        console.log("Usage: mod <modulation> (am, fm, usb, lsb, cw, etc.)");
        break;
      }
      console.log(`Setting modulation: ${args[0]}`);
      ctx.client.setModulation(args[0]);
      break;
    }

    case "squelch": {
      if (args.length < 1) {
        console.log("Usage: squelch <level_dbfs> (e.g. -80)");
        break;
      }
      const level = parseFloat(args[0]);
      if (isNaN(level)) {
        console.log("Invalid squelch level.");
        break;
      }
      console.log(`Setting squelch: ${level} dBFS`);
      ctx.client.setSquelch(level);
      break;
    }

    case "bandpass": {
      if (args.length < 2) {
        console.log("Usage: bandpass <low_hz> <high_hz> (e.g. 300 3000)");
        break;
      }
      const low = parseInt(args[0], 10);
      const high = parseInt(args[1], 10);
      if (isNaN(low) || isNaN(high)) {
        console.log("Invalid bandpass values.");
        break;
      }
      console.log(`Setting bandpass: ${low} - ${high} Hz`);
      ctx.client.setBandpass(low, high);
      break;
    }

    case "volume": {
      if (args.length < 1) {
        console.log(
          `Current volume: ${Math.round(ctx.player.getVolume() * 100)}%`
        );
        break;
      }
      const vol = parseInt(args[0], 10);
      if (isNaN(vol) || vol < 0 || vol > 100) {
        console.log("Volume must be 0-100.");
        break;
      }
      ctx.player.setVolume(vol / 100);
      console.log(`Volume: ${vol}%`);
      break;
    }

    case "modes": {
      const modes = ctx.client.getModes();
      if (modes.length === 0) {
        console.log("No modes available yet.");
      } else {
        modes.forEach((m) => {
          console.log(`  ${m.modulation.padEnd(10)} ${m.name} (${m.type})`);
        });
      }
      break;
    }

    case "info": {
      const config = ctx.client.getConfig();
      console.log(`Server version: ${ctx.client.getServerVersion()}`);
      console.log(
        `SDR: ${config.sdr_id || "?"} | Profile: ${config.profile_id || "?"}`
      );
      console.log(`Center freq: ${formatFrequency(config.center_freq || 0)}`);
      console.log(`Sample rate: ${config.samp_rate || "?"}`);
      console.log(`Modulation: ${config.start_mod || "?"}`);
      console.log(`Audio compression: ${config.audio_compression || "?"}`);
      console.log(`Volume: ${Math.round(ctx.player.getVolume() * 100)}%`);
      break;
    }

    case "smeter":
      console.log(formatSmeter(ctx.lastSmeter));
      break;

    case "quit":
    case "exit":
      return false;

    default:
      console.log(`Unknown command: ${cmd}. Type "help" for commands.`);
  }

  return true;
}
