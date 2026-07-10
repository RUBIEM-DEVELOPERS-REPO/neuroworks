// Reflection → lessons loop.
//
// Daily reflections call writeLessonsFromReflection() with the synthesised
// reflection text. We pull the "What went wrong" + "What to try next"
// sections out, dedupe against the existing lessons file, and write the
// merged file to _governance/learned-from-reflections.md. The governance
// loader prepends every file in _governance/ to the agent's system prompt,
// so the lessons become hard rules for the next-day fleet — that's the
// actual mechanism that makes reflections improve the system instead of
// just sitting in the journal.
//
// Cap kept at the last 30 days of lessons so the prefix doesn't grow
// unbounded; older entries fall off the bottom on each rotation.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";
import { enqueueVaultCommit } from "./commit-queue.js";

const LESSONS_REL = "_governance/learned-from-reflections.md";
const KEEP_DAYS = 30;

type Lesson = { date: string; section: "wrong" | "next"; bullet: string };

function lessonsPath(): string {
  return join(config.vaultPath, LESSONS_REL);
}

// Parse the lessons file back into structured entries so we can dedupe
// and rotate. The file shape is a fenced section per day with frontmatter
// markers we control, so the parse is deterministic.
function readExisting(): Lesson[] {
  if (!existsSync(lessonsPath())) return [];
  try {
    const raw = readFileSync(lessonsPath(), "utf8");
    const lessons: Lesson[] = [];
    const dateBlocks = raw.split(/^## /m).slice(1);
    for (const block of dateBlocks) {
      const dateMatch = block.match(/^(\d{4}-\d{2}-\d{2})/);
      if (!dateMatch) continue;
      const date = dateMatch[1];
      const wrongSec = block.match(/### Went wrong\n([\s\S]*?)(?=\n### |\n## |\n*$)/);
      const nextSec  = block.match(/### Try next\n([\s\S]*?)(?=\n### |\n## |\n*$)/);
      for (const line of (wrongSec?.[1] ?? "").split("\n")) {
        const b = line.replace(/^\s*[-*]\s*/, "").trim();
        if (b) lessons.push({ date, section: "wrong", bullet: b });
      }
      for (const line of (nextSec?.[1] ?? "").split("\n")) {
        const b = line.replace(/^\s*[-*]\s*/, "").trim();
        if (b) lessons.push({ date, section: "next", bullet: b });
      }
    }
    return lessons;
  } catch { return []; }
}

// Extract the "What went wrong" + "What to try next" bullets from a
// reflection's markdown body. The reflection template uses both heading
// variants ("What went wrong" / "What to try next") consistently — we
// match the heading then collect bullets until the next heading or EOF.
function extractSections(text: string): { wrong: string[]; next: string[] } {
  function bulletsAfter(headingRe: RegExp): string[] {
    const m = text.match(headingRe);
    if (!m || m.index === undefined) return [];
    const after = text.slice(m.index + m[0].length);
    const stop = after.search(/\n##\s|\n\n##\s/);
    const section = stop === -1 ? after : after.slice(0, stop);
    const out: string[] = [];
    for (const line of section.split("\n")) {
      const b = line.replace(/^\s*[-*]\s*/, "").trim();
      if (b && (line.trimStart().startsWith("-") || line.trimStart().startsWith("*") || /^\d+\.\s/.test(line.trim()))) {
        out.push(b);
      }
    }
    return out;
  }
  return {
    wrong: bulletsAfter(/##\s+What\s+went\s+wrong[^\n]*\n/i),
    next:  bulletsAfter(/##\s+What\s+to\s+try\s+next[^\n]*\n/i),
  };
}

// Dedupe — same bullet (case-insensitive, whitespace-normalised) from a
// prior day is dropped so the file doesn't bloat with the same recurring
// finding. The DATE of the first occurrence is kept.
function dedupe(lessons: Lesson[]): Lesson[] {
  const seen = new Set<string>();
  const out: Lesson[] = [];
  // Sort newest-first so the surviving copy is the most recent date.
  const sorted = [...lessons].sort((a, b) => (a.date < b.date ? 1 : -1));
  for (const l of sorted) {
    const key = `${l.section}::${l.bullet.toLowerCase().replace(/\s+/g, " ")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l);
  }
  return out;
}

// Drop anything older than KEEP_DAYS to bound the prefix size.
function recentOnly(lessons: Lesson[]): Lesson[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - KEEP_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return lessons.filter(l => l.date >= cutoffStr);
}

function render(lessons: Lesson[]): string {
  const byDate = new Map<string, { wrong: string[]; next: string[] }>();
  for (const l of lessons) {
    if (!byDate.has(l.date)) byDate.set(l.date, { wrong: [], next: [] });
    byDate.get(l.date)![l.section].push(l.bullet);
  }
  const dates = [...byDate.keys()].sort().reverse(); // newest first
  const out: string[] = [
    "# Lessons learned from daily reflections",
    "",
    "Auto-generated from `_neuroworks/reflections/*.md`. Each daily reflection's *What went wrong* and *What to try next* bullets land here. The governance loader prepends this file to every agent system prompt, so yesterday's findings become today's hard rules.",
    "",
    "**Rule for the agent reading this:** treat every bullet under *Went wrong* as a known failure mode to avoid this turn. Treat every bullet under *Try next* as a preferred next-step pattern for similar tasks.",
    "",
    "---",
    "",
  ];
  for (const date of dates) {
    const day = byDate.get(date)!;
    out.push(`## ${date}`);
    out.push("");
    if (day.wrong.length > 0) {
      out.push("### Went wrong");
      for (const b of day.wrong) out.push(`- ${b}`);
      out.push("");
    }
    if (day.next.length > 0) {
      out.push("### Try next");
      for (const b of day.next) out.push(`- ${b}`);
      out.push("");
    }
  }
  return out.join("\n");
}

export function writeLessonsFromReflection(date: string, reflectionText: string): void {
  const sections = extractSections(reflectionText);
  if (sections.wrong.length === 0 && sections.next.length === 0) {
    return; // nothing to add — skip the write
  }
  const newLessons: Lesson[] = [
    ...sections.wrong.map(b => ({ date, section: "wrong" as const, bullet: b })),
    ...sections.next.map(b  => ({ date, section: "next"  as const, bullet: b })),
  ];
  const merged = recentOnly(dedupe([...readExisting(), ...newLessons]));
  try {
    const dir = join(config.vaultPath, "_governance");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(lessonsPath(), render(merged), "utf8");
    void enqueueVaultCommit(`chore(governance): refresh learned-from-reflections (${date})`);
  } catch (e: any) {
    console.warn(`[reflection-lessons] write failed: ${e?.message ?? e}`);
  }
}
