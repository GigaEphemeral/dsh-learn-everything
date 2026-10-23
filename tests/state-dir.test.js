// Unit tests for state-dir resolution.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveStateDir } from "../src/ingest/state-dir.js";

async function makePackageTree(t) {
  const root = await mkdtemp(join(tmpdir(), "dsh-state-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "package.json"), "{}");
  await mkdir(join(root, "scripts", "nested"), { recursive: true });
  return root;
}

function useStateDirEnv(t, value) {
  const previous = process.env.OBSIDIAN_STATE_DIR;
  if (value === undefined) delete process.env.OBSIDIAN_STATE_DIR;
  else process.env.OBSIDIAN_STATE_DIR = value;
  t.after(() => {
    if (previous === undefined) delete process.env.OBSIDIAN_STATE_DIR;
    else process.env.OBSIDIAN_STATE_DIR = previous;
  });
}

test("defaults to the nearest package root's .state", async (t) => {
  useStateDirEnv(t, undefined);
  const root = await makePackageTree(t);
  assert.equal(resolveStateDir(pathToFileURL(join(root, "scripts", "x.mjs")).href), join(root, ".state"));
  // A nested script directory must still resolve the package root, not ../.state.
  assert.equal(
    resolveStateDir(pathToFileURL(join(root, "scripts", "nested", "y.mjs")).href),
    join(root, ".state"),
  );
});

test("falls back to the script's parent when no package root is reachable", (t) => {
  useStateDirEnv(t, undefined);
  assert.equal(resolveStateDir("file:///pkg/scripts/x.mjs"), "/pkg/.state");
});

test("OBSIDIAN_STATE_DIR is trimmed and resolved to an absolute path", (t) => {
  useStateDirEnv(t, "  /data/state  ");
  assert.equal(resolveStateDir("file:///pkg/scripts/x.mjs"), "/data/state");
});

test("a relative OBSIDIAN_STATE_DIR is resolved against the cwd", (t) => {
  useStateDirEnv(t, "relative/state");
  assert.equal(resolveStateDir(undefined), resolve(process.cwd(), "relative/state"));
});

test("blank OBSIDIAN_STATE_DIR falls back to the package default", async (t) => {
  useStateDirEnv(t, "   ");
  const root = await makePackageTree(t);
  assert.equal(resolveStateDir(pathToFileURL(join(root, "scripts", "x.mjs")).href), join(root, ".state"));
});

test("non-file script URLs fall back to the cwd-based default", (t) => {
  useStateDirEnv(t, undefined);
  const fallback = join(process.cwd(), ".state");
  assert.equal(resolveStateDir("https://example.com/scripts/x.mjs"), fallback);
  assert.equal(resolveStateDir("file://remote-host/scripts/x.mjs"), fallback);
  assert.equal(resolveStateDir(undefined), fallback);
});
