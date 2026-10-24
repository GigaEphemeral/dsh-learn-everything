// Unit tests for vault event subscription (S4, injectable transport).
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { subscribeVaultEvent, streamEvents, transportFor, VaultEventError } from "../src/obsidian/events.js";

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

test("subscribeVaultEvent includes the HTTP error body in the diagnostic", async () => {
  await assert.rejects(
    () => subscribeVaultEvent({ baseUrl: "https://h", apiKey: "k", event: "modify", transport: fakeTransport({ statusCode: 401, data: "bad key" }) }),
    (err) => { assert.match(err.message, /HTTP 401: bad key/); return true; },
  );
});

test("streamEvents joins multi-line SSE data blocks", async () => {
  const got = [];
  await streamEvents("https://e/s", {
    onEvent: (data) => got.push(data), stopMs: 3000,
    transport: fakeTransport({ statusCode: 200, data: "data: first\ndata: second\n\n" }),
  });
  assert.deepEqual(got, ["first\nsecond"]);
});

test("streamEvents sends the API key only when given and resolves on close without end", async () => {
  let seen;
  const transport = (opts, cb) => {
    seen = opts;
    const res = new EventEmitter();
    res.statusCode = 200;
    queueMicrotask(() => { cb(res); res.emit("close"); });
    const req = new EventEmitter();
    req.setTimeout = () => {};
    req.end = () => {};
    req.destroy = () => {};
    req.write = () => {};
    return req;
  };
  await streamEvents("https://e/s", { stopMs: 3000, apiKey: "k", transport });
  assert.equal(seen.headers.Authorization, "Bearer k");
});

test("transportFor selects http vs https and honours an injected transport", () => {
  const httpTransport = () => {};
  assert.equal(transportFor(new URL("http://h/x"), httpTransport), httpTransport);
  assert.notEqual(transportFor(new URL("http://h/x")), transportFor(new URL("https://h/x")));
});
