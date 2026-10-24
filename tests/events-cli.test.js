// CLI validation tests for the vault event notifier (S4).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
const execFile = promisify(execFileCallback);

async function run(args) {
  const env = { ...process.env };
  delete env.OBSIDIAN_API_KEY;
  try {
    const result = await execFile(process.execPath, ["scripts/events-cli.mjs", ...args], { env });
    return { code: 0, stderr: result.stderr };
  } catch (error) {
    return { code: error.code, stderr: String(error.stderr ?? "") };
  }
}

test("events-cli rejects an unknown event name without connecting", async () => {
  const result = await run(["rename", "1"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /create, modify, or delete/);
});

test("events-cli rejects a non-positive or non-numeric duration", async () => {
  for (const seconds of ["0", "-1", "soon"]) {
    const result = await run(["modify", seconds]);
    assert.equal(result.code, 1, `${seconds} must be rejected`);
    assert.match(result.stderr, /positive number/);
  }
});
