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

test("the config card renders the grill persona textarea and stages it through the settings form", async () => {
  const card = await readFile(new URL('../src/client/ObsidianConfigCard.js', import.meta.url), 'utf8');
  assert.match(card, /id: 'plugin-config-obsidian-grill-persona'/);
  assert.match(card, /rows: 4/);
  assert.match(card, /props\.edit\('grillPersona', event\.target\.value\)/);
  assert.match(card, /props\.resetField\('grillPersona'\)/);
  assert.match(card, /state\.grillPersona\?\.text \?\? ''/, 'the control tolerates a missing server field');
  const form = await readFile(new URL('../src/client/obsidian-config-form.js', import.meta.url), 'utf8');
  assert.match(form, /settingsTextField\('grillPersona'\)/);
  assert.match(form, /grillPersona: form\.field\('grillPersona'\)/);
  const locales = await readFile(new URL('../src/client/config-locales.js', import.meta.url), 'utf8');
  assert.equal((locales.match(/grillPersona: '/g) ?? []).length, 2, 'both dictionaries name the persona');
  assert.equal((locales.match(/grillPersonaHint: '/g) ?? []).length, 2, 'both dictionaries explain the persona');
  const bundle = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  assert.equal(bundle.includes('grillPersona'), true, 'the built client bundle carries the persona control');
});

test("config card status text follows the host theme tokens", async () => {
  const card = await readFile(new URL('../src/client/ObsidianConfigCard.js', import.meta.url), 'utf8');
  assert.equal(card.includes('#ff6b6b'), false);
  assert.equal(card.includes('#7bd88f'), false);
  assert.match(card, /var\(--dsw-alias-state-error-primary\)/);
  assert.match(card, /var\(--dsw-alias-state-success-primary\)/);
});

test("the API address must be a valid http(s) URL", () => {
  assert.equal(isHttpUrl("https://127.0.0.1:27124"), true);
  assert.equal(isHttpUrl("http://localhost:27123/"), true);
  assert.equal(isHttpUrl(""), false);
  assert.equal(isHttpUrl("127.0.0.1:27124"), false);
  assert.equal(isHttpUrl("ftp://host"), false);
});
