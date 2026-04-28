import "dotenv/config";
import { resolve } from "node:path";

function must(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`Missing required env: ${name}. Copy .env.example -> .env in clawbot/ and fill it in.`);
    process.exit(1);
  }
  return v;
}

function opt(name: string, fallback: string): string {
  return (process.env[name]?.trim() || fallback);
}

export const config = {
  githubToken: must("GITHUB_TOKEN"),
  githubOwner: must("GITHUB_OWNER"),
  vaultRepo: must("VAULT_REPO"),
  vaultPath: resolve(must("VAULT_PATH")),
  ollamaHost: opt("OLLAMA_HOST", "http://127.0.0.1:11434"),
  ollamaModel: opt("OLLAMA_MODEL", "qwen3.5:0.8b"),
  port: Number(opt("NEUROWORKS_PORT", "5174")),
};
