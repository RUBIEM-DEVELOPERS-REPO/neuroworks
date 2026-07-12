// Symbolic tool-output offload — when a step's result carries a large string
// field (a scraped page body, extracted doc text, a long file read, a long
// ollama.generate draft), archive the FULL text to disk once and replace the
// field with a short preview + a pointer. Every existing consumer downstream
// (buildEvidenceCatalog, synth's evidence builder, compactStepSummary) already
// truncates independently at its own cutoff — so today the full text is
// silently discarded, over and over, at N different points, unrecoverable
// once gone. This collapses that to ONE archival point with a full copy kept
// on disk, and shrinks what rides through every subsequent LLM call in the
// same plan — a 5-step research plan today carries every prior step's raw
// scrape through steps 2..5's prompts even though only the final synth needs
// the full text.
//
// Correctness: a later step's args can reference an earlier step's field
// VERBATIM (`vault.write content: "$step_2.text"`) — if that field had been
// silently truncated, the write would land corrupted with no error anywhere.
// recoverFullText() is the fix: resolveValue() in agent.ts runs every
// resolved string through it, so an explicit reference always gets the real
// bytes back off disk, while everything else (evidence catalogs, synth,
// rescue summaries) keeps seeing the short preview it already expected.
//
// Adapted from TencentDB Agent Memory's "symbolic short-term memory" concept
// (offload full logs to refs/*.md, keep a compact pointer in context) —
// scoped down to fit here: no Mermaid graph, no node_id backend pipeline,
// just a preview-string-with-pointer swap that's a drop-in replacement for
// the field's old string value.

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";

const STATE_ROOT = resolve(process.cwd(), ".neuroworks");
const OFFLOAD_ROOT = join(STATE_ROOT, "offload");

// Offloading right at synth's own existing evidence-body cap (4000 chars)
// means nothing that already worked loses information it was going to see —
// it just stops paying to carry a copy of it through every intermediate step.
const OFFLOAD_THRESHOLD = 4000;
const PREVIEW_CHARS = 4000;

function safeSegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "x";
}

/** One archive directory per executePlan() run. Not tied to the job id — agent.ts's
 * executePlan doesn't currently know its own job id (threading it through would touch
 * every route that calls planAndExecute); a self-contained run id is enough for
 * archival + intra-plan context shrinkage, the two things this exists for. */
export function newOffloadRun(): string {
  return `${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
}

const OFFLOAD_MARKER_RE = /\[…\d+ more characters archived — full text at (offload\/[^\]]+)\]$/;

/**
 * Walk a tool result's top-level string fields; any longer than the
 * threshold gets archived to disk and replaced in-place with a preview +
 * pointer suffix. Returns a shallow clone — never mutates the input, since
 * other in-flight closures hold references to the StepRun history.
 */
export function offloadLargeFields(runId: string, stepIndex: number, tool: string, result: unknown): unknown {
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  const clone: Record<string, unknown> = { ...(result as Record<string, unknown>) };
  let touched = false;
  for (const [key, value] of Object.entries(clone)) {
    if (typeof value !== "string" || value.length <= OFFLOAD_THRESHOLD) continue;
    try {
      const dir = join(OFFLOAD_ROOT, runId);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const fileName = `step${stepIndex}-${safeSegment(tool)}-${safeSegment(key)}.txt`;
      writeFileSync(join(dir, fileName), value, "utf8");
      const refPath = `offload/${runId}/${fileName}`;
      clone[key] = `${value.slice(0, PREVIEW_CHARS)}\n\n[…${value.length - PREVIEW_CHARS} more characters archived — full text at ${refPath}]`;
      touched = true;
    } catch { /* best-effort — leave the field as-is on any disk error */ }
  }
  return touched ? clone : result;
}

/** Path is constrained to OFFLOAD_ROOT so a malformed/tampered refPath can't escape it. */
export function readOffloadedField(refPath: string): string | null {
  const full = resolve(STATE_ROOT, refPath);
  if (!full.startsWith(OFFLOAD_ROOT + sep)) return null;
  try { return readFileSync(full, "utf8"); } catch { return null; }
}

/** If `value` is an offload preview (ends with the archive-pointer marker), transparently
 * swap in the full original text; otherwise return it unchanged. Falls back to the preview
 * on any read failure — never throws, never returns something worse than what came in. */
export function recoverFullText(value: string): string {
  const m = value.match(OFFLOAD_MARKER_RE);
  if (!m) return value;
  const full = readOffloadedField(m[1]);
  return full ?? value;
}
