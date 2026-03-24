#!/usr/bin/env node

import readline from "readline";
import { OpenWebRXClient } from "@openwebrx-js/api";
import { AudioPlayer } from "./AudioPlayer";
import { handleCommand, CliContext } from "./commands";
import { formatFrequency, smeterToDB } from "./display";

function parseArgs(): { url: string } {
  const args = process.argv.slice(2);
  let url = "ws://localhost:8073";

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "--url" || args[i] === "-u") && args[i + 1]) {
      url = args[++i];
    } else if (!args[i].startsWith("-")) {
      url = args[i];
    }
  }

  if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
    url = `ws://${url}`;
  }

  return { url };
}

async function main() {
  const { url } = parseArgs();

  console.log(`OpenWebRX+ CLI Client`);
  console.log(`Connecting to ${url} ...`);

  const client = new OpenWebRXClient({ url });
  const player = new AudioPlayer();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "owrx> ",
  });

  const ctx: CliContext = {
    client,
    player,
    lastSmeter: -130,
  };

  let ready = false;

  client.on("config", (config) => {
    if (config.center_freq) {
      console.log(
        `\n[config] Center: ${formatFrequency(config.center_freq)} | ` +
          `SDR: ${config.sdr_id} | Profile: ${config.profile_id} | ` +
          `Mod: ${config.start_mod || "?"}`
      );
      if (ready) rl.prompt(true);
    }
  });

  client.on("profiles", (profiles) => {
    console.log(
      `\n[profiles] ${profiles.length} profile(s) available. Type "profiles" to list.`
    );
    if (ready) rl.prompt(true);
  });

  client.on("smeter", (level) => {
    ctx.lastSmeter = smeterToDB(level);
  });

  client.on("audio", (pcm) => {
    player.push(pcm).catch(() => {});
  });

  client.on("hdAudio", (pcm) => {
    player.push(pcm).catch(() => {});
  });

  client.on("log", (msg) => {
    console.log(`\n[server] ${msg}`);
    if (ready) rl.prompt(true);
  });

  client.on("error", (err) => {
    console.error(`\n[error] ${err.message}`);
    if (ready) rl.prompt(true);
  });

  client.on("disconnected", (code, reason) => {
    console.log(
      `\nDisconnected (code=${code}${reason ? `, reason=${reason}` : ""})`
    );
    player.stop();
    process.exit(0);
  });

  client.on("backoff", (reason) => {
    console.log(`\n[backoff] Server busy: ${reason}`);
    if (ready) rl.prompt(true);
  });

  try {
    const version = await client.connect();
    console.log(`Connected! Server version: ${version}`);
  } catch (err) {
    console.error(`Failed to connect: ${(err as Error).message}`);
    process.exit(1);
  }

  client.startDsp();
  await player.start();
  ready = true;
  console.log(`Audio playback started. Type "help" for commands.\n`);

  rl.prompt();

  rl.on("line", (line) => {
    const shouldContinue = handleCommand(line, ctx);
    if (!shouldContinue) {
      console.log("Bye!");
      player.stop();
      client.disconnect();
      process.exit(0);
    }
    rl.prompt();
  });

  rl.on("close", () => {
    player.stop();
    client.disconnect();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
