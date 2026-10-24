/**
 * Plugins-page configuration page registration for dsh-learn-everything
 * (S4). The DSH Plugins page never auto-generates a form for an installed
 * bundle: it renders the `plugins.bundle.config` entry whose key is the npm
 * package name. Registering that entry is what puts "Configure" on the
 * bundle's page; the form itself reads the `dsh-learn-everything` settings
 * namespace through the shared `configForms` service.
 *
 * Kept free of React/value imports so the registration contract is unit
 * testable: the component and form controller are passed in by the client
 * entry.
 */

/** npm package name of this bundle; the key the Plugins page dispatches. */
export const BUNDLE_NAME = 'dsh-learn-everything'

/** Host settings namespace the bundle registers (its Loader entry id). */
export const SETTINGS_NAMESPACE = 'dsh-learn-everything'

/** Locale namespace owned by this page's dictionaries. */
export const LOCALE_NS = 'settings.dshLearnEverything'

/**
 * Register the bundle's configuration page into the Plugins page.
 * @param ctx - client context carrying `ctx.slots`.
 * @param page - the component, locale namespace, and injected face.
 * @returns the registration disposer (or undefined until the slot exists).
 */
export function registerBundleConfigPage(ctx, page) {
  return ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config',
    key: BUNDLE_NAME,
    locale: page.locale,
    inject: page.inject,
  }, page.component))
}

/**
 * Required values for a first-time configuration: API key, address, and vault.
 * An already-configured key may stay blank (blank means "keep the stored key").
 * @param values - drafts plus whether the Host already stores a key.
 * @returns the missing field ids, in form order.
 */
export function missingRequiredConfig(values) {
  const missing = []
  if (!values.apiKeyConfigured && !String(values.apiKeyText ?? '').trim()) missing.push('apiKey')
  if (!String(values.baseUrlText ?? '').trim()) missing.push('baseUrl')
  if (!String(values.vaultNameText ?? '').trim()) missing.push('vaultName')
  return missing
}

/** Whether a required API address is a usable HTTP(S) URL. */
export function isHttpUrl(value) {
  try {
    const url = new URL(String(value ?? '').trim())
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
