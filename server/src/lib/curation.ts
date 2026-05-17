// Curation: the primary clawbot's editor pass over a persona-shifter's output.
//
// Architecture: persona-shifter (worker) does the planning + execution + draft.
// Primary (curator) reviews — does this answer pass quality? Is it free of
// leaked secrets? Is it rooted in the user's actual context (vault notes, real
// URLs, real repos), or is it floating world-knowledge prose?
//
// Only context-rooted, quality, secret-free answers get captured to the vault.
// The vault is the second brain — we only feed it material the primary trusts.

import { findPrimitive } from "./primitives.js";
import { writeVaultFile, VaultSecurityRefusal } from "./vault.js";
import { enqueueVaultCommit } from "./commit-queue.js";

export type CurationVerdict = {
  captured: boolean;
  path?: string;
  reason?: string;
  // Sub-scores so the UI can show why curation passed or failed.
  quality?: { pass: boolean; score?: number; factuality_risk: number; citation_coverage: number; persona_fit: number; issues?: string[] };
  security?: { pass: boolean; findings: { type: string; severity: string; reason: string }[] };
  rooted?: {
    pass: boolean;
    vaultCitations: number;
    webSources: number;
    githubRefs: number;
    reasons: string[];
  };
  // Length of the original peer answer (for audit + UI).
  answerChars?: number;
};

const MIN_ANSWER_CHARS = 200;

// Vault path patterns — when the answer cites a real second-brain note we
// treat it as context-rooted. Matches both [vault:foo/bar.md] and bare
// path-like strings ending in .md inside parens or brackets.
const VAULT_CITE_RE = /\[vault:([^\]]+)\]|\(([\w./-]+\.md)\)|\[\[([^\]]+)\]\]/gi;
const URL_RE = /https?:\/\/[^\s)\]<>"]+/gi;
const GITHUB_REPO_RE = /\b(?:github\.com\/)?([\w-]+\/[\w.-]+)\b/g;
const NUMBERED_CITE_RE = /\[\d+\]/g;

