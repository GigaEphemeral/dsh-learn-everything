// Unit tests for Obsidian vault-name validation (S4).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultVaultRegistryFile, readVaultRegistry, validateVaultName } from "../src/obsidian/vault-registry.js";

async function registryWith(vaults) {
  const dir = await mkdtemp(join(tmpdir(), "vault-registry-"));
  const file = join(dir, "obsidian.json");
  await writeFile(file, JSON.stringify({ vaults }));
  return { dir, file };
}

test("a configured vault must match a registered vault", async () => {
  const { dir, file } = await registryWith({
    a: { path: "/home/u/myWiki/learnEverything", open: true },
    b: { path: "/home/u/myWiki/other" },
  });
  try {
    const ok = await validateVaultName("learnEverything", { registryFile: file });
    assert.equal(ok.ok, true);
    assert.equal(ok.verified, true);
    assert.equal(ok.openName, "learnEverything");
    const bad = await validateVaultName("does-not-exist", { registryFile: file });
    assert.equal(bad.ok, false);
    assert.equal(bad.reason, "unknown-vault");
    assert.deepEqual(bad.available.sort(), ["learnEverything", "other"]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("an unreadable registry cannot block configuration", async () => {
  const missing = join(tmpdir(), "no-such-obsidian-registry.json");
  const result = await validateVaultName("anything", { registryFile: missing });
  assert.equal(result.ok, true);
  assert.equal(result.verified, false);
});

test("registry parsing ignores malformed entries and exposes the open vault", async () => {
  const { dir, file } = await registryWith({ a: { path: "/v/A", open: true }, b: {}, c: { path: "" } });
  try {
    const registry = await readVaultRegistry({ registryFile: file });
    assert.equal(registry.verifiable, true);
    assert.deepEqual(registry.names, ["A"]);
    assert.equal(registry.openName, "A");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("default registry path follows the platform and honours the env override", () => {
  assert.equal(defaultVaultRegistryFile({ OBSIDIAN_VAULTS_FILE: "/x/y.json" }, "linux"), "/x/y.json");
  assert.match(defaultVaultRegistryFile({ XDG_CONFIG_HOME: "/xdg" }, "linux"), /^\/xdg\/obsidian\/obsidian\.json$/);
  assert.match(defaultVaultRegistryFile({}, "darwin"), /Library\/Application Support\/obsidian\/obsidian\.json$/);
});
