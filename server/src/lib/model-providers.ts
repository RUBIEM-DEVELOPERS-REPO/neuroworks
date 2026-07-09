// Bring-your-own model providers. Lets a user plug in a model API they already
// use (OpenAI, OpenRouter, Groq, Together, or any OpenAI-compatible endpoint)
// without editing .env. The active provider is applied to the runtime LLM
// router config so it takes effect immediately, and persisted (key encrypted)
// so it survives a restart.
//
// We route everything through the existing OpenRouter-compatible code path
// (chat-completions), which is the lingua franca for these APIs — so applying a
// provider is just setting config.openrouter{ApiKey,BaseUrl,Model,Enabled}.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { encryptSecret, decryptSecret, isEncrypted } from "./secret-box.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = resolve(__dirname, "../../../.neuroworks");
const PATH = resolve(STATE_DIR, "model-providers.json");

export type ProviderKind = "anthropic" | "openai" | "openrouter" | "groq" | "together" | "custom";

export const PROVIDER_DEFAULTS: Record<ProviderKind, { label: string; baseUrl: string; modelHint: string }> = {
  // Anthropic via its OpenAI-compatible endpoint (/v1/chat/completions), so it
  // flows through the same client (Bearer auth, streaming) as every other
  // provider — no separate Messages-API client needed. Model IDs are the native
  // Claude ones. Default = Fable 5 (latest); alternatives: claude-opus-4-8 (max
  // quality), claude-sonnet-4-6 (workhorse), claude-haiku-4-5-20251001 (cheapest).
  anthropic:  { label: "Anthropic (Claude)", baseUrl: "https://api.anthropic.com/v1", modelHint: "claude-fable-5" },
  openai:     { label: "OpenAI",     baseUrl: "https://api.openai.com/v1",      modelHint: "gpt-4o-mini" },
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1",   modelHint: "openai/gpt-4o-mini" },
  groq:       { label: "Groq",       baseUrl: "https://api.groq.com/openai/v1", modelHint: "llama-3.3-70b-versatile" },
  together:   { label: "Together",   baseUrl: "https://api.together.xyz/v1",    modelHint: "meta-llama/Llama-3.3-70B-Instruct-Turbo" },
  custom:     { label: "Custom (OpenAI-compatible)", baseUrl: "", modelHint: "" },
};

export type ModelProvider = {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  model: string;
  apiKey: string;       // encrypted at rest
  active: boolean;
  createdAt: string;
};

export type ModelProviderPublic = Omit<ModelProvider, "apiKey"> & { keyPrefix: string };

