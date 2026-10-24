// Locale dictionaries for the Plugins-page configuration card (S4). Plain
// objects only: the client bundle registers them through ctx.locale.

export const zh = {
  title: 'Obsidian 连接',
  description: '配置 Obsidian Local REST API 的地址与密钥，面板通过后端路由访问知识库。',
  apiKey: 'API Key',
  apiKeyHint: 'Obsidian Local REST API 的密钥；留空表示不修改当前值，并回退到 OBSIDIAN_API_KEY。',
  apiKeySet: '已配置',
  apiKeyUnset: '未配置',
  baseUrl: 'API 地址',
  baseUrlHint: '通常是 https://127.0.0.1:27124；留空回退到 OBSIDIAN_BASE_URL 或默认地址。',
  vaultName: 'Vault 名称',
  vaultNameHint: 'Obsidian 知识库名（obsidian:// 跳转用）；留空回退到 OBSIDIAN_VAULT_NAME 或 learnEverything。',
  overridden: '已覆盖',
  reset: '恢复默认',
  invalid: '值不合法',
  save: '保存',
  saving: '保存中…',
  saveFailed: '保存未生效，请检查后重试',
  unavailable: '此设置当前不可用',
  readOnly: '当前设置文档为只读',
}

export const en = {
  title: 'Obsidian connection',
  description: 'Configure the Obsidian Local REST API address and key; the panel reaches the vault through backend routes.',
  apiKey: 'API Key',
  apiKeyHint: 'Key of the Obsidian Local REST API. Leave blank to keep the current value and fall back to OBSIDIAN_API_KEY.',
  apiKeySet: 'Configured',
  apiKeyUnset: 'Not configured',
  baseUrl: 'API address',
  baseUrlHint: 'Usually https://127.0.0.1:27124; leave blank to fall back to OBSIDIAN_BASE_URL or the default.',
  vaultName: 'Vault name',
  vaultNameHint: 'Obsidian vault name (used for obsidian:// deep links); leave blank to fall back to OBSIDIAN_VAULT_NAME or learnEverything.',
  overridden: 'Overridden',
  reset: 'Reset',
  invalid: 'Invalid value',
  save: 'Save',
  saving: 'Saving…',
  saveFailed: 'The save did not land; check the value and retry',
  unavailable: 'This setting is currently unavailable',
  readOnly: 'The settings document is read-only',
}

/** Copy the shared SettingsForm frame expects, bound to the page's dictionary. */
export function formLabels(t) {
  return {
    unavailable: t('unavailable'),
    readOnly: t('readOnly'),
    saveFailed: t('saveFailed'),
    save: t('save'),
    saving: t('saving'),
  }
}
