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
const port = Number(pick("NEUROWORKS_PORT", "7471"));

export const config = {
  githubToken,
  githubOwner,
  vaultRepo,
  vaultPath,
  ollamaHost,
  ollamaModel,
  port,
  ready: missing.length === 0,
  missing: [...missing],
};

if (missing.length > 0) {
  console.warn(`\n⚠  NeuroWorks server starting with degraded mode — missing: ${missing.join(", ")}`);
  console.warn(`   Copy .env.example -> .env and fill in to unlock GitHub/vault features.\n`);
}
