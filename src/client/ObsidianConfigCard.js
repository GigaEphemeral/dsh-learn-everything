// Plugins-page configuration card for dsh-learn-everything (S4). The bundle's
// id and description are drawn by the Plugins page; this component renders the
// apiKey/baseUrl form inside it.

import { createElement, useState } from 'react'
import { SettingsForm, SettingsSecretField, SettingsValueField } from '@deepseek-ai/dsh-client-ui-primitives'
import { formLabels } from './config-locales.js'

function apiUrl(path, params) {
  const base = (document.baseURI ?? window.location.href).replace(/\/$/, '')
  const qs = new URLSearchParams(params).toString()
  return base + path + (qs ? '?' + qs : '')
}

export function ObsidianConfigCard(props) {
  const { t } = props
  const state = props.useObsidianConfigForm((value) => value)
  const [testing, setTesting] = useState(false)
  const [testError, setTestError] = useState(null)
  const disabled = !state.writable || state.saving || testing
  // Save validates connectivity with the STAGED values first: a wrong key or
  // address is rejected before it is persisted, and nothing is written on failure.
  const testAndSave = () => {
    if (testing || state.saving) return
    setTesting(true)
    setTestError(null)
    const q = new URLSearchParams()
    const key = String(state.apiKey?.text ?? '').trim()
    const url = String(state.baseUrl?.text ?? '').trim()
    if (key) q.set('apiKey', key)
    if (url) q.set('baseUrl', url)
    fetch(apiUrl('/obsidian/api/test-connection', q), { headers: { accept: 'application/json' } })
      .then((res) => res.json())
      .then((j) => {
        setTesting(false)
        if (j.ok && j.value?.connected) {
          setTestError(null)
          props.save()
        } else {
          const e = j.value?.error
          setTestError(t('saveFailed') + ' ' + String(e?.code ?? '') + ' ' + String(e?.message ?? '').slice(0, 120))
        }
      })
      .catch(() => { setTesting(false); setTestError(t('saveFailed')) })
  }
  return createElement(SettingsForm,
    { labels: formLabels(t), state, onSave: testAndSave, onDiscard: props.discard },
    createElement(SettingsSecretField, {
      id: 'plugin-config-obsidian-api-key',
      label: t('apiKey'),
      hint: t('apiKeyHint'),
      text: state.apiKey.text,
      configured: state.apiKeyConfigured,
      stateLabel: state.apiKeyConfigured ? t('apiKeySet') : t('apiKeyUnset'),
      disabled,
      onEdit: (text) => { props.edit('apiKey', text) },
    }),
    createElement(SettingsValueField, {
      id: 'plugin-config-obsidian-base-url',
      label: t('baseUrl'),
      hint: t('baseUrlHint'),
      overriddenLabel: t('overridden'),
      resetLabel: t('reset'),
      invalidLabel: t('invalid'),
      disabled,
      ...state.baseUrl,
      onEdit: (text) => { props.edit('baseUrl', text) },
      onReset: () => { props.resetField('baseUrl') },
    }),
    createElement(SettingsValueField, {
      id: 'plugin-config-obsidian-vault-name',
      label: t('vaultName'),
      hint: t('vaultNameHint'),
      overriddenLabel: t('overridden'),
      resetLabel: t('reset'),
      invalidLabel: t('invalid'),
      disabled,
      ...state.vaultName,
      onEdit: (text) => { props.edit('vaultName', text) },
      onReset: () => { props.resetField('vaultName') },
    }),
    testError && createElement('div', { style: { color: '#ff6b6b', fontSize: 12, marginTop: 6 } }, testError),
  )
}
