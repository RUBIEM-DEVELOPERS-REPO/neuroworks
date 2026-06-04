// Persistent agent memory — the single biggest gap between "stateless tool
// runner" and "the same coworker who talked to you yesterday."
//
// File layout: `_neuroworks/memory/<subject-slug>.jsonl`. Each line is a
// fact: { subject, fact, source?, ts }. Subject = anything the agent wants
// to remember about — a person ("priya"), a project ("rag-pipeline-2026"),
// or a topic ("vault-cache-bug"). Recall is a linear scan; the files stay
// tiny in practice (a few KB each) so a real index is premature.
//
// Honcho / Mem0 / Letta integration is documented (env stubs only) so this
// module can be swapped for a remote provider without changing primitive
// signatures. Local first; remote later.

import { existsSync, mkdirSync, readFileSync, readdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";

const MEMORY_DIR_REL = "_neuroworks/memory";

export type MemoryFact = {
  subject: string;
  fact: string;
  source?: string;
  ts: string;
};

function root(): string { return join(config.vaultPath, MEMORY_DIR_REL); }

function slugify(subject: string): string {
  return subject.toLowerCase().trim()
    .replace(/[^a-z0-9 \-_.]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 80) || "general";
}

export function noteFact(args: { subject: string; fact: string; source?: string }): MemoryFact {
  const dir = root();
  try { mkdirSync(dir, { recursive: true }); } catch { /* tolerate */ }
  const rec: MemoryFact = {
    subject: args.subject.trim(),
    fact: args.fact.trim().slice(0, 2000),
    source: args.source ? args.source.slice(0, 200) : undefined,
    ts: new Date().toISOString(),
  };
  const file = join(dir, slugify(args.subject) + ".jsonl");
  appendFileSync(file, JSON.stringify(rec) + "\n", "utf8");
  return rec;
}

export function recallSubject(subject: string, limit = 20): MemoryFact[] {
  const file = join(root(), slugify(subject) + ".jsonl");
  if (!existsSync(file)) return [];
  try {
    const lines = readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
    const out: MemoryFact[] = [];
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      try { out.push(JSON.parse(lines[i])); } catch { /* tolerate */ }
    }
    return out;
  } catch { return []; }
}

// Free-text search across all memory files. Used when the agent isn't sure
// which subject a memory was filed under (e.g. a topic name).
export function searchMemory(query: string, limit = 20): MemoryFact[] {
  const dir = root();
  if (!existsSync(dir)) return [];
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const hits: MemoryFact[] = [];
  let files: string[] = [];
  try { files = readdirSync(dir).filter(f => f.endsWith(".jsonl")); } catch { return []; }
  for (const f of files) {
    if (hits.length >= limit) break;
    try {
      const lines = readFileSync(join(dir, f), "utf8").split(/\r?\n/).filter(Boolean);
      for (let i = lines.length - 1; i >= 0 && hits.length < limit; i--) {
        try {
          const rec = JSON.parse(lines[i]) as MemoryFact;
          const blob = (rec.subject + " " + rec.fact + " " + (rec.source ?? "")).toLowerCase();
          if (blob.includes(q)) hits.push(rec);
        } catch { /* tolerate */ }
      }
    } catch { /* tolerate */ }
  }
  return hits;
}

export function listSubjects(): { subject: string; count: number; lastTs?: string }[] {
  const dir = root();
  if (!existsSync(dir)) return [];
  const out: { subject: string; count: number; lastTs?: string }[] = [];
  let files: string[] = [];
  try { files = readdirSync(dir).filter(f => f.endsWith(".jsonl")); } catch { return []; }
  for (const f of files) {
    try {
      const lines = readFileSync(join(dir, f), "utf8").split(/\r?\n/).filter(Boolean);
      if (!lines.length) continue;
      let subject = f.replace(/\.jsonl$/, "");
      let lastTs: string | undefined;
      try {
        const last = JSON.parse(lines[lines.length - 1]) as MemoryFact;
        subject = last.subject || subject;
        lastTs = last.ts;
      } catch { /* tolerate */ }
      out.push({ subject, count: lines.length, lastTs });
    } catch { /* tolerate */ }
  }
  return out.sort((a, b) => (b.lastTs ?? "").localeCompare(a.lastTs ?? ""));
}
