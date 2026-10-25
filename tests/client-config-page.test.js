// Tests for the Plugins-page bundle config registration (S4). The DSH Plugins
// page only shows a configuration form for a bundle that registered a
// `plugins.bundle.config` entry keyed by its npm package name; without this
// registration the settings form exists on the Host but has no UI entry.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { BUNDLE_NAME, SETTINGS_NAMESPACE, registerBundleConfigPage, missingRequiredConfig, isHttpUrl } from '../src/client/config-page.js'

test('bundle config registration uses the package key the Plugins page dispatches', () => {
  let registered
  let disposed = false
  const ctx = {
    slots: {
      inject(name, callback) {
        assert.equal(name, 'plugins.bundle.config')
        return callback()
      },
      register(options, component) {
        registered = { options, component }
        return () => { disposed = true }
      },
    },
  }
  const component = () => null
  const off = registerBundleConfigPage(ctx, {
    component,
    locale: 'settings.dshLearnEverything',
    inject: () => ({ hooks: {} }),
  })
  assert.equal(BUNDLE_NAME, 'dsh-learn-everything')
  assert.equal(SETTINGS_NAMESPACE, 'dsh-learn-everything')
  assert.equal(registered.options.name, 'plugins.bundle.config')
  assert.equal(registered.options.key, BUNDLE_NAME)
  assert.equal(registered.options.locale, 'settings.dshLearnEverything')
  assert.equal(registered.component, component)
  off()
  assert.equal(disposed, true)
})

test('built client bundle carries the bundle config registration', async () => {
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.match(source, /plugins\.bundle\.config/)
  assert.match(source, /dsh-learn-everything/)
})

test("all three first-time values are required; a stored key may stay blank", () => {
  assert.deepEqual(missingRequiredConfig({ apiKeyConfigured: false, apiKeyText: "", baseUrlText: "", vaultNameText: "" }), ["apiKey", "baseUrl", "vaultName"]);
  assert.deepEqual(missingRequiredConfig({ apiKeyConfigured: true, apiKeyText: "", baseUrlText: "https://h", vaultNameText: "v" }), []);
  assert.deepEqual(missingRequiredConfig({ apiKeyConfigured: false, apiKeyText: "  ", baseUrlText: " ", vaultNameText: "v" }), ["apiKey", "baseUrl"]);
});

test("the config card stages the ingest switch through the settings form", async () => {
  const card = await readFile(new URL('../src/client/ObsidianConfigCard.js', import.meta.url), 'utf8');
  assert.match(card, /Switch/);
  assert.match(card, /props\.edit\('ingest'/);
  assert.match(card, /config\.ingest === ingestOn/);
  const form = await readFile(new URL('../src/client/obsidian-config-form.js', import.meta.url), 'utf8');
  assert.match(form, /field: 'ingest'/);
  assert.match(form, /form\.field\('ingest'\)/);
  const locales = await readFile(new URL('../src/client/config-locales.js', import.meta.url), 'utf8');
  assert.match(locales, /ingest: '/, 'zh and en dictionaries name the switch');
});

test("the API address must be a valid http(s) URL", () => {
  assert.equal(isHttpUrl("https://127.0.0.1:27124"), true);
  assert.equal(isHttpUrl("http://localhost:27123/"), true);
  assert.equal(isHttpUrl(""), false);
  assert.equal(isHttpUrl("127.0.0.1:27124"), false);
  assert.equal(isHttpUrl("ftp://host"), false);
});
