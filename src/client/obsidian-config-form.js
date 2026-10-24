// Settings form controller for the Plugins-page bundle config card (S4).
// Stages apiKey/baseUrl edits over the `dsh-learn-everything` settings
// namespace and writes them atomically on save. apiKey never rides a response
// (the schema marks it secret), so its control starts blank and only a typed
// value is written.

import { SettingsFormModel, settingsTextField } from '@deepseek-ai/dsh-client-ui-primitives'
import { SETTINGS_NAMESPACE } from './config-page.js'

// A secret field has no readable draft: always render blank so the stored key
// never reaches the browser. A typed value stages one `set`; a typed-then-
// cleared draft stages `unset`.
const apiKeyField = {
  field: 'apiKey',
  format: () => '',
  parse: (text) => {
    const value = text.trim()
    return value === '' ? { kind: 'clear' } : { kind: 'set', value }
  },
}

function secretConfigured(ctx) {
  try {
    const view = ctx.configForms.describe().getSnapshot().view
    const namespace = view?.namespaces?.find((row) => row.ns === SETTINGS_NAMESPACE)
    return (namespace?.secrets ?? []).some(
      (secret) => secret.path.length === 1 && secret.path[0] === 'apiKey' && secret.set,
    )
  } catch {
    return false
  }
}

/**
 * Create the staged form and its render state.
 * @param ctx - client context carrying `ctx.configForms`.
 * @returns the slot entry's injected face plus a disposer.
 */
export function createObsidianConfigForm(ctx) {
  const scope = ctx.configForms.get(SETTINGS_NAMESPACE)
  const form = new SettingsFormModel(scope, [settingsTextField('baseUrl'), settingsTextField('vaultName'), apiKeyField])
  const state = form.bind(() => ({
    ...form.shell(),
    apiKey: form.field('apiKey'),
    baseUrl: form.field('baseUrl'),
    vaultName: form.field('vaultName'),
    apiKeyConfigured: secretConfigured(ctx),
  }))
  const actions = form.actions()
  return {
    hooks: { obsidianConfigForm: state },
    ...actions,
    // The card awaits this to verify the Host actually accepted the write;
    // SettingsFormModel resolves after the document round-trip.
    save: () => form.save().then(() => !form.shell().failed),
    dispose: () => { form.dispose() },
  }
}
