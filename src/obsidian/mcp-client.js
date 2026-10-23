// Minimal MCP (Streamable HTTP) JSON-RPC client for the Obsidian
// "Local REST API with MCP" plugin, using the stateless 2026-07-28 revision.

import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";

export class McpError extends Error {
  constructor(message, { code, status = 0 } = {}) {
    super(message);
    this.name = "McpError";
    this.code = code;
    this.status = status;
  }
}

function readBody(res) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    res.on("data", (c) => chunks.push(c));
    res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    res.on("error", reject);
  });
}

// Join the text blocks of an MCP result (tool output or `isError` detail).
function resultText(result) {
  return (result?.content ?? [])
    .filter((c) => c?.type === "text")
    .map((c) => c.text ?? "")
    .join("\n");
}

export class McpClient {
  constructor({ baseUrl = "https://127.0.0.1:27124", apiKey, timeoutMs = 30000 } = {}) {
    if (!apiKey) throw new Error("McpClient: apiKey is required");
    const u = new URL(baseUrl);
    this.protocol = u.protocol === "http:" ? "http" : "https";
    this.host = u.hostname;
    this.port = u.port || (this.protocol === "https" ? 443 : 80);
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
  }

  // Call an MCP method (e.g. "tools/call") with the stateless envelope.
  // name must match the Mcp-Name header; defaults to method.
  async call(method, params, name = method) {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": { name: "dsh-wiki", version: "1.0.0" },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    });
    const res = await this._raw({
      method: "POST",
      path: "/mcp/",
      headers: {
        "Content-Type": "application/json",
        // Streamable HTTP requires accepting both response encodings (C17).
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${this.apiKey}`,
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": method,
        "Mcp-Name": name,
      },
      body,
    });
    const status = res.statusCode;
    const text = await readBody(res);
    // HTTP-level failures (401/403/5xx, HTML gateways) must be reported as such
    // instead of as a JSON parsing problem (C14).
    if (status < 200 || status >= 300) {
      const detail = text.trim().slice(0, 200);
      throw new McpError(`MCP ${method}: HTTP ${status}${detail ? `: ${detail}` : ""}`, { status });
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new McpError(`MCP ${method}: non-JSON response`, { code: -32700 });
    }
    if (parsed.error) {
      throw new McpError(`MCP ${method} failed: ${parsed.error.message}`, { code: parsed.error.code });
    }
    // A JSON-RPC response without `result` cannot be consumed safely (C15).
    if (parsed.result === undefined) {
      throw new McpError(`MCP ${method}: response is missing result`, { code: -32603 });
    }
    // MCP protocol errors carry `isError` inside a successful HTTP/JSON-RPC
    // exchange; surface them instead of returning the failure text (C15).
    if (parsed.result?.isError === true) {
      const detail = resultText(parsed.result);
      throw new McpError(`MCP ${method} failed: ${detail || "tool reported an error"}`);
    }
    return parsed.result;
  }

  // Call an MCP tool and return its text content.
  async tool(name, args) {
    const result = await this.call("tools/call", { name, arguments: args ?? {} }, name);
    return resultText(result);
  }

  _raw(opts) {
    return new Promise((resolve, reject) => {
      const fn = this.protocol === "https" ? httpsRequest : httpRequest;
      const req = fn({
        method: opts.method,
        hostname: this.host,
        port: this.port,
        path: opts.path,
        headers: opts.headers,
        rejectUnauthorized: false,
      }, resolve);
      req.setTimeout(this.timeoutMs, () => {
        req.destroy(new Error(`MCP request timed out after ${this.timeoutMs}ms`));
      });
      req.on("error", reject);
      req.write(opts.body);
      req.end();
    });
  }
}