export async function curatePeerOutput(args: {
  task: string;
  answer: string;
  runs?: any[];
  personaId?: string;
  // Pre-computed QA results from the worker peer. When the worker already
  // ran quality.check + security.scan and they cleanly passed, the primary
  // re-running them is duplicate work (5-15s wasted on a confident draft).
  // We trust the worker's results when score >= 0.75 AND security.pass; we
  // ALWAYS re-run if either is borderline so the editor's veto still bites.
  workerQuality?: { pass?: boolean; score?: number; factuality_risk?: number; citation_coverage?: number; persona_fit?: number; issues?: string[] };
  workerSecurity?: { pass?: boolean; findings?: { type: string; severity: string; reason: string }[] };
}): Promise<CurationVerdict> {
  const answer = args.answer.trim();
  if (answer.length < MIN_ANSWER_CHARS) {
    return {
      captured: false,
      reason: `answer too short to curate (${answer.length} < ${MIN_ANSWER_CHARS} chars)`,
      answerChars: answer.length,
    };
  }

  // 1. Quality scoring. Fast path: trust the worker's quality.check when it
  //    cleanly passed (score >= 0.75 AND pass=true). The vault gate still
  //    fires below; we just don't pay a second LLM call to confirm what the
  //    worker already showed. Borderline / failing worker scores always get
  //    a primary re-check so the editor can override.
  const wq = args.workerQuality;
  const workerCleanQuality = wq && wq.pass === true && typeof wq.score === "number" && wq.score >= 0.75;
  const qualityTool = findPrimitive("quality.check");
  let quality: CurationVerdict["quality"];
  if (workerCleanQuality) {
    quality = {
      pass: true,
      score: wq!.score,
      factuality_risk: Number(wq!.factuality_risk ?? 0),
      citation_coverage: Number(wq!.citation_coverage ?? 1),
      persona_fit: Number(wq!.persona_fit ?? 1),
      issues: Array.isArray(wq!.issues) ? wq!.issues : [],
    };
  } else if (qualityTool) {
    try {
      const sources = collectSourcesText(args.runs ?? []);
      const q = await qualityTool.handler({ task: args.task, answer, sources });
      quality = {
        pass: q.pass === true,
        score: q.score,
        factuality_risk: Number(q.factuality_risk ?? 1),
        citation_coverage: Number(q.citation_coverage ?? 0),
        persona_fit: Number(q.persona_fit ?? 0),
        issues: Array.isArray(q.issues) ? q.issues : [],
      };
    } catch (e: any) {
      quality = { pass: false, factuality_risk: 1, citation_coverage: 0, persona_fit: 0, issues: [`scorer error: ${String(e?.message ?? e)}`] };
    }
  }

  // 2. Security scan. Same fast-path logic: when the worker scanned and
  //    found nothing high-severity, we accept the result. Worker-side scan
  //    is regex-only (cheap) so the savings are smaller than quality, but
  //    every redundancy removed is a few ms back.
  const ws = args.workerSecurity;
  const workerCleanSecurity = ws && ws.pass === true && !(ws.findings ?? []).some(f => f.severity === "high");
  const securityTool = findPrimitive("security.scan");
  let security: CurationVerdict["security"];
  if (workerCleanSecurity) {
    security = { pass: true, findings: Array.isArray(ws!.findings) ? ws!.findings : [] };
  } else if (securityTool) {
    try {
      const s = await securityTool.handler({ content: answer, kind: "note" });
      security = { pass: s.pass === true, findings: Array.isArray(s.findings) ? s.findings : [] };
    } catch (e: any) {
      security = { pass: false, findings: [{ type: "scanner-error", severity: "low", reason: String(e?.message ?? e) }] };
    }
  }

  // 3. Context-rooting check — the answer must reference real artifacts
  //    (vault notes, URLs, GitHub repos, or numbered citations to evidence the
  //    peer pulled). World-knowledge prose with no anchors gets refused even
  //    if it scored well, because there's no way to verify it later.
  const rooted = checkContextRooting(answer, args.runs ?? []);

  const verdict: CurationVerdict = {
    captured: false,
    answerChars: answer.length,
    quality,
    security,
    rooted,
  };

  if (security && !security.pass) {
    return { ...verdict, reason: `security: ${security.findings.filter(f => f.severity === "high").map(f => f.type).join(", ") || "high-severity finding"}` };
  }
  if (quality && !quality.pass) {
    return { ...verdict, reason: `quality below threshold (factuality_risk=${quality.factuality_risk.toFixed(2)}, citation_coverage=${quality.citation_coverage.toFixed(2)}, persona_fit=${quality.persona_fit.toFixed(2)})` };
  }
  if (!rooted.pass) {
    return { ...verdict, reason: `not context-rooted — ${rooted.reasons.join("; ")}` };
  }

  // 4. All gates passed — capture a distilled note to 0-Inbox/. We use
  //    0-Inbox (the fleeting/raw layer of the vault) intentionally: even
  //    curated agent output is a draft. The user promotes mature material to
  //    2-Permanent themselves.
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  const slug = slugifyForFilename(args.task);
  const path = `0-Inbox/${stamp}-curated-${slug}.md`;
  const today = new Date().toISOString().slice(0, 10);
  const personaTag = args.personaId ? `\npersona: ${args.personaId}` : "";
  const sourcesBlock = renderSourcesBlock(args.runs ?? []);

  const md = `---
title: "Curated: ${args.task.replace(/"/g, "'").slice(0, 120)}"
created: ${today}
source: clawbot-curation
tags: [curated, agent-output]${personaTag}
quality_score: ${quality?.score ?? "n/a"}
factuality_risk: ${quality?.factuality_risk?.toFixed(2) ?? "n/a"}
citation_coverage: ${quality?.citation_coverage?.toFixed(2) ?? "n/a"}
---

# ${args.task}

${answer}

${sourcesBlock}

---

*Curated by the primary clawbot from a persona-shifter peer's output. Quality score ${quality?.score ?? "n/a"}, ${rooted.vaultCitations} vault refs, ${rooted.webSources} web sources, ${rooted.githubRefs} GitHub refs.*
`;

  try {
    writeVaultFile(path, md);
    // Enqueue a vault commit so the curated note actually lands in git. Until
    // now curation wrote to disk only — the journal's eventual commit picked
    // it up incidentally, but on a clean shutdown the file could stay
    // uncommitted indefinitely.
    void enqueueVaultCommit(`neuroworks: curate — ${slug}`);
    return { ...verdict, captured: true, path };
  } catch (e: any) {
    if (e instanceof VaultSecurityRefusal) {
      return { ...verdict, reason: `vault refused write — ${e.findings.map(f => f.type).join(", ")}`, captured: false };
    }
    return { ...verdict, reason: `vault write failed: ${String(e?.message ?? e)}`, captured: false };
  }
}

