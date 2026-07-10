import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// .env lives at clawbot/.env (one level above server/). Try repo root first, then server-local fallback.
loadEnv({ path: resolve(__dirname, "../../../.env") });
loadEnv({ path: resolve(__dirname, "../../.env") });

const missing: string[] = [];

function pick(name: string, fallback?: string): string {
  const v = process.env[name]?.trim();
  if (v) return v;
  if (fallback !== undefined) return fallback;
  missing.push(name);
  return "";
}

const githubToken = pick("GITHUB_TOKEN");
const githubOwner = pick("GITHUB_OWNER", "RUBIEM-DEVELOPERS-REPO");
const vaultRepo = pick("VAULT_REPO", "RUBIEM-DEVELOPERS-REPO/main-brain");
const vaultPathRaw = pick("VAULT_PATH", "D:\\Main brain");
const vaultPath = resolve(vaultPathRaw);
const ollamaHost = pick("OLLAMA_HOST", "http://127.0.0.1:11434");
const ollamaModel = pick("OLLAMA_MODEL", "qwen2.5:3b"); // qwen3.5:0.8b retired — default to an installed model

// OpenRouter — optional cloud LLM provider used to accelerate slow profiles
// (planning/synthesis) when local Ollama can't keep up. Key absent = fully
// local mode (status quo). Profiles routed to OR are picked via OPENROUTER_PROFILES
// or per-profile model env vars (OPENROUTER_PLAN_MODEL etc.). Headers HTTP-Referer
// + X-Title are required by OpenRouter for free-tier requests.
const openrouterApiKey = pick("OPENROUTER_API_KEY", "");
const openrouterBaseUrl = pick("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1");
// Default model used when a profile is routed to OR but has no explicit model
// override. gpt-4o-mini is fast + cheap and handles all our profiles well.
const openrouterModel = pick("OPENROUTER_MODEL", "openai/gpt-4o-mini");
// LARGE-tier OR model — used automatically when the complexity heuristic
// fires (prompt too big for local context, or caller flags complexity:"high").
// Defaults to gpt-4o (full) but can be set to claude-3.5-sonnet, opus, etc.
// Setting this to the same as OPENROUTER_MODEL disables the tier split.
const openrouterLargeModel = pick("OPENROUTER_LARGE_MODEL", "openai/gpt-4o");
// Comma-separated profile list. When empty BUT OPENROUTER_API_KEY is set, all
// profiles route to OR if they have no Ollama-side env pin. When non-empty,
// only those profiles route to OR (rest stay on Ollama). Example:
//   OPENROUTER_PROFILES=planning,synthesis,triage
const openrouterProfiles = pick("OPENROUTER_PROFILES", "")
  .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
// HTTP-Referer / X-Title — OpenRouter wants these to identify the calling app.
// Defaults reflect a local NeuroWorks instance.
const openrouterAppUrl = pick("OPENROUTER_APP_URL", "https://neuroworks.local");
const openrouterAppName = pick("OPENROUTER_APP_NAME", "NeuroWorks Clawbot");

// Firecrawl — optional hosted scraping API used when vanilla fetch + local
// Playwright both fail (Cloudflare challenges, CAPTCHA gates, hard anti-bot).
// When the key is unset we skip Firecrawl entirely and rely on the existing
// fetch → playwright tiers. When set, smartFetch tries Firecrawl as a third
// tier so resilience-tier sites stop tanking the research pipeline.
const firecrawlApiKey = pick("FIRECRAWL_API_KEY", "");
const firecrawlBaseUrl = pick("FIRECRAWL_BASE_URL", "https://api.firecrawl.dev");

