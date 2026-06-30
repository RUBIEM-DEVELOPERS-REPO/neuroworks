// Small-model harness powered by little-coder (npm install -g little-coder).
//
// When CLAWBOT_USE_LITTLE_CODER=1 and the active model is a local small model
// (Ollama / llama.cpp / LM Studio), the agent loop defers to little-coder's
// small-model-optimised execution path instead of using the generic Ollama
// dispatch. OpenRouter / cloud models continue using the existing code path.
//
// little-coder brings:
//   - pi-based agent loop tuned for small context windows (8K-32K)
//   - Extensions that adapt tool calling, planning, and synthesis for small models
//   - Skill markdown files that guide output quality
//   - Automatic context window detection (llama.cpp only)
//
// Usage:
//   npm install -g little-coder
//   export CLAWBOT_USE_LITTLE_CODER=1
//   # When using a small local model, the harness auto-activates.
//   # Export CLAWBOT_LITTLE_CODER_MODEL=ollama/qwen3.5 to pin a specific model.

import { execSync, execFile } from "node:child_process";
import { existsSync } from "node:fs";

const LC_MODEL_ENV = "CLAWBOT_LITTLE_CODER_MODEL";
const LC_ENABLED_ENV = "CLAWBOT_USE_LITTLE_CODER";

// Models considered "small" — when they match, the harness can kick in.
const SMALL_MODEL_PATTERNS = [
  /qwen2\.5:[0-9]+b?$/i,
  /qwen3\.5:[0-9]+b?$/i,
  /qwen3:[0-9]+b?$/i,
  /gemma[0-9]?:[0-9]+b?$/i,
  /llama3?\.[0-9]:[0-9]+b?$/i,
  /phi[0-9]?:?[0-9]*/i,
  /tinyllama/i,
  /mistral[0-9]?:?[0-9]*b?$/i,
  /deepseek.*[0-9]+b?$/i,
  /smollm/i,
];

export function isLittleCoderAvailable(): boolean {
  try {
    execSync("little-coder --version", { timeout: 5000, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function isSmallModel(model: string): boolean {
  return SMALL_MODEL_PATTERNS.some(p => p.test(model));
}

export function isHarnessEnabled(): boolean {
  return process.env[LC_ENABLED_ENV] === "1";
}

export function getLittleCoderModel(): string | undefined {
  return process.env[LC_MODEL_ENV] || undefined;
}

export function shouldUseHarness(model: string): boolean {
  if (!isHarnessEnabled()) return false;
  if (!isLittleCoderAvailable()) return false;
  // Only use harness for local small models — cloud models keep existing path.
  if (model.includes("/") && !model.startsWith("ollama/") && !model.startsWith("llamacpp/") && !model.startsWith("lmstudio/")) return false;
  return isSmallModel(model);
}

export async function executeViaLittleCoder(
  prompt: string,
  system: string | undefined,
  opts: { model?: string; maxTokens?: number; temperature?: number } = {},
): Promise<{ text: string; model: string }> {
  const lcModel = getLittleCoderModel() || opts.model || "ollama/qwen3.5";

  // Build the task with system prompt as context
  const task = system ? `${system}\n\n${prompt}` : prompt;

  return new Promise((resolve, reject) => {
    const child = execFile(
      "little-coder",
      [
        "--model", lcModel,
        "-p", task,
        "--no-tui",
        ...(opts.maxTokens ? ["--max-tokens", String(opts.maxTokens)] : []),
      ],
      {
        timeout: 120_000,
        maxBuffer: 2 * 1024 * 1024,
        env: { ...process.env, LITTLE_CODER_NO_TUI: "1" },
      },
      (error, stdout, stderr) => {
        if (error) {
          // Timeout or execution error
          reject(new Error(`little-coder failed: ${error.message}${stderr ? `\n${stderr.slice(0, 500)}` : ""}`));
          return;
        }
        const text = stdout.trim();
        if (!text) {
          reject(new Error("little-coder returned empty output"));
          return;
        }
        resolve({ text, model: `little-coder/${lcModel}` });
      },
    );
  });
}
