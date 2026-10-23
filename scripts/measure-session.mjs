// Reproducible session-cost measurement (S3, T4). Reads a DSH session event
// log (JSONL, optionally .zstd) and reports the same metrics the S3 before/
// after comparison needs: model calls, tool calls (by name), and token usage
// (input/output/cache-read). Mirrors the measurement method in
// doc/S2-humantest (session log parsing).

import { readFile } from "node:fs/promises";

function pickUsage(u) {
  return {
    input: u.inputTokens ?? u.input ?? 0,
    output: u.outputTokens ?? u.output ?? 0,
    cacheRead: u.cacheReadTokens ?? u.cacheRead ?? 0,
  };
}

// Parse one JSONL line into a contribution to the counters, or null to skip.
export function countLine(ev, state) {
  if (!ev || typeof ev !== "object") return null;
  if (ev.type === "assistant/message") {
    state.modelCalls += 1;
    const u = pickUsage(ev.data?.usage ?? {});
    state.tokens.input += u.input;
    state.tokens.output += u.output;
    state.tokens.cacheRead += u.cacheRead;
    return { kind: "model" };
  }
  if (ev.type === "tool/call") {
    state.toolCalls += 1;
    const name = ev.data?.name ?? "unknown";
    state.toolNames[name] = (state.toolNames[name] ?? 0) + 1;
    return { kind: "tool", name };
  }
  return null;
}

export function createCounter() {
  return {
    modelCalls: 0,
    toolCalls: 0,
    toolNames: {},
    tokens: { input: 0, output: 0, cacheRead: 0 },
  };
}

export async function measureSession(file, opts = {}) {
  const raw = await readFile(file, "utf8");
  let state = createCounter();
  const turns = [];
  let current = null;
  const byTurn = opts.byTurn === true;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue; // tolerate interleaved noise
    }
    if (byTurn && ev.type === "turn/start") {
      if (current) turns.push(current);
      current = createCounter();
      state = current;
      continue;
    }
    countLine(ev, state);
  }
  if (byTurn && current) turns.push(current);
  const t = state.tokens;
  if (byTurn) {
    return {
      turns: turns.map((tr) => ({
        modelCalls: tr.modelCalls,
        toolCalls: tr.toolCalls,
        tokens: { input: tr.tokens.input, output: tr.tokens.output, cacheRead: tr.tokens.cacheRead, totalIncludingCache: tr.tokens.input + tr.tokens.output + tr.tokens.cacheRead },
      })),
    };
  }
  return {
    modelCalls: state.modelCalls,
    toolCalls: state.toolCalls,
    toolNames: state.toolNames,
    tokens: { ...t, totalIncludingCache: t.input + t.output + t.cacheRead },
  };
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: node scripts/measure-session.mjs <session.jsonl[.zstd]> [--by-turn]");
    process.exitCode = 1;
    return;
  }
  try {
    const m = await measureSession(file, { byTurn: process.argv.includes("--by-turn") });
    console.log(JSON.stringify(m, null, 2));
  } catch (err) {
    console.error(`measure-session: ${err.message}`);
    process.exitCode = 1;
  }
}

import { pathToFileURL } from "node:url";
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
