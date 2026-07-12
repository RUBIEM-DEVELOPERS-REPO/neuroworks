// Living per-persona profile — a short markdown doc, auto-maintained by the
// LLM, that captures what an AI employee has actually learned about how this
// organization works: recurring preferences, patterns in how work gets
// requested and reviewed, context that keeps coming up. Distinct from
// personas.ts's Persona (a human-authored, static role definition that
// never changes on its own): this evolves on its own, sourced from
// memory.ts facts and the daily reflection, and is read back into that
// persona's own system prompt on every task.
//
// Regeneration piggybacks on the existing daily reflection run (see
// reflection.ts's post-hook) rather than its own scheduler — one fewer
// timer, and it means the profile always has that day's reflection text
// on hand for free. Only regenerated for a persona that actually ran a
// task that day (reflection.ts's DailyStats.byPersona already tells us
// that) and at most once every REGEN_MIN_DAYS, so a busy persona's profile
// evolves continuously while an idle one's never gets touched.
//
// Adapted from TencentDB Agent Memory's persona-generator.ts concept
// (incrementally rewrite a persona.md from new "scenes" each time enough
// accumulate) — scoped down: no scene-extraction pipeline or checkpoint
// store, just "existing profile + recent memory facts + today's reflection
// → LLM rewrite", gated by a plain date check instead of a counter file.

import { readVaultFile, writeVaultFile, VaultUnreachable } from "./vault.js";
import { llmGenerateWithMeta } from "./llm.js";
import { listSubjects, recallSubject, type MemoryFact } from "./memory.js";
import { enqueueVaultCommit } from "./commit-queue.js";
import type { Persona } from "./personas.js";

const PROFILE_DIR = "_neuroworks/personas";
const REGEN_MIN_DAYS = 3;
const MAX_FACTS = 15;

function profilePath(personaId: string): string {
  return `${PROFILE_DIR}/${personaId}.md`;
}

function stripFrontmatter(raw: string): string {
  const m = raw.match(/^---\n[\s\S]*?\n---\n?/);
  return m ? raw.slice(m[0].length) : raw;
}

function frontmatterField(raw: string, field: string): string | undefined {
  const m = raw.match(new RegExp(`^${field}:\\s*(.+)$`, "m"));
  return m ? m[1].trim() : undefined;
}

/**
 * Sync, best-effort read used inside personas.ts's personaSystemSuffix (which
 * is itself sync and called on every task). Returns "" when no profile
 * exists yet or the vault is unreachable — a missing profile must never
 * block or alter normal persona behavior.
 */
export function readPersonaProfileSuffix(personaId: string): string {
  try {
    const raw = readVaultFile(profilePath(personaId));
    const body = stripFrontmatter(raw).trim();
    if (!body) return "";
    return `\n\n---\n\n**What you've learned about this organization over time** (auto-updated from memory and daily reflections — use it, don't recite it back):\n\n${body}`;
  } catch {
    return "";
  }
}

function recentMemoryFacts(limit = MAX_FACTS): MemoryFact[] {
  const subjects = listSubjects().slice(0, 10);
  const out: MemoryFact[] = [];
  for (const s of subjects) {
    if (out.length >= limit) break;
    out.push(...recallSubject(s.subject, 3));
  }
  return out.slice(0, limit);
}

function shouldRegenerate(personaId: string): boolean {
  try {
    const raw = readVaultFile(profilePath(personaId));
    const generatedAt = frontmatterField(raw, "generatedAt");
    if (!generatedAt) return true;
    const ageMs = Date.now() - new Date(generatedAt).getTime();
    if (Number.isNaN(ageMs)) return true;
    return ageMs >= REGEN_MIN_DAYS * 24 * 3600_000;
  } catch {
    return true; // no profile yet (or vault unreachable — regeneration will surface the same error and no-op)
  }
}

