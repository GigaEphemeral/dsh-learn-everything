// Regression tests for the plugin Config surface (S4): the DSH plugins page
// derives its form from `Config` fields whose nearest ancestor is volatile, and
// the plugin reads those fields as Volatile references.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Config, readConfigString, resolveObsidianConfig } from '../index.js';

test('plugin Config fields are volatile so SettingsForms can project them', () => {
  // volatileForm() returns undefined (and the form disappears) without this.
  assert.equal(Config.dict.apiKey.meta.volatile, true);
  assert.equal(Config.dict.baseUrl.meta.volatile, true);
  assert.equal(Config.dict.vaultName.meta.volatile, true);
  assert.equal(Config.dict.vaultName.meta.default, 'learnEverything');
  // The API key must be redacted in remote settings.
  assert.equal(Config.dict.apiKey.meta.role, 'secret');
});

test('parsed volatile fields are references read through get()', () => {
  const parsed = Config({});
  assert.equal(typeof parsed.apiKey.get, 'function');
  assert.equal(typeof parsed.baseUrl.get, 'function');
  assert.equal(typeof parsed.vaultName.get, 'function');
  assert.equal(parsed.apiKey.get(), '');
  assert.equal(parsed.baseUrl.get(), '');
  assert.equal(parsed.vaultName.get(), 'learnEverything');
});

test('readConfigString accepts plain strings and Volatile references', () => {
  assert.equal(readConfigString('plain'), 'plain');
  assert.equal(readConfigString({ get: () => 'from-ref' }), 'from-ref');
  assert.equal(readConfigString({ get: () => 42 }, 'fallback'), 'fallback');
  assert.equal(readConfigString(undefined, 'fallback'), 'fallback');
});

test('resolveObsidianConfig prefers plugin config over the environment', () => {
  const prevKey = process.env.OBSIDIAN_API_KEY;
  const prevUrl = process.env.OBSIDIAN_BASE_URL;
  const prevVault = process.env.OBSIDIAN_VAULT_NAME;
  process.env.OBSIDIAN_API_KEY = 'env-key';
  process.env.OBSIDIAN_BASE_URL = 'https://env.example';
  process.env.OBSIDIAN_VAULT_NAME = 'env-vault';
  try {
    const configured = resolveObsidianConfig({ apiKey: 'cfg-key', baseUrl: 'https://cfg.example', vaultName: 'cfg-vault' });
    assert.equal(configured.apiKey, 'cfg-key');
    assert.equal(configured.baseUrl, 'https://cfg.example');
    assert.equal(configured.vaultName, 'cfg-vault');
    assert.ok(configured.compileStatusFile.endsWith('compile-status.json'));
    // An empty configured value falls back to the environment, then the default.
    const fromEnv = resolveObsidianConfig({ apiKey: '', baseUrl: '' });
    assert.equal(fromEnv.apiKey, 'env-key');
    assert.equal(fromEnv.baseUrl, 'https://env.example');
  } finally {
    if (prevKey === undefined) delete process.env.OBSIDIAN_API_KEY;
    else process.env.OBSIDIAN_API_KEY = prevKey;
    if (prevUrl === undefined) delete process.env.OBSIDIAN_BASE_URL;
    else process.env.OBSIDIAN_BASE_URL = prevUrl;
  }
});

test('ingest switch is a volatile boolean that defaults to allow', () => {
  // The Plugins page only projects volatile fields, and the ingest tool reads
  // this switch to decide whether a write is allowed.
  assert.equal(Config.dict.ingest.meta.volatile, true);
  assert.equal(Config.dict.ingest.meta.default, true);
  const parsed = Config({});
  assert.equal(typeof parsed.ingest.get, 'function');
  assert.equal(parsed.ingest.get(), true);
});

test('resolveObsidianConfig reads the ingest switch from the settings document', () => {
  assert.equal(resolveObsidianConfig({}).ingest, true);
  assert.equal(resolveObsidianConfig({ ingest: true }).ingest, true);
  assert.equal(resolveObsidianConfig({ ingest: false }).ingest, false);
  assert.equal(resolveObsidianConfig({ ingest: { get: () => false } }).ingest, false);
  assert.equal(resolveObsidianConfig({ ingest: { get: () => true } }).ingest, true);
});

