// Locale dictionaries for the Plugins-page configuration card (S4). Plain
// objects only: the client bundle registers them through ctx.locale.

export const zh = {
  title: 'Obsidian 连接',
  description: '配置 Obsidian Local REST API 的地址与密钥，面板通过后端路由访问知识库。',
  apiKey: 'API Key',
  apiKeyHint: '必填（已配置后可留空保留）。Obsidian Local REST API 密钥，会先验证连通性再保存。',
  apiKeySet: '已配置',
  apiKeyUnset: '未配置',
  baseUrl: 'API 地址',
  baseUrlHint: '必填。Obsidian Local REST API 地址，通常是 https://127.0.0.1:27124。',
  vaultName: 'Vault 名称',
  vaultNameHint: '必填。Obsidian 知识库名，用于 obsidian:// 跳转。',
  ingest: '允许摄入',
  ingestHint: '开启后可把网页/本地 Markdown 写入知识库（obs-remember-knowledge）。关闭时摄入工具只做预检、拒绝写入。',
  overridden: '已覆盖',
  reset: '恢复默认',
  invalid: '值不合法',
  save: '保存',
  saving: '保存中…',
  saveFailed: '保存未生效，请检查后重试',
  requiredMark: ' *',
  requiredFields: '以下参数必填：',
  invalidBaseUrl: 'API 地址必须是以 http:// 或 https:// 开头的有效 URL。',
  connectionFailed: '连接失败：',
  verifyFailed: '保存后校验失败：',
  savedAndVerified: '已保存并验证生效。',
  unavailable: '此设置当前不可用',
  readOnly: '当前设置文档为只读',
}

export const en = {
  title: 'Obsidian connection',
  description: 'Configure the Obsidian Local REST API address and key; the panel reaches the vault through backend routes.',
  apiKey: 'API Key',
  apiKeyHint: 'Required on first setup; blank keeps the configured key. Verified against the vault before saving.',
  apiKeySet: 'Configured',
  apiKeyUnset: 'Not configured',
  baseUrl: 'API address',
  baseUrlHint: 'Required. Obsidian Local REST API address, usually https://127.0.0.1:27124.',
  vaultName: 'Vault name',
  vaultNameHint: 'Required. Obsidian vault name used for obsidian:// deep links.',
  ingest: 'Allow ingest',
  ingestHint: 'When on, web pages and local Markdown can be written into the vault. When off, ingest tools only preflight and refuse writes.',
  overridden: 'Overridden',
  reset: 'Reset',
  invalid: 'Invalid value',
  save: 'Save',
  saving: 'Saving…',
  saveFailed: 'The save did not land; check the value and retry',
  requiredMark: ' *',
  requiredFields: 'Required fields:',
  invalidBaseUrl: 'The API address must be a valid http:// or https:// URL.',
  connectionFailed: 'Connection failed:',
  verifyFailed: 'Post-save verification failed:',
  savedAndVerified: 'Saved and verified.',
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