export async function generatePersonaProfile(persona: Persona, reflectionExcerpt: string): Promise<{ path: string; skipped?: string } | null> {
  if (!shouldRegenerate(persona.id)) return { path: profilePath(persona.id), skipped: `regenerated within the last ${REGEN_MIN_DAYS} days` };

  let existingBody = "";
  try { existingBody = stripFrontmatter(readVaultFile(profilePath(persona.id))).trim(); } catch { /* first generation */ }

  const facts = recentMemoryFacts();
  const factsBlock = facts.map(f => `- (${f.subject}) ${f.fact}`).join("\n") || "_(none recorded)_";

  // Input sections are deliberately NOT "##" markdown headings — a weak
  // model asked to "update" text framed with the same heading style as the
  // requested output tends to just echo the input structure back verbatim
  // (observed live: qwen2.5:3b returned "## Existing profile / ## Recent
  // memory facts / ## Today's reflection" as its entire "answer", with no
  // "## What I've learned" section at all). Reserving "##" exclusively for
  // the one heading we actually want written removes that imitation cue.
  const sys = `You maintain a living profile of how this organization actually works, written for the "${persona.name}" (${persona.role}) AI employee to read before every task. This is NOT a job description — that's already fixed elsewhere. This is what the employee has LEARNED: real preferences, recurring context, patterns in how work gets requested and reviewed here.

You will be given three labeled reference blocks (existing profile, recent memory facts, today's reflection) — read them, do not reprint their labels or contents verbatim.

Update the profile using the new signal. Keep what's still true, revise anything the new signal contradicts, add anything genuinely new — don't restart from scratch each time.

Your ENTIRE response must be plain markdown: a single "## What I've learned" heading followed by 3-8 short bullet points, MAX. Nothing before that heading, nothing after the bullets. No preamble, no sign-off, no restating the job description, no reference-block labels. If there is truly nothing new or changed, respond with exactly "## What I've learned" followed by the existing bullets unchanged (or "_(nothing learned yet)_" under the heading if it was empty).`;

  const prompt = `EXISTING PROFILE (reference only — do not reprint this label):
${existingBody || "(none yet — first generation)"}

RECENT MEMORY FACTS (reference only — do not reprint this label):
${factsBlock}

TODAY'S REFLECTION EXCERPT (reference only — do not reprint this label):
${reflectionExcerpt.slice(0, 2000)}

Now write ONLY the "## What I've learned" section described in your instructions. Nothing else.`;

  let text: string;
  let modelUsed: string | undefined;
  try {
    const meta = await llmGenerateWithMeta(prompt, sys, { profile: "synthesis", complexity: "high" });
    // Defense in depth against the imitation failure mode above: if the
    // response doesn't contain the required heading at all, the model
    // ignored the format — keep the existing profile rather than risk
    // writing a raw prompt echo into what future tasks will read as fact.
    const m = meta.text.match(/##\s*What I've learned[\s\S]*/i);
    text = m ? m[0].trim() : existingBody;
    modelUsed = meta.model;
  } catch (e: any) {
    console.warn(`[persona-profile] LLM call failed for ${persona.id}: ${e?.message ?? e}`);
    return null;
  }
  if (!text) return null;

  const generatedAt = new Date().toISOString();
  const doc = `---
type: persona-profile
personaId: ${persona.id}
personaName: ${persona.name}
generatedAt: ${generatedAt}
factsConsidered: ${facts.length}
${modelUsed ? `model: ${modelUsed}\n` : ""}---

${text}
`;
  try {
    writeVaultFile(profilePath(persona.id), doc);
    void enqueueVaultCommit(`chore(persona-profile): update ${persona.id}`);
  } catch (e: any) {
    if (!(e instanceof VaultUnreachable)) console.warn(`[persona-profile] write failed for ${persona.id}: ${e?.message ?? e}`);
    return null;
  }
  return { path: profilePath(persona.id) };
}

/**
 * Called from reflection.ts's post-reflection hook. `byPersona` is the
 * day's DailyStats.byPersona (persona NAME -> task count) — only personas
 * that actually ran a task get considered, so idle personas never trigger
 * an LLM call. Resolves name -> Persona via personas.ts, dynamic-imported
 * to avoid a load-time circular dependency with personas.ts (which imports
 * readPersonaProfileSuffix from this module for the sync read path).
 */
export async function maybeUpdatePersonaProfiles(byPersona: Record<string, number>, reflectionExcerpt: string): Promise<void> {
  const names = Object.keys(byPersona);
  if (names.length === 0) return;
  try {
    const { loadPersonas } = await import("./personas.js");
    const { personas } = loadPersonas();
    for (const name of names) {
      const persona = personas.find(p => p.name === name);
      if (!persona) continue;
      try {
        const r = await generatePersonaProfile(persona, reflectionExcerpt);
        if (r && !r.skipped) console.log(`[persona-profile] updated ${persona.id} (${r.path})`);
      } catch (e: any) {
        console.warn(`[persona-profile] update failed for ${persona.id}: ${e?.message ?? e}`);
      }
    }
  } catch (e: any) {
    console.warn(`[persona-profile] batch update failed: ${e?.message ?? e}`);
  }
}
