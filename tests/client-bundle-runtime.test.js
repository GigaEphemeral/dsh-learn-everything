// Runtime wiring test for the built client bundle (S4). Loads lib/client.js
// through the same closure-factory shape the DSH ModuleLoader uses, with stub
// externals, then applies it to a fake client context. This fails if the
// bundle cannot load or if the Plugins-page config registration or the
// sidebar tab registration disappears.
import { test } from 'node:test'
import assert from 'node:assert/strict'

class FakeSettingsFormModel {
  constructor(scope) { this.scope = scope }
  shell() { return { available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false } }
  field(field) { return { text: '', overridden: false, invalid: false, field } }
  bind(project) { return { getSnapshot: project } }
  actions() { return { edit() {}, resetField() {}, save() {}, discard() {} } }
  dispose() {}
}

const stubRequire = (id) => {
  if (id === 'react') {
    return { createElement: () => null, useState: () => [], useEffect: () => {}, Fragment: Symbol('fragment') }
  }
  if (id === 'react/jsx-runtime') return { jsx: () => null, jsxs: () => null }
  if (id === 'react-dom') return {}
  if (id === '@deepseek-ai/dsh-client-ui-primitives') {
    return {
      SettingsFormModel: FakeSettingsFormModel,
      settingsTextField: (field) => ({ field, format: (value) => (typeof value === 'string' ? value : ''), parse: () => ({ kind: 'clear' }) }),
      SettingsForm: () => null,
      SettingsSecretField: () => null,
      SettingsValueField: () => null,
    }
  }
  return {}
}

test('built client bundle loads and registers the Plugins config page and sidebar tab', async () => {
  let factory
  globalThis.window = {
    __ModuleLoader__: {
      load(entry) {
        assert.equal(entry.id, 'dsh-learn-everything')
        factory = entry.factory
      },
    },
  }
  await import('../lib/client.js')
  assert.equal(typeof factory, 'function')
  const client = factory(stubRequire)

  const slots = []
  const locale = []
  const tabs = []
  const ctx = {
    effect: (callback) => callback(),
    locale: {
      register: (ns, dictionaries) => { locale.push({ ns, dictionaries }); return () => {} },
      bind: () => (key) => key,
    },
    configForms: {
      get: () => ({}),
      describe: () => ({ getSnapshot: () => ({ view: { namespaces: [] } }) }),
    },
    slots: {
      inject: (name, callback) => callback(),
      register: (options, component) => { slots.push({ options, component }); return () => {} },
    },
    inject: (deps, callback) => { callback({ get: () => ({ register: (tab) => { tabs.push(tab); return () => {} } }) }) },
  }
  client.apply(ctx)

  const config = slots.find((entry) => entry.options.name === 'plugins.bundle.config')
  assert.ok(config, 'the bundle config registration is missing from the built bundle')
  assert.equal(config.options.key, 'dsh-learn-everything')
  assert.equal(typeof config.component, 'function')
  const tabBodies = slots.filter((entry) => entry.options.name === 'sidebar.right.pane.tab')
  assert.equal(tabBodies.length, 1)
  assert.equal(tabBodies[0].options.key, 'obsidian')
  assert.equal(tabs.length, 1)
  assert.equal(tabs[0].id, 'obsidian')
  assert.ok(locale.some((entry) => entry.ns === 'settings.dshLearnEverything'))
})
