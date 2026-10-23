// Reproducible session-cost measurement (S3, T4). Reads a DSH session event
// log (JSONL) and reports the same metrics the S3 before/after comparison needs:
// model calls, tool calls (by name), and token usage (input/output/cache-read).
// Mirrors the measurement method in doc/S2-humantest (session log parsing).
//
// Compressed logs are not supported: decompress first (zstd -dc file.zst > file.jsonl).
// The result also reports how many lines were read/parsed/skipped, and a file
// with no parsable events is an error instead of a zero-cost report.

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

function pickUsage(u) {
  return {
    input: u.inputTokens ?? u.input ?? 0,
    output: u.outputTokens ?? u.output ?? 0,
    cacheRead: u.cacheReadTokens ?? u.cacheRead ?? 0,
  };
}

// Parse one JSONL event into the counters (mutation only; the return value was
// never used by any caller).
export function countLine(ev, state) {
  if (!ev || typeof ev !== "object") return;
  if (ev.type === "assistant/message") {
    state.modelCalls += 1;
    const u = pickUsage(ev.data?.usage ?? {});
    state.tokens.input += u.input;
    state.tokens.output += u.output;
    state.tokens.cacheRead += u.cacheRead;
    return;
  }
  if (ev.type === "tool/call") {
    state.toolCalls += 1;
    const name = ev.data?.name ?? "unknown";
    state.toolNames[name] = (state.toolNames[name] ?? 0) + 1;
  }
}

export function createCounter() {
  return {
    modelCalls: 0,
    toolCalls: 0,
    toolNames: {},
    tokens: { input: 0, output: 0, cacheRead: 0 },
  };
}

function hasEvents(counter) {
  return counter.modelCalls > 0 || counter.toolCalls > 0 ||
    counter.tokens.input > 0 || counter.tokens.output > 0 || counter.tokens.cacheRead > 0;
}

function withTotals(counter) {
  const t = counter.tokens;
  return {
    modelCalls: counter.modelCalls,
    toolCalls: counter.toolCalls,
    toolNames: counter.toolNames,
    tokens: { ...t, totalIncludingCache: t.input + t.output + t.cacheRead },
  };
}

// Count a session log with a streaming reader so memory stays bounded on large
// append-only logs. Returns events read (lines/parsed/skipped) alongside the
// metrics; zero parsed events is an error, not a silent zero report.
export async function measureSession(file, opts = {}) {
  const byTurn = opts.byTurn === true;
  if (/\.(zst|zstd)$/i.test(file)) {
    const base = file.replace(/\.(zst|zstd)$/i, "");
    const decompressed = /\.jsonl$/i.test(base) ? base : `${base}.jsonl`;
    throw new Error(`compressed session logs are not supported: decompress first, e.g. zstd -dc ${file} > ${decompressed}`);
  }
  const counts = { lines: 0, parsed: 0, skipped: 0 };
  let state = createCounter();
  // In by-turn mode the initial counter also collects events logged before the
  // first turn/start; it is pushed as the first turn when it has any events.
  let current = byTurn ? state : null;
  const turns = [];
  const reader = createInterface({
    input: createReadStream(file, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of reader) {
    counts.lines += 1;
    if (!line.trim()) continue;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      counts.skipped += 1; // tolerate interleaved noise, but count it
      continue;
    }
    counts.parsed += 1;
    if (byTurn && ev.type === "turn/start") {
      if (current && hasEvents(current)) turns.push(current);
      current = createCounter();
      state = current;
      continue;
    }
    countLine(ev, state);
  }
  if (byTurn && current && hasEvents(current)) turns.push(current);
  if (counts.parsed === 0) {
    throw new Error(`no JSONL events parsed from ${file} (${counts.lines} lines read, ${counts.skipped} skipped); expected a DSH session log`);
  }
  if (byTurn) {
    return { source: counts, turns: turns.map(withTotals) };
  }
  return { source: counts, ...withTotals(state) };
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: node scripts/measure-session.mjs <session.jsonl> [--by-turn]");
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

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
