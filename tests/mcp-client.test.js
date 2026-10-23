// Focused tests for the MCP JSON-RPC client against a local plain-HTTP stub
// server (no TLS, no external network).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { McpClient, McpError } from "../src/obsidian/mcp-client.js";

async function startServer(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(resolve);
      }),
  };
}

function clientFor(server) {
  return new McpClient({ baseUrl: server.baseUrl, apiKey: "secret", timeoutMs: 2000 });
}

test("call sends the Streamable HTTP headers and returns the JSON-RPC result (C17)", async () => {
  let captured;
  const server = await startServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      captured = { headers: req.headers, body };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: { content: [{ type: "text", text: "hello" }] },
      }));
    });
  });
  try {
    const output = await clientFor(server).tool("search", { query: "x" });
    assert.equal(output, "hello");
    assert.equal(captured.headers["content-type"], "application/json");
    assert.equal(captured.headers.accept, "application/json, text/event-stream");
    assert.equal(captured.headers.authorization, "Bearer secret");
    assert.equal(captured.headers["mcp-method"], "tools/call");
    assert.equal(captured.headers["mcp-name"], "search");
    const envelope = JSON.parse(captured.body);
    assert.equal(envelope.jsonrpc, "2.0");
    assert.equal(envelope.method, "tools/call");
    assert.equal(envelope.params.name, "search");
    assert.equal(envelope.params.arguments.query, "x");
  } finally {
    await server.close();
  }
});

test("non-2xx responses raise McpError with the HTTP status before parsing (C14)", async () => {
  const server = await startServer((req, res) => {
    req.resume();
    res.writeHead(503, { "Content-Type": "text/html" });
    res.end("<html>service unavailable</html>");
  });
  try {
    await assert.rejects(() => clientFor(server).call("tools/list", {}), (err) => {
      assert.ok(err instanceof McpError);
      assert.equal(err.status, 503);
      assert.match(err.message, /HTTP 503/);
      return true;
    });
  } finally {
    await server.close();
  }
});

test("JSON-RPC errors keep their code and message (C14)", async () => {
  const server = await startServer((req, res) => {
    req.resume();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "Method not found" } }));
  });
  try {
    await assert.rejects(() => clientFor(server).call("tools/list", {}), (err) => {
      assert.ok(err instanceof McpError);
      assert.equal(err.code, -32601);
      assert.match(err.message, /Method not found/);
      return true;
    });
  } finally {
    await server.close();
  }
});

test("a response without result raises McpError instead of a TypeError (C15)", async () => {
  const server = await startServer((req, res) => {
    req.resume();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: 1 }));
  });
  try {
    await assert.rejects(() => clientFor(server).call("tools/list", {}), (err) => {
      assert.ok(err instanceof McpError);
      assert.match(err.message, /missing result/);
      return true;
    });
  } finally {
    await server.close();
  }
});

test("result.isError raises McpError with the tool text (C15)", async () => {
  const server = await startServer((req, res) => {
    req.resume();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: { isError: true, content: [{ type: "text", text: "tool exploded" }] },
    }));
  });
  try {
    await assert.rejects(() => clientFor(server).tool("search", { query: "x" }), (err) => {
      assert.ok(err instanceof McpError);
      assert.match(err.message, /tool exploded/);
      return true;
    });
  } finally {
    await server.close();
  }
});

test("a 2xx non-JSON body still raises the parse error code (C14)", async () => {
  const server = await startServer((req, res) => {
    req.resume();
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("not json");
  });
  try {
    await assert.rejects(() => clientFor(server).call("tools/list", {}), (err) => {
      assert.ok(err instanceof McpError);
      assert.equal(err.code, -32700);
      return true;
    });
  } finally {
    await server.close();
  }
});