// MiniMax — optional hosted multimodal provider. Gives NeuroWorks a frontier
// cloud LLM (MiniMax-M3/M2.7, exposed over an Anthropic-compatible /messages
// endpoint) PLUS generative media the local stack can't do: text-to-speech,
// text/image-to-video, and music generation. All gated on MINIMAX_API_KEY —
// absent = these capabilities simply aren't offered (no behaviour change).
// The media endpoints live under the v1 REST base; the chat model uses the
// Anthropic-compatible base. Both share the one API key.
const minimaxApiKey = pick("MINIMAX_API_KEY", "");
const minimaxBaseUrl = pick("MINIMAX_BASE_URL", "https://api.minimax.io/v1");
const minimaxAnthropicUrl = pick("MINIMAX_ANTHROPIC_URL", "https://api.minimax.io/anthropic");
// Default chat model. M3 is the frontier 1M-context coder; M2.7-highspeed is
// the low-latency tier. Override per deployment.
const minimaxModel = pick("MINIMAX_MODEL", "MiniMax-M2.7");
const minimaxTtsModel = pick("MINIMAX_TTS_MODEL", "speech-2.8-hd");
const minimaxVideoModel = pick("MINIMAX_VIDEO_MODEL", "MiniMax-Hailuo-2.3");
const minimaxMusicModel = pick("MINIMAX_MUSIC_MODEL", "music-2.6");
// Optional — required only by the media (TTS/video/music) endpoints, which key
// outputs to a group. Chat works without it.
const minimaxGroupId = pick("MINIMAX_GROUP_ID", "");

// HeyGen — hosted AI avatar/spokesperson VIDEO generation (talking-head videos
// from a script + an avatar + a voice). Distinct from MiniMax's scene video:
// HeyGen is presenter/explainer style. Gated on HEYGEN_API_KEY; absent = the
// avatar-video capability simply isn't offered. Async API (create → poll).
const heygenApiKey = pick("HEYGEN_API_KEY", "");
const heygenBaseUrl = pick("HEYGEN_BASE_URL", "https://api.heygen.com");

// Payments — Stripe gateway for outbound billing (agents create payment links
// to bill clients) AND platform subscriptions (checkout sessions + billing
// portal). Implemented over the Stripe REST API via fetch — no SDK dependency.
// Gated on STRIPE_SECRET_KEY; absent = payments simply aren't offered. The
// webhook secret authenticates inbound Stripe events (signature, not origin).
const stripeSecretKey = pick("STRIPE_SECRET_KEY", "");
const stripePublishableKey = pick("STRIPE_PUBLISHABLE_KEY", "");
const stripeWebhookSecret = pick("STRIPE_WEBHOOK_SECRET", "");
// Default settlement currency. ZAR — rubiem.com is a South African operation.
const paymentsCurrency = pick("PAYMENTS_CURRENCY", "zar").toLowerCase();
// Where Stripe-hosted checkout returns the payer after success/cancel.
const paymentsSuccessUrl = pick("PAYMENTS_SUCCESS_URL", "https://neuroworks.local/paid");
const paymentsCancelUrl = pick("PAYMENTS_CANCEL_URL", "https://neuroworks.local/cancelled");

// Paynow (Zimbabwe) gateway — local-market payments (EcoCash, OneMoney, cards,
// bank). Gated on both credentials being present; sits alongside Stripe, not
// instead of it. resulturl is where Paynow POSTs status updates (must be
// publicly reachable in production); returnurl is where the payer lands after.
const paynowIntegrationId = pick("PAYNOW_INTEGRATION_ID", "");
const paynowIntegrationKey = pick("PAYNOW_INTEGRATION_KEY", "");
const paynowMerchantEmail = pick("PAYNOW_MERCHANT_EMAIL", "arthur@rubiem.com");
const paynowResultUrl = pick("PAYNOW_RESULT_URL", "https://neuroworks.local/api/payments/paynow/result");
const paynowReturnUrl = pick("PAYNOW_RETURN_URL", "https://neuroworks.local/paid");

// Hermes executor — when the primary executor is switched to Hermes (runtime
// toggle, see executor-mode.ts), tasks run through the Hermes CLI instead of
// clawbot's plan/execute pipeline. Hermes's own configured default model
// (claude-opus-4.6) is broken on the bundled key, so we pin a model that works.
// Override with HERMES_MODEL. Provider is OpenRouter to match.
const hermesModel = pick("HERMES_MODEL", "openai/gpt-oss-20b:free");
const hermesProvider = pick("HERMES_PROVIDER", "openrouter");