function checkContextRooting(answer: string, runs: any[]): NonNullable<CurationVerdict["rooted"]> {
  const reasons: string[] = [];
  const vaultMatches = [...answer.matchAll(VAULT_CITE_RE)].map(m => m[1] ?? m[2] ?? m[3]).filter(Boolean);
  const urls = [...answer.matchAll(URL_RE)].map(m => m[0]);
  const githubRefs = [...answer.matchAll(GITHUB_REPO_RE)].map(m => m[1]).filter(s => s && s.includes("/") && !s.includes(".md"));
  const numberedCites = [...answer.matchAll(NUMBERED_CITE_RE)];

  // Cross-check numbered citations against runs — a [3] is only "rooted" if
  // run #3 actually ran and produced real evidence (vault.search results, a
  // web.fetch, a github.* call). Fake numbered citations by themselves don't
  // count — we've seen the model hallucinate "[1]" with nothing behind it.
  const evidenceRuns = runs.filter(r => r && r.ok && hasEvidenceShape(r));
  const numberedRooted = numberedCites.length > 0 && evidenceRuns.length > 0
    ? Math.min(numberedCites.length, evidenceRuns.length)
    : 0;

  const vaultCitations = vaultMatches.length;
  const webSources = urls.length;
  const githubCount = githubRefs.length;

  // Rooted when ANY of: vault citation, web URL with http(s), GitHub repo ref,
  // or backed numbered citation. The bar is intentionally low — we just want
  // ONE concrete anchor so the answer isn't pure world-knowledge prose. The
  // quality scorer above already enforces stricter citation-coverage.
  const total = vaultCitations + webSources + githubCount + numberedRooted;
  if (total === 0) reasons.push("no vault, web, or GitHub references found");
  if (vaultCitations === 0 && evidenceRuns.some(r => r.step?.tool === "vault.search")) {
    reasons.push("vault was searched but no [vault:…] citations in answer");
  }

  return {
    pass: total > 0,
    vaultCitations,
    webSources,
    githubRefs: githubCount,
    reasons,
  };
}

function hasEvidenceShape(run: any): boolean {
  const tool = run.step?.tool ?? "";
  return ["vault.search", "vault.read", "web.fetch", "web.scrape", "web.search", "github.read_repo", "github.get_file", "research.deep"].includes(tool);
}

function collectSourcesText(runs: any[]): string {
  const bits: string[] = [];
  for (const r of runs) {
    if (!r?.ok) continue;
    const tool = r.step?.tool ?? "";
    if (tool === "vault.search" && Array.isArray(r.result?.matches)) {
      for (const m of r.result.matches.slice(0, 5)) bits.push(`[vault:${m.path}]`);
    }
    if (tool === "web.fetch" || tool === "web.scrape") {
      const url = r.step?.args?.url;
      if (url) bits.push(`[url:${url}]`);
    }
    if (tool === "research.deep" && Array.isArray(r.result?.webSources)) {
      for (const w of r.result.webSources.slice(0, 5)) if (w.url) bits.push(`[url:${w.url}]`);
    }
  }
  return bits.join(", ").slice(0, 2000);
}

function renderSourcesBlock(runs: any[]): string {
  const sources = collectSourcesText(runs);
  if (!sources) return "";
  return `## Sources\n${sources.split(", ").map(s => `- ${s}`).join("\n")}\n`;
}

function slugifyForFilename(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "task";
}
