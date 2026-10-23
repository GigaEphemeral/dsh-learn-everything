// P2 end-to-end: trigger karpathywiki ingest and block until pages appear.
// Usage: OBSIDIAN_API_KEY=... node scripts/p2-ingest-wait.mjs <vault-relative-source-path>
import { ObsidianClient, ObsidianAdapter } from "../src/obsidian/obsidian-adapter.js";
import { McpClient } from "../src/obsidian/mcp-client.js";
import { KarpathyDriver } from "../src/wiki/karpathy-driver.js";

const apiKey = process.env.OBSIDIAN_API_KEY;
const sourcePath = process.argv[2];
if (!apiKey || !sourcePath) {
  console.error("usage: OBSIDIAN_API_KEY=... node scripts/p2-ingest-wait.mjs <sourcePath>");
  process.exit(1);
}
const baseUrl = "https://127.0.0.1:27124";
const client = new ObsidianClient({ baseUrl, apiKey });
const adapter = new ObsidianAdapter(client);
const mcp = new McpClient({ baseUrl, apiKey });
const driver = new KarpathyDriver({ adapter, mcp, timeoutMs: 15 * 60 * 1000, pollIntervalMs: 10000 });
const snapshot = await driver.snapshotWiki();
console.log("before:", JSON.stringify({ sources: [...snapshot["wiki/sources"]] }));
await driver.openAndIngest(sourcePath);
console.log("ingest triggered for", sourcePath, "waiting...");
const { created, elapsedMs } = await driver.waitForIngest({ snapshot });
console.log("DONE elapsed_ms=" + elapsedMs);
console.log(JSON.stringify(created, null, 2));
process.exit(0);
