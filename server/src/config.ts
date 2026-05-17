import { config as loadEnv } from "dotenv";
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
const ollamaModel = pick("OLLAMA_MODEL", "qwen3.5:0.8b");

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
  port,
  peers,
  name,
  role,
  ready: missing.length === 0,
  missing: [...missing],
};

if (missing.length > 0) {
  console.warn(`\n⚠  NeuroWorks server starting with degraded mode — missing: ${missing.join(", ")}`);
  console.warn(`   Copy .env.example -> .env and fill in to unlock GitHub/vault features.\n`);
}
