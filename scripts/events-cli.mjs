// Vault event notification CLI (S4): subscribe to an Obsidian event stream and
// print payloads. Powers the "wiki 编译结果通知" and general vault-change alerts.
// Usage: OBSIDIAN_API_KEY=... node scripts/events-cli.mjs <create|modify|delete> [seconds]

import { subscribeVaultEvent, streamEvents } from "../src/obsidian/events.js";

async function main() {
  const apiKey = process.env.OBSIDIAN_API_KEY;
  const event = process.argv[2] ?? "modify";
  const seconds = Number(process.argv[3] ?? 15);
  if (!["create", "modify", "delete"].includes(event)) {
    console.error("events-cli: <event> must be create, modify, or delete");
    process.exitCode = 1;
    return;
  }
  if (!Number.isFinite(seconds) || seconds <= 0) {
    console.error("events-cli: <seconds> must be a positive number");
    process.exitCode = 1;
    return;
  }
  if (!apiKey) {
    console.error("usage: OBSIDIAN_API_KEY=... node scripts/events-cli.mjs <create|modify|delete> [seconds]");
    process.exitCode = 1;
    return;
  }
  const baseUrl = process.env.OBSIDIAN_BASE_URL ?? "https://127.0.0.1:27124";
  try {
    const sub = await subscribeVaultEvent({ baseUrl, apiKey, event });
    console.log(`subscribed ${event} (${sub.id}); listening ${seconds}s`);
    await streamEvents(sub.url, { onEvent: (d) => console.log(`[${event}] ${d}`), stopMs: seconds * 1000 });
  } catch (err) {
    console.error("events-cli: " + (err instanceof Error ? err.message : String(err)));
    process.exitCode = 1;
  }
}

import { pathToFileURL } from "node:url";
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
