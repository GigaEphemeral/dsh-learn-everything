// Unit tests for vault-relative path validation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { assertVaultPath, encodeVaultPath, VaultPathError } from "../src/vault-path.js";

test("accepts a normal nested path", () => {
  assert.equal(assertVaultPath("Learning/Plans/a.md"), "Learning/Plans/a.md");
});

test("rejects absolute paths", () => {
  assert.throws(() => assertVaultPath("/etc/passwd"), VaultPathError);
});

test("rejects traversal", () => {
  assert.throws(() => assertVaultPath("../secret.md"), VaultPathError);
  assert.throws(() => assertVaultPath("a/../../b.md"), VaultPathError);
});

test("rejects the .obsidian config directory", () => {
  assert.throws(() => assertVaultPath(".obsidian/plugins/x/data.json"), VaultPathError);
});

test("tolerates ./ and trailing slash", () => {
  assert.equal(assertVaultPath("./Learning//Plans/"), "Learning/Plans");
});

test("encodes each segment for URLs", () => {
  assert.equal(encodeVaultPath("Learning/Plans/a b.md"), "Learning/Plans/a%20b.md");
});