function load(): ModelProvider[] {
  try {
    if (!existsSync(PATH)) return [];
    const parsed = JSON.parse(readFileSync(PATH, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function save(list: ModelProvider[]): void {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
  const onDisk = list.map(p => ({ ...p, apiKey: isEncrypted(p.apiKey) ? p.apiKey : encryptSecret(p.apiKey) }));
  writeFileSync(PATH, JSON.stringify(onDisk, null, 2), { encoding: "utf8", mode: 0o600 });
}

function plainKey(p: ModelProvider): string {
  try { return isEncrypted(p.apiKey) ? decryptSecret(p.apiKey) : p.apiKey; } catch { return ""; }
}

function redact(p: ModelProvider): ModelProviderPublic {
  const { apiKey, ...rest } = p;
  const key = plainKey(p);
  return { ...rest, keyPrefix: key ? key.slice(0, 6) + "…" : "" };
}

export function listProviders(): ModelProviderPublic[] {
  return load().map(redact).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function addProvider(input: { label?: string; kind: ProviderKind; baseUrl?: string; model: string; apiKey: string; active?: boolean }): ModelProviderPublic {
  const list = load();
  const def = PROVIDER_DEFAULTS[input.kind];
  const p: ModelProvider = {
    id: randomUUID(),
    label: (input.label ?? def.label).trim() || def.label,
    kind: input.kind,
    baseUrl: (input.baseUrl?.trim() || def.baseUrl),
    model: input.model.trim(),
    apiKey: input.apiKey.trim(),
    active: input.active ?? true,
    createdAt: new Date().toISOString(),
  };
  if (!p.baseUrl) throw new Error("baseUrl is required for a custom provider");
  if (!p.model) throw new Error("model is required");
  if (!p.apiKey) throw new Error("apiKey is required");
  // Only one active provider at a time.
  if (p.active) for (const other of list) other.active = false;
  list.push(p);
  save(list);
  if (p.active) applyToRuntime(p);
  return redact(p);
}

export function removeProvider(id: string): boolean {
  const list = load();
  const target = list.find(p => p.id === id);
  const next = list.filter(p => p.id !== id);
  if (next.length === list.length) return false;
  save(next);
  // If we removed the active provider, fall back to env-configured OpenRouter.
  if (target?.active) applyToRuntime(null);
  return true;
}

export function activateProvider(id: string): ModelProviderPublic | null {
  const list = load();
  const target = list.find(p => p.id === id);
  if (!target) return null;
  for (const p of list) p.active = p.id === id;
  save(list);
  applyToRuntime(target);
  return redact(target);
}

// Mutate the live router config so the provider takes effect with no restart.
// Passing null reverts to whatever the env originally set (captured once).
let envSnapshot: { apiKey: string; baseUrl: string; model: string; largeModel: string; enabled: boolean } | null = null;
function snapshotEnv(): void {
  if (envSnapshot) return;
  envSnapshot = {
    apiKey: config.openrouterApiKey,
    baseUrl: config.openrouterBaseUrl,
    model: config.openrouterModel,
    largeModel: config.openrouterLargeModel,
    enabled: config.openrouterEnabled,
  };
}

export function applyToRuntime(p: ModelProvider | null): void {
  snapshotEnv();
  if (!p) {
    if (envSnapshot) {
      config.openrouterApiKey = envSnapshot.apiKey;
      config.openrouterBaseUrl = envSnapshot.baseUrl;
      config.openrouterModel = envSnapshot.model;
      config.openrouterLargeModel = envSnapshot.largeModel;
      config.openrouterEnabled = envSnapshot.enabled;
    }
    return;
  }
  config.openrouterApiKey = plainKey(p);
  config.openrouterBaseUrl = p.baseUrl;
  // COST TIERING. The dispatcher (llm.ts) already splits every call into a
  // small tier (openrouterModel — planning, extraction, normal synth) and a
  // large tier (openrouterLargeModel — complexity:"high" or prompts over the
  // local context budget). Early Fable rollout set BOTH tiers to the
  // provider's model, which billed planning/triage-sized calls at frontier
  // rates (one oversized triage cost $0.096). For Anthropic providers the
  // small tier now defaults to Haiku ($1/$5 per MTok vs Fable's $10/$50) and
  // ONLY complex work hands off to the provider's chosen big model.
  // Overrides: ANTHROPIC_SMALL_MODEL pins the cheap tier;
  // ANTHROPIC_LARGE_MODEL pins the handoff target (e.g. claude-sonnet-5
  // instead of Fable).
  if (p.kind === "anthropic") {
    config.openrouterModel = (process.env.ANTHROPIC_SMALL_MODEL ?? "").trim() || "claude-haiku-4-5";
    config.openrouterLargeModel = (process.env.ANTHROPIC_LARGE_MODEL ?? "").trim() || p.model;
  } else {
    // Non-Anthropic providers: same model for both tiers (tier split disabled)
    // — leaving the env's large model in place would send an alien model id
    // to this provider's endpoint on big/complex synths → 404.
    config.openrouterModel = p.model;
    config.openrouterLargeModel = p.model;
  }
  config.openrouterEnabled = config.openrouterApiKey.length > 0;
}

// Called once at boot: re-apply the active provider so a UI-added key survives
// restarts (env still wins if no provider is marked active).
export function loadAndApplyActiveProvider(): void {
  const active = load().find(p => p.active);
  if (active) applyToRuntime(active);
}
