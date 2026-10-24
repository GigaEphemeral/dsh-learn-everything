// Compile-progress state (S4): a small, testable file-backed status so the
// panel/agent can show karpathywiki compile progress and result notifications.
// Shape validation and atomic writes keep a truncated or edited file from
// silently wiping history; status bookkeeping is always auxiliary to compile.

import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export const COMPILE_STAGES = Object.freeze([
  "pending", "triggered", "waiting", "done", "timeout", "rate_limited", "error",
]);

export function emptyStatus() {
  return { stages: [], last: null };
}

// A valid status file is an object with an array of stage records. Anything
// else (null, [], an old shape, truncated JSON) degrades to empty status.
function normalizeStatus(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return emptyStatus();
  if (!Array.isArray(parsed.stages)) return emptyStatus();
  const stages = parsed.stages.filter((entry) => entry && typeof entry === "object");
  const last = parsed.last && typeof parsed.last === "object" ? parsed.last : stages.at(-1) ?? null;
  return { stages, last };
}

export async function readCompileStatus(filePath) {
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    // A missing status file is the normal first run. Other read failures (e.g.
    // EACCES) must not masquerade as "no history".
    if (err?.code === "ENOENT") return emptyStatus();
    throw err;
  }
  try {
    return normalizeStatus(JSON.parse(raw));
  } catch {
    // Truncated or hand-edited JSON: start a clean history instead of failing
    // every later append with a TypeError.
    return emptyStatus();
  }
}

export async function appendCompileEvent(filePath, event) {
  if (!COMPILE_STAGES.includes(event?.stage)) {
    throw new Error(`unknown compile stage: ${String(event?.stage)}`);
  }
  const cur = await readCompileStatus(filePath);
  const now = new Date().toISOString();
  const record = { at: now, stage: event.stage, source: event.source ?? null, message: event.message ?? null };
  const stages = [...cur.stages, record].slice(-20);
  const next = { stages, last: record };
  await mkdir(dirname(filePath), { recursive: true });
  // writeFile truncates first; rename makes the published file either the old
  // or the new JSON, never a half-written one.
  const tmp = `${filePath}.tmp`;
  await writeFile(tmp, JSON.stringify(next, null, 2) + "\n");
  await rename(tmp, filePath);
  return next;
}
