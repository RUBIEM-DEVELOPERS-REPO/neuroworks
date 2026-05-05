import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ollamaGenerate } from "./ollama.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = resolve(__dirname, "../../../.neuroworks");
const FILE = join(STATE_DIR, "personas.json");

export type Persona = {
  id: string;
  name: string;
  role: string;            // short title — "Marketing Specialist"
  description: string;     // 1-line summary of the persona
  jobDescription: string;  // raw JD text the persona was created from
  tone: string;            // e.g. "concise · warm · formal"
  responsibilities: string[];
  systemPromptOverride?: string;
  createdAt: string;
};

export type PersonaStore = {
  personas: Persona[];
  activeId: string | null;
};

let cache: PersonaStore | null = null;

export function loadPersonas(): PersonaStore {
  if (cache) return cache;
  if (!existsSync(FILE)) { cache = { personas: [], activeId: null }; return cache; }
  try {
    const data = JSON.parse(readFileSync(FILE, "utf8"));
    cache = { personas: Array.isArray(data.personas) ? data.personas : [], activeId: data.activeId ?? null };
  } catch { cache = { personas: [], activeId: null }; }
  return cache;
}

export function savePersonaStore(s: PersonaStore): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(s, null, 2), "utf8");
  cache = s;
}

export function addPersona(p: Persona): void {
  const s = loadPersonas();
  const idx = s.personas.findIndex(x => x.id === p.id);
  if (idx >= 0) s.personas[idx] = p;
  else s.personas.push(p);
  savePersonaStore(s);
}

export function deletePersona(id: string): boolean {
  const s = loadPersonas();
  const idx = s.personas.findIndex(x => x.id === id);
  if (idx === -1) return false;
  s.personas.splice(idx, 1);
  if (s.activeId === id) s.activeId = null;
  savePersonaStore(s);
  return true;
}

export function setActivePersona(id: string | null): Persona | null {
  const s = loadPersonas();
  if (id === null) { s.activeId = null; savePersonaStore(s); return null; }
  const p = s.personas.find(x => x.id === id);
  if (!p) throw new Error(`persona not found: ${id}`);
  s.activeId = id;
  savePersonaStore(s);
  return p;
}

export function getActivePersona(): Persona | null {
  const s = loadPersonas();
  if (!s.activeId) return null;
  return s.personas.find(x => x.id === s.activeId) ?? null;
}

export function slugifyId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "persona";
}

// Returns a system-prompt suffix that frames clawbot's behavior as the active persona.
// Used by chat + agent so all reasoning is colored by the active role.
export function personaSystemSuffix(p: Persona | null): string {
  if (!p) return "";
  if (p.systemPromptOverride) return p.systemPromptOverride;
  const respList = p.responsibilities.length > 0
    ? `Responsibilities:\n${p.responsibilities.map(r => `- ${r}`).join("\n")}`
    : "";
  return [
    `You are operating as a ${p.role} called "${p.name}".`,
    p.description,
    respList,
    p.tone ? `Tone: ${p.tone}.` : "",
    `Frame every response, plan, and tool choice through this role. When the task is outside your role, say so explicitly and suggest who the user should ask.`,
  ].filter(Boolean).join("\n");
}

// Use the local LLM to extract role / description / tone / responsibilities from a job description.
// Heuristic fallback if Ollama can't return clean JSON.
export async function extractPersonaMetadata(jd: string): Promise<{ role: string; description: string; tone: string; responsibilities: string[] }> {
  const sys = `Extract structured metadata from a job description. Output ONLY a JSON object with this exact shape, no prose:
{"role":"<short title, max 5 words>","description":"<one-sentence summary of what this role does>","tone":"<2-3 adjectives, e.g. 'concise · analytical · warm'>","responsibilities":["<bullet>","<bullet>","<bullet>"]}
Pick at most 6 responsibilities, each under 12 words.`;
  try {
    // JD extraction = strict JSON output, modest reasoning.
    const out = await ollamaGenerate(jd.slice(0, 6000), sys, { profile: "extraction" });
    const m = out.match(/\{[\s\S]*\}/);
    if (m) {
      const parsed = JSON.parse(m[0]);
      return {
        role: String(parsed.role ?? "Specialist").slice(0, 80),
        description: String(parsed.description ?? "").slice(0, 240),
        tone: String(parsed.tone ?? "professional").slice(0, 80),
        responsibilities: Array.isArray(parsed.responsibilities) ? parsed.responsibilities.slice(0, 8).map((r: any) => String(r).slice(0, 160)) : [],
      };
    }
  } catch {}
  return heuristicExtract(jd);
}

function heuristicExtract(jd: string): { role: string; description: string; tone: string; responsibilities: string[] } {
  const lines = jd.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const roleLine = lines.find(l => /role|position|title/i.test(l)) ?? lines[0] ?? "Specialist";
  const role = roleLine.replace(/^.*?:\s*/, "").slice(0, 80);
  const responsibilities: string[] = [];
  let inResp = false;
  for (const l of lines) {
    if (/responsibilit|duties|you (?:will|do)/i.test(l)) { inResp = true; continue; }
    if (inResp) {
      if (/^(qualifications|requirements|skills|experience|about)/i.test(l)) break;
      const m = l.match(/^[-•·*]\s*(.+)/);
      if (m) responsibilities.push(m[1].slice(0, 160));
      else if (l.endsWith(".")) responsibilities.push(l.slice(0, 160));
    }
    if (responsibilities.length >= 6) break;
  }
  return {
    role,
    description: (lines[1] ?? "").slice(0, 240),
    tone: "professional",
    responsibilities,
  };
}
