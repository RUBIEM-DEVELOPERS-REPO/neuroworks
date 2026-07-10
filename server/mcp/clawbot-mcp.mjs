#!/usr/bin/env node
// clawbot MCP bridge — exposes clawbot's curated primitives (vault grounding,
// connectors → AIIA, integrations, web reads, payment status) to an MCP client
// (Hermes) over stdio. It's a THIN PROXY: tool calls are forwarded to the live
// clawbot server's /api/primitives endpoints, so the real vault path + the
// encrypted connector secrets (AIIA token) are used. No clawbot logic is
// duplicated here.
//
// Transport: MCP stdio = line-delimited JSON-RPC 2.0 (one message per line).
// Implemented by hand to avoid an SDK dependency.
//
// Register with Hermes:
//   hermes mcp add clawbot -- node "<repo>/server/mcp/clawbot-mcp.mjs"
// Then `hermes mcp configure` to enable the tools, `hermes mcp test clawbot`.
//
// Env: CLAWBOT_BASE (default http://127.0.0.1:7471).

import { createInterface } from "node:readline";

const BASE = process.env.CLAWBOT_BASE ?? "http://127.0.0.1:7471";
const PROTOCOL_VERSION = "2024-11-05";

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}
function result(id, res) { send({ jsonrpc: "2.0", id, result: res }); }
function error(id, code, message) { send({ jsonrpc: "2.0", id, error: { code, message } }); }

async function fetchTools() {
  const r = await fetch(`${BASE}/api/primitives`);
  if (!r.ok) throw new Error(`clawbot /api/primitives ${r.status}`);
  const j = await r.json();
  return (j.tools ?? []).map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema ?? { type: "object", properties: {} },
  }));
}

async function callTool(name, args) {
  const r = await fetch(`${BASE}/api/primitives/call`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, args: args ?? {} }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error ?? `clawbot call ${r.status}`);
  return j.result;
}

async function handle(msg) {
  const { id, method, params } = msg;
  // Notifications (no id) — acknowledge by doing nothing.
  if (id === undefined || id === null) {
    return; // e.g. notifications/initialized, notifications/cancelled
  }
  try {
    switch (method) {
      case "initialize":
        return result(id, {
          // Echo the client's protocol version when offered, else our default.
          protocolVersion: params?.protocolVersion ?? PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "clawbot", version: "1.0.0" },
        });
      case "ping":
        return result(id, {});
      case "tools/list": {
        const tools = await fetchTools();
        return result(id, { tools });
      }
      case "tools/call": {
        const name = params?.name;
        const args = params?.arguments ?? {};
        if (!name) return error(id, -32602, "missing tool name");
        try {
          const res = await callTool(name, args);
          const text = typeof res === "string" ? res : JSON.stringify(res, null, 2);
          return result(id, { content: [{ type: "text", text }] });
        } catch (e) {
          // Tool-level error: report as an MCP tool result with isError so the
          // model sees the failure and can recover, rather than a transport error.
          return result(id, { content: [{ type: "text", text: `Error: ${e?.message ?? e}` }], isError: true });
        }
      }
      default:
        return error(id, -32601, `method not found: ${method}`);
    }
  } catch (e) {
    return error(id, -32603, String(e?.message ?? e));
  }
}

// Track in-flight async handlers so we don't exit on stdin-close while a
// tools/call is still awaiting clawbot — that would drop its response.
let pending = 0;
let closed = false;
// Defer the exit a tick so libuv finishes tearing down the stdin handle —
// avoids a benign "UV_HANDLE_CLOSING" assertion on Windows at process.exit.
function maybeExit() { if (closed && pending === 0) setImmediate(() => process.exit(0)); }

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try { msg = JSON.parse(trimmed); } catch { return; } // ignore non-JSON noise
  pending++;
  Promise.resolve(handle(msg)).catch(() => {}).finally(() => { pending--; maybeExit(); });
});
rl.on("close", () => { closed = true; maybeExit(); });
