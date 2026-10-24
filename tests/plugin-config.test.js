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
  // The API key must be redacted in remote settings.
  assert.equal(Config.dict.apiKey.meta.role, 'secret');
});

test('parsed volatile fields are references read through get()', () => {
  const parsed = Config({});
  assert.equal(typeof parsed.apiKey.get, 'function');
  assert.equal(typeof parsed.baseUrl.get, 'function');
  assert.equal(parsed.apiKey.get(), '');
  assert.equal(parsed.baseUrl.get(), '');
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
  process.env.OBSIDIAN_API_KEY = 'env-key';
  process.env.OBSIDIAN_BASE_URL = 'https://env.example';
  try {
    const configured = resolveObsidianConfig({ apiKey: 'cfg-key', baseUrl: 'https://cfg.example' });
    assert.equal(configured.apiKey, 'cfg-key');
    assert.equal(configured.baseUrl, 'https://cfg.example');
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
