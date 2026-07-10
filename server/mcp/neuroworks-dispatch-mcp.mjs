#!/usr/bin/env node
// NeuroWorks dispatch MCP server — lets an external MCP host (Claude Desktop,
// another agent runtime) dispatch agent tasks INTO NeuroWorks and read results.
// It's a THIN PROXY over the authenticated /api/v1/dispatch REST surface, so
// the API key is the only credential and NeuroWorks' own auth/tenancy applies.
//
// Transport: MCP stdio = line-delimited JSON-RPC 2.0 (one message per line),
// hand-rolled to avoid an SDK dependency (mirrors clawbot-mcp.mjs).
//
// Register with an MCP host, e.g. Claude Desktop config:
//   "neuroworks": {
//     "command": "node",
//     "args": ["<repo>/server/mcp/neuroworks-dispatch-mcp.mjs"],
//     "env": { "NEUROWORKS_API_KEY": "nw_...", "NEUROWORKS_BASE": "http://127.0.0.1:7471" }
//   }
//
// Env: NEUROWORKS_BASE (default http://127.0.0.1:7471), NEUROWORKS_API_KEY (required to dispatch).

import { createInterface } from "node:readline";

const BASE = process.env.NEUROWORKS_BASE ?? "http://127.0.0.1:7471";
const API_KEY = process.env.NEUROWORKS_API_KEY ?? "";
const PROTOCOL_VERSION = "2024-11-05";

function send(msg) { try { process.stdout.write(JSON.stringify(msg) + "\n"); } catch { /* pipe closed */ } }
// A closed stdout (host disconnected) shouldn't crash the server.
process.stdout.on("error", () => {});
function result(id, res) { send({ jsonrpc: "2.0", id, result: res }); }
function rpcError(id, code, message) { send({ jsonrpc: "2.0", id, error: { code, message } }); }

const TOOLS = [
  {
    name: "dispatch_task",
    description: "Dispatch an agent task into NeuroWorks. Returns a jobId immediately (async). Use get_dispatch_result or wait_for_result to read the outcome.",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "The task for the NeuroWorks agent to perform." },
        callbackUrl: { type: "string", description: "Optional webhook URL; NeuroWorks POSTs the result there on completion (HMAC-signed)." },
        idempotencyKey: { type: "string", description: "Optional — a repeat with the same key returns the original jobId." },
        metadata: { type: "object", description: "Optional caller metadata echoed back in the result/webhook." },
      },
      required: ["task"],
    },
  },
  {
    name: "get_dispatch_result",
    description: "Fetch the current status and (if finished) the answer for a dispatched job.",
    inputSchema: { type: "object", properties: { jobId: { type: "string" } }, required: ["jobId"] },
  },
  {
    name: "wait_for_result",
    description: "Poll a dispatched job until it finishes (or timeout), then return the final status and answer.",
    inputSchema: {
      type: "object",
      properties: { jobId: { type: "string" }, timeoutMs: { type: "number", description: "Max wait (default 120000)." } },
      required: ["jobId"],
    },
  },
];

function authHeaders() {
  const h = { "content-type": "application/json" };
  if (API_KEY) h["authorization"] = `Bearer ${API_KEY}`;
  return h;
}

async function dispatch(args) {
  const r = await fetch(`${BASE}/api/v1/dispatch`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ task: args.task, callbackUrl: args.callbackUrl, idempotencyKey: args.idempotencyKey, metadata: args.metadata }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.message ?? j?.error ?? `dispatch ${r.status}`);
  return j;
}

async function getResult(jobId) {
  const r = await fetch(`${BASE}/api/v1/dispatch/${encodeURIComponent(jobId)}`, { headers: authHeaders() });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.message ?? j?.error ?? `get ${r.status}`);
  return j;
}

async function waitFor(jobId, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await getResult(jobId);
    if (v.status === "succeeded" || v.status === "failed") return v;
    if (Date.now() > deadline) return { ...v, timedOut: true };
    await new Promise(res => setTimeout(res, 2000));
  }
}

async function runTool(name, args) {
  if (!API_KEY && name === "dispatch_task") {
    throw new Error("NEUROWORKS_API_KEY is not set — mint one via POST /api/dispatch-keys and set it in this server's env.");
  }
  switch (name) {
    case "dispatch_task": return await dispatch(args);
    case "get_dispatch_result": return await getResult(args.jobId);
    case "wait_for_result": return await waitFor(args.jobId, args.timeoutMs ?? 120000);
    default: throw new Error(`unknown tool: ${name}`);
  }
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined || id === null) return; // notifications
  try {
    switch (method) {
      case "initialize":
        return result(id, {
          protocolVersion: params?.protocolVersion ?? PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "neuroworks-dispatch", version: "1.0.0" },
        });
      case "ping": return result(id, {});
      case "tools/list": return result(id, { tools: TOOLS });
      case "tools/call": {
        const name = params?.name;
        const args = params?.arguments ?? {};
        if (!name) return rpcError(id, -32602, "missing tool name");
        try {
          const res = await runTool(name, args);
          return result(id, { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] });
        } catch (e) {
          return result(id, { content: [{ type: "text", text: `Error: ${e?.message ?? e}` }], isError: true });
        }
      }
      default: return rpcError(id, -32601, `method not found: ${method}`);
    }
  } catch (e) {
    return rpcError(id, -32603, String(e?.message ?? e));
  }
}

let pending = 0, closed = false;
function maybeExit() { if (closed && pending === 0) setImmediate(() => process.exit(0)); }
const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const t = line.trim();
  if (!t) return;
  let msg; try { msg = JSON.parse(t); } catch { return; }
  pending++;
  Promise.resolve(handle(msg)).catch(() => {}).finally(() => { pending--; maybeExit(); });
});
rl.on("close", () => { closed = true; maybeExit(); });