const port = Number(pick("NEUROWORKS_PORT", "7471"));
// Comma-separated list of peer clawbot base URLs. Each peer is another running
// instance of this same server (different port, optionally different model).
// Empty by default — single-clawbot mode. Example:
//   CLAWBOT_PEERS=http://127.0.0.1:7472,http://127.0.0.1:7473
const peers = pick("CLAWBOT_PEERS", "")
  .split(",").map(s => s.trim()).filter(Boolean);
// Optional human-readable name for this clawbot — shows up in /api/health and
// peer roll-call responses so dual-clawbot work can be told apart in logs.
const name = pick("CLAWBOT_NAME", "primary");
// Functional role for this clawbot. The chat router uses it to decide where
// to delegate persona-shifted work (away from "primary" toward "persona-shifter").
// Free-form, but recommended values are: primary | persona-shifter | general | reviewer.
const role = pick("CLAWBOT_ROLE", "primary");

// ── Production web serving + network bind ──────────────────────────────
// Locally, `pnpm dev` runs two processes: the Vite dev server (7470, proxies
// /api) and this API (loopback 7471). In the production container we instead
// build the SPA once and let THIS server serve the minified assets, so there's
// a single hardened process and no dev server exposed. All three toggles
// default to the local two-port behaviour so nothing changes for `pnpm dev`.
//   SERVE_WEB=1            → serve web/dist (built SPA) with a history fallback
//   NEUROWORKS_BIND_HOST   → 0.0.0.0 in a container so the port is reachable
//   NODE_ENV=production    → flips fail-fast validation on (see validateConfig)
const bindHost = pick("NEUROWORKS_BIND_HOST", "127.0.0.1");
// Enterprise mode — off by default (current local/loopback trust model is
// unchanged), flip to "1" the moment this instance is network-reachable
// (cloud VM, shared server, behind a proxy that isn't strictly loopback-only).
// Requires every non-exempt request to carry either a human session token or
// a "machine:full"-scoped API key (see lib/enterprise-auth.ts) — closes the
// gap where requireLayer() and origin-guard both explicitly let token-less /
// Origin-less requests through, which is fine for a single trusted machine
// but not once the port is reachable from a wider network. Same-machine
// requests (loopback remoteAddress) stay exempt regardless, so local peers/
// workers keep working with zero extra config.
const enterpriseMode = ["1", "true", "yes"].includes(pick("NEUROWORKS_ENTERPRISE_MODE", "").toLowerCase());
const serveWeb = ["1", "true", "yes"].includes(pick("SERVE_WEB", "").toLowerCase());
// web/dist sits at clawbot/web/dist; __dirname is server/src (tsx) so ../../web/dist.
const webDistPath = resolve(__dirname, "../../web/dist");
const nodeEnv = (process.env.NODE_ENV ?? "development").trim().toLowerCase();
const isProduction = nodeEnv === "production";
// Strict env validation: on in production, or forced with NEUROWORKS_STRICT_ENV=1.
const strictEnv = isProduction || ["1", "true", "yes"].includes((process.env.NEUROWORKS_STRICT_ENV ?? "").toLowerCase());

export const config = {
  githubToken,
  githubOwner,
  vaultRepo,
  vaultPath,
  ollamaHost,
  ollamaModel,
  openrouterApiKey,
  openrouterBaseUrl,
  openrouterModel,
  openrouterLargeModel,
  openrouterProfiles,
  openrouterAppUrl,
  openrouterAppName,
  openrouterEnabled: openrouterApiKey.length > 0,
  firecrawlApiKey,
  firecrawlBaseUrl,
  firecrawlEnabled: firecrawlApiKey.length > 0,
  minimaxApiKey,
  minimaxBaseUrl,
  minimaxAnthropicUrl,
  minimaxModel,
  minimaxTtsModel,
  minimaxVideoModel,
  minimaxMusicModel,
  minimaxGroupId,
  minimaxEnabled: minimaxApiKey.length > 0,
  heygenApiKey,
  heygenBaseUrl,
  heygenEnabled: heygenApiKey.length > 0,
  stripeSecretKey,
  stripePublishableKey,
  stripeWebhookSecret,
  paymentsCurrency,
  paymentsSuccessUrl,
  paymentsCancelUrl,
  paymentsEnabled: stripeSecretKey.length > 0,
  paymentsProvider: "stripe" as const,
  paynowIntegrationId,
  paynowIntegrationKey,
  paynowMerchantEmail,
  paynowResultUrl,
  paynowReturnUrl,
  paynowEnabled: paynowIntegrationId.length > 0 && paynowIntegrationKey.length > 0,
  hermesModel,
  hermesProvider,
  port,
  peers,
  name,
  role,
  bindHost,
  enterpriseMode,
  serveWeb,
  webDistPath,
  nodeEnv,
  isProduction,
  strictEnv,
  ready: missing.length === 0,
  missing: [...missing],
};

