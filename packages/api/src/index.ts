export { OpenWebRXClient } from "./OpenWebRXClient";
export { AudioBuffer } from "./AudioBuffer";
export { AdpcmDecoder } from "./AdpcmDecoder";
export * from "./types";
export * from "./protocol";

/**
 * Fetch the current online user count from an OpenWebRX server via HTTP.
 * Does not require a WebSocket connection.
 * @param serverUrl - Base URL of the server, e.g. "http://localhost:8073" or "ws://localhost:8073"
 */
export async function fetchClientCount(serverUrl: string): Promise<number> {
  const httpUrl = serverUrl
    .replace(/^ws(s?):\/\//, "http$1://")
    .replace(/\/$/, "");
  const res = await fetch(`${httpUrl}/metrics.json`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { openwebrx?: { users?: number } };
  const count = data?.openwebrx?.users;
  if (typeof count !== "number") throw new Error("Unexpected metrics format");
  return count;
}
