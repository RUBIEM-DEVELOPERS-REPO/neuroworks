#!/usr/bin/env node
// nw — NeuroWorks dispatch CLI. A thin client over /api/v1/dispatch + the
// operator key-management endpoints, for scripting and terminal use.
//
//   Env:  NW_BASE     (default http://127.0.0.1:7471)
//         NW_API_KEY  (nw_… — required for dispatch/result)
//
//   nw dispatch "Summarise today's sales" --wait
//   nw dispatch "..." --callback https://app/webhook --idem order-42
//   nw result <jobId>
//   nw keys:create "partner-app"
//   nw keys:list
//   nw keys:revoke <keyId>
//
// Key management talks to /api/dispatch-keys (operator-only; works because the
// CLI is a server-to-server call with no browser Origin).

const BASE = (process.env.NW_BASE ?? "http://127.0.0.1:7471").replace(/\/$/, "");
const API_KEY = process.env.NW_API_KEY ?? "";

function die(msg) { console.error(`nw: ${msg}`); process.exit(1); }
function out(obj) { console.log(typeof obj === "string" ? obj : JSON.stringify(obj, null, 2)); }

// Minimal flag parser: returns { _: [positionals], flag: value|true }.
function parse(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith("--")) {
      const key = t.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) { a[key] = next; i++; } else { a[key] = true; }
    } else a._.push(t);
  }
  return a;
}

async function api(path, { method = "GET", body, key = false } = {}) {
  const headers = { "content-type": "application/json" };
  if (key) {
    if (!API_KEY) die("NW_API_KEY is not set (mint one: nw keys:create <label>)");
    headers["authorization"] = `Bearer ${API_KEY}`;
  }
  const r = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) die(j.message || j.error || `${method} ${path} -> ${r.status}`);
  return j;
}

async function waitFor(jobId, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await api(`/api/v1/dispatch/${encodeURIComponent(jobId)}`, { key: true });
    if (v.status === "succeeded" || v.status === "failed") return v;
    if (Date.now() > deadline) return { ...v, timedOut: true };
    process.stderr.write(".");
    await new Promise(res => setTimeout(res, 2000));
  }
}

const HELP = `nw — NeuroWorks dispatch CLI

  nw dispatch "<task>" [--wait] [--json] [--callback <url>] [--idem <key>]
  nw result <jobId>
  nw keys:create "<label>"
  nw keys:list
  nw keys:revoke <keyId>

  env: NW_BASE (default ${BASE}), NW_API_KEY`;

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parse(rest);

  switch (cmd) {
    case "dispatch": {
      const task = args._[0];
      if (!task) die('usage: nw dispatch "<task>" [--wait]');
      const headers = args.idem ? { idempotencyKey: String(args.idem) } : {};
      const body = { task, callbackUrl: args.callback ? String(args.callback) : undefined, ...headers };
      const accepted = await api("/api/v1/dispatch", { method: "POST", body, key: true });
      if (!args.wait) return out(accepted);
      const final = await waitFor(accepted.jobId, args.timeout ? Number(args.timeout) : 120000);
      process.stderr.write("\n");
      return out(args.json ? final : (final.answer ?? `[${final.status}] ${final.error ?? "(no answer)"}`));
    }
    case "result": {
      const jobId = args._[0];
      if (!jobId) die("usage: nw result <jobId>");
      return out(await api(`/api/v1/dispatch/${encodeURIComponent(jobId)}`, { key: true }));
    }
    case "keys:create": {
      const label = args._[0];
      if (!label) die('usage: nw keys:create "<label>"');
      const r = await api("/api/dispatch-keys", { method: "POST", body: { label } });
      console.error("Save this token now — it is shown only once:");
      return out(r);
    }
    case "keys:list": return out(await api("/api/dispatch-keys"));
    case "keys:revoke": {
      const id = args._[0];
      if (!id) die("usage: nw keys:revoke <keyId>");
      return out(await api(`/api/dispatch-keys/${encodeURIComponent(id)}`, { method: "DELETE" }));
    }
    case undefined:
    case "help":
    case "--help":
    case "-h":
      return out(HELP);
    default:
      die(`unknown command "${cmd}". Run "nw help".`);
  }
}

main().catch(e => die(e?.message ?? String(e)));
