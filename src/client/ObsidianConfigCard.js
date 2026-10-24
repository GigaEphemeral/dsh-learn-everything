// Plugins-page configuration card for dsh-learn-everything (S4). The bundle's
// id and description are drawn by the Plugins page; this component renders the
// apiKey/baseUrl form inside it.

import { createElement } from 'react'
import { SettingsForm, SettingsSecretField, SettingsValueField } from '@deepseek-ai/dsh-client-ui-primitives'
import { formLabels } from './config-locales.js'

export function ObsidianConfigCard(props) {
  const { t } = props
  const state = props.useObsidianConfigForm((value) => value)
  const disabled = !state.writable || state.saving
  return createElement(SettingsForm,
    { labels: formLabels(t), state, onSave: props.save, onDiscard: props.discard },
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
  )
}
