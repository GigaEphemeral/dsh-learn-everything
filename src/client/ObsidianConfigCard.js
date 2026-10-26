// Plugins-page configuration card for dsh-learn-everything (S4). All three
// fields are required; Save first tests the staged URL/key against the vault
// (an authenticated read, not the unauthenticated health endpoint), writes
// only after that succeeds, then re-reads the saved config to prove the write
// landed and re-tests the saved values to prove they took effect.

import { createElement, useState } from 'react'
import { SettingsForm, SettingsSecretField, SettingsValueField, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { formLabels } from './config-locales.js'
import { isHttpUrl, missingRequiredConfig } from './config-page.js'

function apiUrl(path, params) {
  // Panel routes are absolute; document.baseURI appends session routes/tokens.
  const qs = new URLSearchParams(params ?? {}).toString()
  return window.location.origin + path + (qs ? '?' + qs : '')
}

async function getJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  let body = null
  try { body = await response.json() } catch { /* non-JSON */ }
  if (!response.ok || body?.ok !== true) {
    throw new Error(body?.error?.message ?? ('HTTP ' + response.status))
  }
  return body.value
}

export function ObsidianConfigCard(props) {
  const { t } = props
  const state = props.useObsidianConfigForm((value) => value)
  const [testing, setTesting] = useState(false)
  const [testError, setTestError] = useState(null)
  const [notice, setNotice] = useState(null)
  const busy = state.saving || testing
  const disabled = !state.writable || busy
  const keyText = String(state.apiKey?.text ?? '').trim()
  const urlText = String(state.baseUrl?.text ?? '').trim()
  const vaultText = String(state.vaultName?.text ?? '').trim()
  // The persona setting is optional for the card: when the host snapshot has
  // no such field yet, the control starts blank instead of crashing.
  const personaText = String(state.grillPersona?.text ?? '')
  const personaOverridden = Boolean(state.grillPersona?.overridden)
  const ingestOn = String(state.ingest?.text ?? 'true') !== 'false'

  // A secret already configured may stay blank ("keep current"); a fresh
  // install requires all three values.
  const missingIds = missingRequiredConfig({
    apiKeyConfigured: state.apiKeyConfigured,
    apiKeyText: keyText,
    baseUrlText: urlText,
    vaultNameText: vaultText,
  })
  const labels = { apiKey: t('apiKey'), baseUrl: t('baseUrl'), vaultName: t('vaultName') }
  const missing = missingIds.map((id) => labels[id])

  async function testAndSave() {
    if (busy) return
    setNotice(null)
    setTestError(null)
    if (missing.length > 0) {
      setTestError(t('requiredFields') + ' ' + missing.join('、'))
      return
    }
    if (!isHttpUrl(urlText)) {
      setTestError(t('invalidBaseUrl'))
      return
    }
    setTesting(true)
    try {
      const params = {}
      if (keyText) params.apiKey = keyText
      if (urlText) params.baseUrl = urlText
      params.vaultName = vaultText
      const before = await getJson(apiUrl('/obsidian/api/test-connection', params))
      if (!before.connected) {
        const error = before.error
        setTestError(t('connectionFailed') + ' ' + String(error?.code ?? '') + ' ' + String(error?.message ?? '').slice(0, 140))
        return
      }
      const saved = await props.save()
      if (saved === false) {
        setTestError(t('saveFailed'))
        return
      }
      const config = await getJson(apiUrl('/obsidian/api/config'))
      const valuesLanded = config.baseUrl === urlText && config.vaultName === vaultText
        && config.ingest === ingestOn
      if (!valuesLanded || !config.apiKeyConfigured) {
        setTestError(t('verifyFailed'))
        return
      }
      const after = await getJson(apiUrl('/obsidian/api/test-connection'))
      if (!after.connected) {
        setTestError(t('verifyFailed') + ' ' + String(after.error?.message ?? '').slice(0, 140))
        return
      }
      setNotice(t('savedAndVerified'))
    } catch (error) {
      setTestError(t('connectionFailed') + ' ' + String(error?.message ?? error).slice(0, 140))
    } finally {
      setTesting(false)
    }
  }

  const formState = { ...state, saving: busy }
  return createElement(SettingsForm,
    { labels: formLabels(t), state: formState, onSave: () => { void testAndSave() }, onDiscard: props.discard },
    createElement(SettingsSecretField, {
      id: 'plugin-config-obsidian-api-key',
      label: t('apiKey') + t('requiredMark'),
      hint: t('apiKeyHint'),
      text: state.apiKey.text,
      configured: state.apiKeyConfigured,
      stateLabel: state.apiKeyConfigured ? t('apiKeySet') : t('apiKeyUnset'),
      disabled,
      onEdit: (text) => { setTestError(null); setNotice(null); props.edit('apiKey', text) },
    }),
    createElement(SettingsValueField, {
      id: 'plugin-config-obsidian-base-url',
      label: t('baseUrl') + t('requiredMark'),
      hint: t('baseUrlHint'),
      overriddenLabel: t('overridden'),
      resetLabel: t('reset'),
      invalidLabel: t('invalid'),
      disabled,
      ...state.baseUrl,
      onEdit: (text) => { setTestError(null); setNotice(null); props.edit('baseUrl', text) },
      onReset: () => { props.resetField('baseUrl') },
    }),
    createElement(SettingsValueField, {
      id: 'plugin-config-obsidian-vault-name',
      label: t('vaultName') + t('requiredMark'),
      hint: t('vaultNameHint'),
      overriddenLabel: t('overridden'),
      resetLabel: t('reset'),
      invalidLabel: t('invalid'),
      disabled,
      ...state.vaultName,
      onEdit: (text) => { setTestError(null); setNotice(null); props.edit('vaultName', text) },
      onReset: () => { props.resetField('vaultName') },
    }),
    createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, marginTop: 12 } },
      createElement('label', { htmlFor: 'plugin-config-obsidian-grill-persona', style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 } },
        t('grillPersona'),
        personaOverridden && createElement('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } }, t('overridden')),
      ),
      createElement('textarea', {
        id: 'plugin-config-obsidian-grill-persona',
        rows: 4,
        value: personaText,
        disabled,
        onChange: (event) => { setTestError(null); setNotice(null); props.edit('grillPersona', event.target.value) },
        style: { width: '100%', boxSizing: 'border-box', padding: 6, fontSize: 12, fontFamily: 'inherit', resize: 'vertical' },
      }),
      createElement('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } }, t('grillPersonaHint')),
      personaOverridden && createElement('button', {
        type: 'button',
        disabled,
        onClick: () => { props.resetField('grillPersona') },
        style: { alignSelf: 'flex-start', fontSize: 11 },
      }, t('reset')),
    ),
    createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 12 } },
      createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
        createElement('div', { style: { fontSize: 13 } }, t('ingest')),
        createElement('div', { style: { fontSize: 11, opacity: 0.7 } }, t('ingestHint')),
      ),
      createElement(Switch, {
        checked: ingestOn,
        label: t('ingest'),
        disabled,
        onChange: (next) => { setTestError(null); setNotice(null); props.edit('ingest', next ? 'true' : 'false') },
      }),
    ),
    testError && createElement('div', { role: 'status', style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 12, marginTop: 6 } }, testError),
    notice && createElement('div', { role: 'status', style: { color: 'var(--dsw-alias-state-success-primary)', fontSize: 12, marginTop: 6 } }, notice),
  )
}
