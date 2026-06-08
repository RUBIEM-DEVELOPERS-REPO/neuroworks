// Self-healing inbound tunnel for the Mailjet Parse webhook.
//
// A cloudflared *quick* tunnel gets a fresh random URL every start. Rather than
// pin Mailjet to a URL that dies on restart, this supervisor:
//   1. starts cloudflared against the webhook port,
//   2. reads the new https://*.trycloudflare.com URL,
//   3. updates the Mailjet parse route's Url IN PLACE (PUT) — preserving the
//      stable inbound address (eJqt-...@parse-in1.mailjet.com), so the address
//      the user mails never changes,
//   4. restarts cloudflared if it dies and re-points the route.
//
// Run: node tools/inbound-tunnel.mjs   (expects the clawbot webhook on the port
// in CLAWBOT_EMAIL_INBOUND_PORT, and Mailjet creds + token in clawbot/.env).
//
// No secrets are printed; the route Url (which embeds the token) is sent only to
// Mailjet over HTTPS, never logged.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  const txt = readFileSync(resolve(ROOT, ".env"), "utf8");
  const env = {};
  for (const line of txt.split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return env;
}

const env = loadEnv();
const KEY = env.CLAWBOT_MAILJET_API_KEY;
const SEC = env.CLAWBOT_MAILJET_API_SECRET;
const TOKEN = env.CLAWBOT_EMAIL_INBOUND_TOKEN;
const PORT = env.CLAWBOT_EMAIL_INBOUND_PORT || "7475";
const CFD = resolve(ROOT, ".tools", "cloudflared.exe");

if (!KEY || !SEC) { console.error("[tunnel] missing Mailjet creds in .env"); process.exit(1); }
if (!TOKEN) { console.error("[tunnel] missing CLAWBOT_EMAIL_INBOUND_TOKEN in .env"); process.exit(1); }

const mjAuth = "Basic " + Buffer.from(`${KEY}:${SEC}`).toString("base64");

async function getParseRoute() {
  const res = await fetch("https://api.mailjet.com/v3/REST/parseroute", { headers: { authorization: mjAuth } });
  if (!res.ok) throw new Error(`parseroute GET ${res.status}`);
  const j = await res.json();
  return j?.Data?.[0] ?? null; // one route per API key in our setup
}

