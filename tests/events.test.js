// Unit tests for vault event subscription (S4).
import { test } from "node:test";
import assert from "node:assert/strict";
import { subscribeVaultEvent, streamEvents, VaultEventError } from "../src/obsidian/events.js";

test("subscribeVaultEvent posts and returns the signed stream URL", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    assert.match(url, /\/events\/vault\/modify\/$/);
    assert.equal(opts.method, "POST");
    assert.equal(opts.headers.Authorization, "Bearer k");
    return { ok: true, status: 201, json: async () => ({ id: "x1", url: "https://e/s?sig=1", signed: true }) };
  };
  try {
    const r = await subscribeVaultEvent({ baseUrl: "https://h", apiKey: "k", event: "modify" });
    assert.equal(r.url, "https://e/s?sig=1");
    assert.equal(r.signed, true);
  } finally { globalThis.fetch = originalFetch; }
});

test("streamEvents reads SSE data lines", async () => {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode("event: modify\ndata: {\"path\":\"wiki/x.md\"}\n\n"));
      controller.close();
    },
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, body });
  const got = [];
  try {
    await streamEvents("https://e/s", { onEvent: (d) => got.push(d), stopMs: 5000 });
    assert.equal(got.length, 1);
    assert.ok(got[0].includes("wiki/x.md"));
  } finally { globalThis.fetch = originalFetch; }
});

test("subscribeVaultEvent wraps HTTP errors", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 401 });
  try {
    await assert.rejects(() => subscribeVaultEvent({ baseUrl: "https://h", apiKey: "k", event: "modify" }), VaultEventError);
  } finally { globalThis.fetch = originalFetch; }
});
