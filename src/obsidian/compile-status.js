// Compile-progress state (S4): a small, testable file-backed status so the
// panel/agent can show karpathywiki compile progress and result notifications.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export const COMPILE_STAGES = Object.freeze([
  "pending", "triggered", "waiting", "done", "timeout", "rate_limited", "error",
]);

export function emptyStatus() {
  return { stages: [], last: null };
}

export async function readCompileStatus(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return emptyStatus();
  }
}

export async function appendCompileEvent(filePath, event) {
  const cur = await readCompileStatus(filePath);
  const now = new Date().toISOString();
  const record = { at: now, stage: event.stage, source: event.source ?? null, message: event.message ?? null };
  const stages = [...cur.stages, record].slice(-20);
  const next = { stages, last: record };
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(next, null, 2) + "\n");
  return next;
}
