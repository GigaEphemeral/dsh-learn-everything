// Teaching persona shared by the obs-grill-me skill body and the
// practice_grill_gate tool. Keeping one resolver here means the persona the
// model reads in the skill and the persona the gate reports can never drift,
// and neither module has to import the bundle entry (which would be an ESM
// cycle: the entry imports both of them).

import { readConfigString } from './config-values.js'

/** Packaged skill whose body carries the persona placeholder. */
export const GRILL_SKILL_NAME = 'obs-grill-me'

/** Literal placeholder in skills/obs-grill-me/SKILL.md, rendered per call. */
export const PERSONA_PLACEHOLDER = '{{persona}}'

// Built-in teaching persona for the obs-grill-me skill: strict, evidence-driven
// and deliberately hard to satisfy. Users can override it through the plugin
// settings (grillPersona) or the OBSIDIAN_GRILL_PERSONA environment variable.
export const DEFAULT_GRILL_PERSONA = `你是一位严谨、苛刻、以证据为准的学科导师。你的唯一目标是确认学习者是否真正掌握，而不是让他感觉良好。
规则：
1. 只承认有证据支撑的理解：要求学习者给出具体步骤、依据、推导或例子；给不出证据的回答一律按未掌握处理。
2. 跳步、含糊、复述材料原文、只背结论的答案不算掌握，必须继续追问。
3. 每轮只追问一个最关键的缺口，不要一次抛出一串问题。
4. 不轻易给答案：先要求学习者自己补全；只有明确卡住时，才给最小必要提示，然后立即要求他重新表述。
5. 必须指出具体错在哪里、为什么错、正确的思路与判定标准是什么，禁止只说「再想想」。
6. 用换情境、换边界的变式题验证是否真的理解；只会原题不算会。
7. 不空泛表扬，不为照顾情绪降低标准；可以简短肯定进步，但结论始终以证据为准。
8. 学习者明确表示不会时，先讲清关键概念，再用变式题重新发问。`

/**
 * Effective teaching persona: plugin settings first, then the environment
 * fallback, then the built-in strict teacher. Resolved per call so a volatile
 * settings write applies without restarting the host.
 * @param config - the plugin Config (volatile references or plain values).
 * @returns the effective persona text.
 */
export function resolveGrillPersona(config) {
  const configured = readConfigString(config?.grillPersona).trim()
  if (configured) return configured
  const fromEnv = (process.env.OBSIDIAN_GRILL_PERSONA || '').trim()
  return fromEnv || DEFAULT_GRILL_PERSONA
}

/**
 * Render the persona placeholder into a skill body. The catalog is cached, but
 * the settings form can change a volatile persona at runtime, so the body is
 * rendered on every get() call instead of once at load time.
 * @param content - raw SKILL.md body containing PERSONA_PLACEHOLDER.
 * @param config - the plugin Config.
 * @returns the body the model receives.
 */
export function renderPersonaContent(content, config) {
  return content.replaceAll(PERSONA_PLACEHOLDER, () => resolveGrillPersona(config))
}
