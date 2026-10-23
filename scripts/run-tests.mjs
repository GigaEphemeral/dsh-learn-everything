// Default test entry point (`npm test`). It runs every unit suite under
// tests/ and the compiled lib/tests/ suites, but never the live Obsidian vault
// tests (tests/integration-live.test.js): those run through `npm run test:live`
// only, so an exported OBSIDIAN_API_KEY can never make `npm test` write to the
// real vault.
//
// Listing files here (instead of a shell glob) keeps the command portable and
// picks up newly added test files automatically. `node scripts/run-tests.mjs
// --list` prints the selection without running it.

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Suites that touch a live Obsidian instance; excluded from the default run.
const LIVE_SUITES = new Set(["integration-live.test.js"]);

export function collectTestFiles(rootDir = ROOT) {
  const files = [];
  for (const dir of ["tests", "lib/tests"]) {
    const entries = readdirSync(join(rootDir, dir));
    for (const name of entries.sort()) {
      if (name.endsWith(".test.js") && !LIVE_SUITES.has(name)) {
        files.push(join(dir, name));
      }
    }
  }
  return files;
}

function isMainModule() {
  return process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
}

function main() {
  const files = collectTestFiles();
  if (files.length === 0) {
    console.error("run-tests: no test files found under tests/ or lib/tests/");
    process.exitCode = 1;
    return;
  }
  if (process.argv.includes("--list")) {
    for (const file of files) console.log(file);
    return;
  }
  const result = spawnSync(process.execPath, ["--test", ...files], {
    cwd: ROOT,
    stdio: "inherit",
  });
  process.exitCode = result.status ?? 1;
}

if (isMainModule()) {
  main();
}
