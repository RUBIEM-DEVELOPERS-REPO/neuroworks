import { config } from "../config.js";

export type ModelInfo = {
  name: string;
  family: string;
  paramSize?: string;
  sizeGB?: number;
  // Heuristic capabilities. Filled from KNOWN_PROFILES on registry load; falls
  // back to a sensible default if the model isn't in the table.
  capabilities: Capabilities;
};

// Each task arrives with a "needs" vector — the routing algorithm picks the
// model whose capabilities best satisfy those needs at the lowest cost.
//
// Cost is normalised so a 1B model is ~1, a 4B model is ~4, etc.
// Higher is better for everything except `cost` (lower is better).
export type Capabilities = {
  jsonStrict: number;     // 0-10. Reliability of producing valid JSON without prose noise.
  reasoning: number;      // 0-10. Multi-step deduction, planning, math.
  longForm: number;       // 0-10. Coherent prose 200+ words.
  speed: number;          // 0-10. Tokens/sec on this hardware (subjective).
  cost: number;           // 1-10. Lower = cheaper. Roughly param_count_in_B.
};

export type TaskNeeds = Partial<{
  jsonStrict: number;
  reasoning: number;
  longForm: number;
  speed: number;
  // Hard requirement — only consider models whose name matches one of these patterns
  must: RegExp[];
  // Hard rejection — exclude models matching any of these
  exclude: RegExp[];
}>;

// Profiles for models we know well. Anything not in here gets `defaultProfile`.
const KNOWN_PROFILES: Record<string, Partial<Capabilities>> = {
  // Fast, structured-output strong, no thinking overhead. Our default.
  "qwen2.5:3b":      { jsonStrict: 9, reasoning: 6, longForm: 8, speed: 7, cost: 3 },
  "qwen2.5:7b":      { jsonStrict: 9, reasoning: 8, longForm: 9, speed: 5, cost: 7 },
  "qwen2.5:1.5b":    { jsonStrict: 7, reasoning: 4, longForm: 5, speed: 9, cost: 2 },
  // Reasoning-mode capable but mandatory CoT eats throughput on Ollama 0.22.
  // Practical cost is well above the param-count would suggest — bump it so the
  // router only picks qwen3 when reasoning weight strongly justifies it.
  "qwen3:4b":        { jsonStrict: 7, reasoning: 9, longForm: 6, speed: 3, cost: 8 },
  // Sub-1B; only suitable for short structured replies and quick checks.
  "qwen3.5:0.8b":    { jsonStrict: 5, reasoning: 3, longForm: 4, speed: 10, cost: 1 },
  // Gemma family — strong on prose, weaker on strict JSON without coercion.
  "gemma2:2b":       { jsonStrict: 6, reasoning: 5, longForm: 7, speed: 8, cost: 2 },
  "gemma2:9b":       { jsonStrict: 7, reasoning: 8, longForm: 9, speed: 4, cost: 9 },
  // Llama 3.2 instruct — balanced.
  "llama3.2:3b":     { jsonStrict: 7, reasoning: 6, longForm: 7, speed: 7, cost: 3 },
  "llama3.2:1b":     { jsonStrict: 5, reasoning: 4, longForm: 5, speed: 9, cost: 1 },
};

const defaultProfile: Capabilities = { jsonStrict: 6, reasoning: 5, longForm: 6, speed: 6, cost: 5 };

let cache: { at: number; models: ModelInfo[] } | null = null;
const CACHE_MS = 30_000;

export async function listModels(): Promise<ModelInfo[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.models;
  try {
    const res = await fetch(`${config.ollamaHost}/api/tags`);
    if (!res.ok) throw new Error(`Ollama tags: HTTP ${res.status}`);
    const data = await res.json() as { models: { name: string; size: number; details: { family: string; parameter_size?: string } }[] };
    const models = data.models.map(m => {
      const partial = KNOWN_PROFILES[m.name] ?? {};
      return {
        name: m.name,
        family: m.details.family,
        paramSize: m.details.parameter_size,
        sizeGB: Math.round(m.size / 1e8) / 10,
        capabilities: { ...defaultProfile, ...partial } as Capabilities,
      };
    });
    cache = { at: Date.now(), models };
    return models;
  } catch {
    // Offline or Ollama down — fall back to the configured model alone so the
    // rest of the system keeps working in degraded mode.
    return [{
      name: config.ollamaModel,
      family: "unknown",
      capabilities: defaultProfile,
    }];
  }
}

// Score = weighted sum of (capability * need) minus cost penalty. Higher wins.
export function scoreModel(m: ModelInfo, needs: TaskNeeds): number {
  const c = m.capabilities;
  let score = 0;
  if (needs.jsonStrict) score += c.jsonStrict * needs.jsonStrict;
  if (needs.reasoning) score += c.reasoning * needs.reasoning;
  if (needs.longForm) score += c.longForm * needs.longForm;
  if (needs.speed) score += c.speed * needs.speed;
  // Cost is a flat penalty so big models only win when their capabilities really matter.
  score -= c.cost * 0.5;
  return score;
}

export async function pickModel(needs: TaskNeeds, fallback?: string): Promise<string> {
  const all = await listModels();
  let candidates = all;
  if (needs.must && needs.must.length) {
    candidates = candidates.filter(m => needs.must!.some(re => re.test(m.name)));
  }
  if (needs.exclude && needs.exclude.length) {
    candidates = candidates.filter(m => !needs.exclude!.some(re => re.test(m.name)));
  }
  if (candidates.length === 0) return fallback ?? config.ollamaModel;
  candidates.sort((a, b) => scoreModel(b, needs) - scoreModel(a, needs));
  return candidates[0].name;
}

// Stock task profiles used by the agent loop. Each plan step OR an entire task
// can be tagged with one of these so we don't have to hand-craft `needs` every
// time. Add more as new task shapes emerge.
export const TASK_PROFILES = {
  // Short, structured plan emission. JSON strictness > reasoning > speed.
  planning:    { jsonStrict: 5, reasoning: 3, speed: 2 } as TaskNeeds,
  // Long-form synthesis from gathered evidence. Prose > reasoning > speed.
  synthesis:   { longForm: 5, reasoning: 3, speed: 2 } as TaskNeeds,
  // Quick yes/no, classify, route. Speed > strictness > everything else.
  triage:      { speed: 5, jsonStrict: 3, reasoning: 1 } as TaskNeeds,
  // Persona/JD extraction — strict JSON output with moderate reasoning.
  extraction:  { jsonStrict: 5, reasoning: 2, speed: 1 } as TaskNeeds,
  // General-purpose default; balanced across axes.
  balanced:    { jsonStrict: 3, reasoning: 3, longForm: 3, speed: 3 } as TaskNeeds,
};

// Convenience for primitives that want to ask "give me the right model for this kind of task".
export async function pickModelFor(profile: keyof typeof TASK_PROFILES, fallback?: string): Promise<string> {
  return pickModel(TASK_PROFILES[profile], fallback);
}
