// Minimal MCP (Streamable HTTP) JSON-RPC client for the Obsidian
// "Local REST API with MCP" plugin, using the stateless 2026-07-28 revision.

import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";

export class McpError extends Error {
  constructor(message, { code } = {}) {
    super(message);
    this.name = "McpError";
    this.code = code;
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
        Authorization: `Bearer ${this.apiKey}`,
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": method,
        "Mcp-Name": name,
      },
      body,
    });
    const text = await readBody(res);
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new McpError(`MCP ${method}: non-JSON response`, { code: -32700 });
    }
    if (parsed.error) {
      throw new McpError(`MCP ${method} failed: ${parsed.error.message}`, { code: parsed.error.code });
    }
    return parsed.result;
  }

  // Call an MCP tool and return its text content.
  async tool(name, args) {
    const result = await this.call("tools/call", { name, arguments: args ?? {} }, name);
    const content = (result.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
    return content;
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
