// Unit tests for state-dir resolution.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveStateDir } from "../src/ingest/state-dir.js";

test("defaults to package .state relative to the script", () => {
  const dir = resolveStateDir("file:///pkg/scripts/x.mjs");
  assert.equal(dir, "/pkg/.state");
});

test("OBSIDIAN_STATE_DIR overrides the default", () => {
  const prev = process.env.OBSIDIAN_STATE_DIR;
  process.env.OBSIDIAN_STATE_DIR = "/data/state";
  assert.equal(resolveStateDir("file:///pkg/scripts/x.mjs"), "/data/state");
  if (prev === undefined) delete process.env.OBSIDIAN_STATE_DIR;
  else process.env.OBSIDIAN_STATE_DIR = prev;
});
