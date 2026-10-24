// Tests for the Plugins-page bundle config registration (S4). The DSH Plugins
// page only shows a configuration form for a bundle that registered a
// `plugins.bundle.config` entry keyed by its npm package name; without this
// registration the settings form exists on the Host but has no UI entry.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { BUNDLE_NAME, SETTINGS_NAMESPACE, registerBundleConfigPage } from '../src/client/config-page.js'

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
