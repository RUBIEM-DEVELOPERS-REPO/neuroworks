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

function startTunnel() {
  console.log(`[tunnel] starting cloudflared → http://127.0.0.1:${PORT}`);
  child = spawn(CFD, ["tunnel", "--url", `http://127.0.0.1:${PORT}`, "--no-autoupdate"], { stdio: ["ignore", "pipe", "pipe"] });
  const onData = (buf) => {
    const m = String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && m[0] !== lastUrl) {
      lastUrl = m[0];
      console.log(`[tunnel] public URL: ${lastUrl}`);
      pointRouteAt(lastUrl).catch(e => console.error(`[tunnel] route update failed: ${e.message}`));
    }
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.on("exit", (code) => {
    child = null; lastUrl = null;
    if (stopping) return;
    console.warn(`[tunnel] cloudflared exited (${code}) — restarting in 5s`);
    setTimeout(startTunnel, 5000);
  });
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => { stopping = true; try { child?.kill(); } catch {} process.exit(0); });
}

startTunnel();
