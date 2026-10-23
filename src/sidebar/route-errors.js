// Shared route error codes and user-facing text (S4). Server routes emit the
// codes; the browser panel turns them into actionable messages. Keeping this
// pure module importable from both halves makes the mapping testable without a
// DOM or a running host.

export const NOT_CONFIGURED_CODE = 'obsidian-not-configured';

export const NOT_CONFIGURED_MESSAGE =
  'Obsidian access is not configured: set the API key in DSH plugin settings (dsh-learn-everything) or OBSIDIAN_API_KEY, then retry.';

const NOT_CONFIGURED_UI_TEXT =
  'Obsidian 未配置：请在 DSH 插件设置（dsh-learn-everything）填写 API Key，或设置 OBSIDIAN_API_KEY 后重试。';

const FENCE_UI_TEXT = '请求被 DSH 连接策略拒绝：请用 dsh 启动时打印的带 token URL 重新打开页面。';

// Map a route error envelope ({code, message}) to text the panel can show.
export function routeErrorText(error) {
  const code = error?.code;
  if (code === NOT_CONFIGURED_CODE) return NOT_CONFIGURED_UI_TEXT;
  if (code === 'unauthorized' || code === 'forbidden') return FENCE_UI_TEXT;
  return error?.message ?? '请求失败';
}
