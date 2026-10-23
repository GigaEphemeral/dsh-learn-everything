// Unit tests for vault event subscription (S4, injectable transport).
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { subscribeVaultEvent, streamEvents, VaultEventError } from "../src/obsidian/events.js";

function fakeTransport(handler) {
  return (opts, cb) => {
    const res = new EventEmitter();
    res.statusCode = handler.statusCode;
    res.headers = {};
    queueMicrotask(() => cb(res));
    setTimeout(() => {
      if (handler.data) res.emit("data", Buffer.from(handler.data));
      res.emit("end");
    }, 5);
    const req = new EventEmitter();
    req.setTimeout = () => {};
    req.write = () => {};
    req.end = () => {};
    req.destroy = () => { res.emit("error", new Error("aborted")); };
    return req;
  };
}

test("subscribeVaultEvent posts and returns the signed stream URL", async () => {
  const r = await subscribeVaultEvent({
    baseUrl: "https://h", apiKey: "k", event: "modify",
    transport: fakeTransport({ statusCode: 201, data: JSON.stringify({ id: "x1", url: "https://e/s?sig=1", signed: true }) }),
  });
  assert.equal(r.url, "https://e/s?sig=1");
  assert.equal(r.signed, true);
});

test("streamEvents reads SSE data lines", async () => {
  const got = [];
  await streamEvents("https://e/s", {
    onEvent: (d) => got.push(d), stopMs: 3000,
    transport: fakeTransport({ statusCode: 200, data: "event: modify\ndata: {\"path\":\"wiki/x.md\"}\n\n" }),
  });
  assert.equal(got.length, 1);
  assert.ok(got[0].includes("wiki/x.md"));
});

test("subscribeVaultEvent wraps HTTP errors", async () => {
  await assert.rejects(
    () => subscribeVaultEvent({ baseUrl: "https://h", apiKey: "k", event: "modify", transport: fakeTransport({ statusCode: 401, data: "" }) }),
    VaultEventError,
  );
});