if (missing.length > 0) {
  console.warn(`\n⚠  NeuroWorks server starting with degraded mode — missing: ${missing.join(", ")}`);
  console.warn(`   Copy .env.example -> .env and fill in to unlock GitHub/vault features.\n`);
}

// ── Fail-fast validation ───────────────────────────────────────────────
// Call once at boot BEFORE wiring routes. In strict mode (production, or
// NEUROWORKS_STRICT_ENV=1) any fatal misconfiguration exits with a clear,
// actionable message instead of surfacing as a confusing failure deep in a
// request. In non-strict/local mode these become warnings so `pnpm dev` still
// boots in degraded mode. Returns nothing; calls process.exit(1) on fatal.
export function validateConfig(): void {
  const fatal: string[] = [];
  const warn: string[] = [];

  // Port must be a real listenable number.
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    fatal.push(`NEUROWORKS_PORT="${process.env.NEUROWORKS_PORT ?? ""}" is not a valid TCP port (1-65535).`);
  }

  // Serving the built SPA requires the build to exist — otherwise every page
  // load 404s with no hint. Check for the entry file, not just the dir.
  if (serveWeb) {
    const indexHtml = resolve(webDistPath, "index.html");
    if (!existsSync(indexHtml)) {
      fatal.push(`SERVE_WEB is on but no built SPA found at ${webDistPath} — run "pnpm -F clawbot-web build" first.`);
    }
  }

  // Exposing the server beyond loopback without the origin guard is a DNS-
  // rebinding hole. Allow it only when explicitly overridden.
  if (bindHost !== "127.0.0.1" && bindHost !== "localhost" && process.env.CLAWBOT_ORIGIN_GUARD === "0") {
    warn.push(`bound to ${bindHost} with CLAWBOT_ORIGIN_GUARD=0 — the API is reachable off-host with no Host/Origin defense. Put it behind a trusted reverse proxy only.`);
  }
  // Wide bind + enterprise mode off means every route requireLayer() doesn't
  // cover (the majority — see lib/access.ts) has no auth for non-browser
  // callers at all; origin-guard only defends the browser-attack vector.
  if (bindHost !== "127.0.0.1" && bindHost !== "localhost" && !enterpriseMode) {
    warn.push(`bound to ${bindHost} with NEUROWORKS_ENTERPRISE_MODE unset — most routes have no authentication for non-browser callers. Set NEUROWORKS_ENTERPRISE_MODE=1 (and mint a "machine:full" API key for any cross-host peers) before exposing this beyond a single trusted machine.`);
  }

  // In strict mode the required env (GITHUB_TOKEN etc.) must actually be set.
  if (strictEnv && missing.length > 0) {
    fatal.push(`missing required env in production: ${missing.join(", ")}. Set these in .env or the container environment.`);
  }

  for (const w of warn) console.warn(`⚠  [config] ${w}`);

  if (fatal.length > 0) {
    console.error(`\n✖  NeuroWorks refused to start — fatal configuration ${fatal.length === 1 ? "error" : "errors"}:`);
    for (const f of fatal) console.error(`   • ${f}`);
    console.error(`\n   (strict validation is ${strictEnv ? "ON" : "OFF"}; set NEUROWORKS_STRICT_ENV=0 to downgrade to warnings for local dev.)\n`);
    process.exit(1);
  }
}