async function pointRouteAt(publicUrl) {
  const url = `${publicUrl}/inbound?token=${TOKEN}`;
  const existing = await getParseRoute();
  if (existing?.ID) {
    // PUT updates Url in place — keeps the same inbound Email address.
    const res = await fetch(`https://api.mailjet.com/v3/REST/parseroute/${existing.ID}`, {
      method: "PUT", headers: { authorization: mjAuth, "content-type": "application/json" },
      body: JSON.stringify({ Url: url }),
    });
    if (!res.ok) throw new Error(`parseroute PUT ${res.status}: ${(await res.text()).slice(0, 200)}`);
    console.log(`[tunnel] route ${existing.ID} re-pointed · inbound address: ${existing.Email}`);
  } else {
    const res = await fetch("https://api.mailjet.com/v3/REST/parseroute", {
      method: "POST", headers: { authorization: mjAuth, "content-type": "application/json" },
      body: JSON.stringify({ Url: url }),
    });
    if (!res.ok) throw new Error(`parseroute POST ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const created = (await res.json())?.Data?.[0];
    console.log(`[tunnel] route created · inbound address: ${created?.Email}`);
  }
}

let child = null;
let lastUrl = null;
let stopping = false;
// Exponential backoff between restarts. Cloudflare rate-limits (HTTP 429 /
// error 1015) the account-less quick-tunnel provisioning endpoint, and a tight
// fixed restart loop will trip it — banning us for longer. Start at 5s, double
// on each failed start, cap at 5min, and reset to 5s once a tunnel comes up.
const BACKOFF_MIN = 5_000;
const BACKOFF_MAX = 300_000;
let backoffMs = BACKOFF_MIN;
let sawUrlThisRun = false;

let urlAt = 0;          // when the current URL was first seen (warm-up timer)
let everHealthy = false; // has THIS tunnel ever passed a health probe?
const WARMUP_MS = 45_000; // quick tunnels take time to become reachable

function startTunnel() {
  console.log(`[tunnel] starting cloudflared → http://127.0.0.1:${PORT}`);
  sawUrlThisRun = false;
  urlAt = 0;
  everHealthy = false;
  child = spawn(CFD, ["tunnel", "--url", `http://127.0.0.1:${PORT}`, "--no-autoupdate"], { stdio: ["ignore", "pipe", "pipe"] });
  const onData = (buf) => {
    const s = String(buf);
    if (/error code: 1015|429 Too Many Requests/i.test(s)) {
      console.warn("[tunnel] Cloudflare rate-limited the quick-tunnel request (1015/429) — backing off");
    }
    // Match ONLY a real quick-tunnel host: random multi-word hyphenated
    // subdomain. Excludes api.trycloudflare.com (the provisioning host, which
    // appears in rate-limit/error output and must never be registered).
    const m = s.match(/https:\/\/[a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com/);
    if (m && m[0] !== lastUrl) {
      lastUrl = m[0];
      urlAt = Date.now();
      sawUrlThisRun = true;
      backoffMs = BACKOFF_MIN; // healthy start → reset backoff
      console.log(`[tunnel] public URL: ${lastUrl}`);
      pointRouteAt(lastUrl).catch(e => console.error(`[tunnel] route update failed: ${e.message}`));
    }
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.on("exit", (code) => {
    child = null; lastUrl = null;
    if (stopping) return;
    // If the run never produced a URL, it failed fast (likely rate-limited) —
    // grow the backoff. If it ran fine for a while then died, start gentle.
    if (!sawUrlThisRun) backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX);
    else backoffMs = BACKOFF_MIN;
    console.warn(`[tunnel] cloudflared exited (${code}) — restarting in ${Math.round(backoffMs / 1000)}s`);
    setTimeout(startTunnel, backoffMs);
  });
}

// Liveness probe — a cloudflared *quick* tunnel can have its edge hostname
// silently dropped (the process keeps running but the public URL stops
// resolving), so the child.on("exit") restart never fires and Mailjet keeps
// POSTing into a black hole. We GET the public /health through the tunnel on
// an interval; after two consecutive failures we kill cloudflared so the exit
// handler rebuilds a fresh URL and re-points the Mailjet route. DNS-not-found
// vs timeout both count as failures.
let healthFails = 0;
async function probe() {
  if (stopping || !child || !lastUrl) return;     // nothing to probe yet
  if (Date.now() - urlAt < WARMUP_MS) return;     // give a fresh tunnel time to come up
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 10_000);
  let ok = false;
  try {
    const res = await fetch(`${lastUrl}/health`, { signal: ac.signal });
    ok = res.ok;
  } catch { ok = false; }
  finally { clearTimeout(t); }

  if (ok) {
    if (healthFails) console.log("[tunnel] health recovered");
    healthFails = 0;
    everHealthy = true;
    return;
  }
  // Only treat failures as a real outage once the tunnel has proven itself
  // healthy at least once. Before that, it's still warming up (or Cloudflare
  // is slow to publish the route) — recycling would just thrash and risk the
  // 1015 rate-limit. cloudflared's own reconnection covers the warm-up.
  if (!everHealthy) return;
  healthFails += 1;
  console.warn(`[tunnel] health check failed (${healthFails}/3) for ${lastUrl}`);
  if (healthFails >= 3) {
    console.warn("[tunnel] tunnel was healthy but is now unreachable — recycling for a fresh URL");
    healthFails = 0;
    try { child?.kill(); } catch {} // exit handler restarts + re-registers
  }
}
const probeTimer = setInterval(() => { void probe(); }, 60_000);
probeTimer.unref?.();

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => { stopping = true; clearInterval(probeTimer); try { child?.kill(); } catch {} process.exit(0); });
}

startTunnel();
