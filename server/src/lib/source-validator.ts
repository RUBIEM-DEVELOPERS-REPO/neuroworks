// Source-quality validator for research.deep and friends.
//
// The agent's research path grabs whatever DuckDuckGo/Bing/Firecrawl returns
// and feeds it straight into the synth's evidence catalog. That worked when
// the web behaved, but the harness has caught several failure modes where
// junk evidence drove the answer:
//   - "who is Dario Amodei" → DDG returned a Denmark hotel page; synth
//     refused the well-known entity because evidence "didn't cover it"
//   - "tell me about AIIA" → login page got scored as evidence
//   - "what's new with Mistral" → 404 page extracted to "Page not found"
//     and ranked as a top source
//
// This module sits between the fetcher and the synth. It:
//   1. Rejects pages that ARE the failure shape (auth wall, captcha,
//      cloudflare block, generic error page, paywall preview-only, dead
//      404/410, sub-threshold body length).
//   2. Scores remaining pages by query-term density and presence-in-title.
//   3. In STRICT mode, drops the bottom quartile after scoring so the
//      synth sees only credible evidence.
//
// All gates are conservative enough that a genuinely relevant page on a
// niche topic still passes — we only drop pages that fail OBJECTIVE
// criteria (login form markers, 404 markers, no query terms at all).

import type { FetchedSource, ValidatedSource, SourceVerdict } from "./source-validator-types.js";

// Regex catalog — junk patterns that show up in extracted text/title.
// Each pattern has a `name` so a dropped source can explain WHY it was
// dropped in the audit log. Order matters: most-specific first so the
// reason field is most informative.
const JUNK_PATTERNS: { name: SourceVerdict["reason"]; re: RegExp }[] = [
  // Auth walls — login forms, sign-in pages, "please log in to continue".
  { name: "auth-wall",       re: /\b(?:please (?:log|sign) in|create an account to (?:read|view|continue)|sign in to your account|login required|members?[ -]?only|subscribe to (?:read|continue|unlock))\b/i },
  { name: "auth-wall",       re: /<form[^>]*(?:login|signin|sign-in)/i },
  // CAPTCHA / anti-bot challenges
  { name: "captcha",         re: /\b(?:please (?:verify|complete the) captcha|cloudflare ray id|cloudflare\s+human verification|access denied.*cloudflare|enable cookies and reload|are you a robot|prove you'?re? not a robot|just a moment\.{0,3}|checking your browser before accessing|recaptcha verification)\b/i },
  // Generic error pages
  { name: "error-page",      re: /\b(?:404 (?:not found|page not found)|page not found|410 gone|forbidden access|access denied|service unavailable|internal server error|503 service|server error|something went wrong|oops!? (?:we couldn'?t|the page))\b/i },
  // Paywall stubs that show preview-only with "subscribe to read"
  { name: "paywall-preview", re: /\b(?:subscribe to read the full (?:article|story)|paywall|premium content|continue reading on)\b/i },
  // Cookie / privacy gates that block content
  { name: "cookie-wall",     re: /\baccept (?:all )?cookies (?:to|before) (?:continue|view|read)|we use cookies\.\s+(?:by clicking|accept all|manage settings).*?(?:continue|access|content)/i },
];

// HTTP status codes that imply the fetch returned something but it wasn't
// a real page. 401/403 = auth wall, 404/410 = dead, 5xx = upstream broken.
const BAD_STATUSES = new Set([401, 403, 404, 410, 451, 500, 502, 503, 504]);

// Minimum extracted-text length below which we don't trust the source. A
// 50-char "page not found" stub clears every regex above but should still
// be dropped. 200 is conservative — real article first paragraph alone
// usually exceeds 500 chars.
const MIN_BODY_CHARS = 200;

export type ValidationMode = "off" | "block-junk" | "strict" | "tag-only";

export type ValidationConfig = {
  mode: ValidationMode;
  query: string;
  // Drop bottom-quartile in strict mode? Default true. Off when there
  // are very few sources (≤3) since dropping a quartile would leave
  // nothing.
  dropLowQuartile?: boolean;
  // Soft cap — never drop sources if doing so would leave fewer than
  // this many. Prevents over-aggressive filtering on small SERPs.
  minRetainedSources?: number;
};

export type ValidationResult = {
  kept: ValidatedSource[];
  dropped: ValidatedSource[];
  summary: { total: number; kept: number; dropped: number; reasons: Record<string, number> };
};

// Score a source against the query. Higher = more relevant. Specific
// signals contribute additively:
//   - +5 per query token in title (matched word-bounded; capped at +15)
//   - +3 if every query token appears in body (full coverage bonus)
//   - +1 per 250-char appearance of a query token in body (capped at +10)
//   - -10 if title is empty AND body < 500 chars (low-signal page)
function scoreRelevance(src: FetchedSource, query: string): number {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter(t => t.length >= 3 && !/^(?:the|and|for|with|what|who|how|why|when|where|that|this|are|was|will|can|has|have)$/i.test(t));
  if (tokens.length === 0) return 0;
  const title = (src.title ?? "").toLowerCase();
  const body = (src.text ?? "").toLowerCase();
  let score = 0;
  // Title hits
  let titleHits = 0;
  for (const t of tokens) {
    // Word-bounded match — "AI" inside "rainbow" wouldn't count.
    const re = new RegExp(`\\b${t.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "i");
    if (re.test(title)) titleHits += 1;
  }
  score += Math.min(15, titleHits * 5);
  // Body density: full coverage bonus + per-token frequency
  const bodyHitCounts = tokens.map(t => {
    const matches = body.match(new RegExp(`\\b${t.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "gi"));
    return matches ? matches.length : 0;
  });
  const fullyCovered = bodyHitCounts.every(c => c > 0);
  if (fullyCovered) score += 3;
  const densityScore = bodyHitCounts.reduce((s, c) => s + Math.min(c, 5), 0);
  score += Math.min(10, densityScore);
  // Low-signal penalty
  if (!title && body.length < 500) score -= 10;
  return score;
}

// Detect junk shape. Returns the verdict (ok / drop reason) — does NOT
// consider relevance; relevance is a separate scoring step. This way
// "drop because login wall" is reported separately from "low relevance".
export function checkSourceShape(src: FetchedSource): SourceVerdict {
  if (!src.ok) return { ok: false, reason: "fetch-failed", detail: src.error ?? "fetch returned not-ok" };
  if (typeof src.status === "number" && BAD_STATUSES.has(src.status)) {
    return { ok: false, reason: "bad-status", detail: `HTTP ${src.status}` };
  }
  const body = (src.text ?? "").trim();
  if (body.length < MIN_BODY_CHARS) {
    return { ok: false, reason: "thin-content", detail: `${body.length} chars (min ${MIN_BODY_CHARS})` };
  }
  // Junk markers — check the first 4000 chars; an auth wall above the
  // fold is what we're trying to catch, and scanning the whole body
  // would risk false positives on legitimate articles that quote a
  // login form.
  const head = body.slice(0, 4000);
  for (const j of JUNK_PATTERNS) {
    if (j.re.test(head)) return { ok: false, reason: j.name, detail: `matched: ${j.re.toString().slice(0, 80)}` };
  }
  return { ok: true };
}

// Top-level validator. Returns kept + dropped with reasons, plus a
// summary object that the caller can log / surface in the synth's
// evidence catalog so a thin result is explained rather than silent.
export function validateSources(sources: FetchedSource[], cfg: ValidationConfig): ValidationResult {
  if (cfg.mode === "off") {
    const kept = sources.map(s => ({ ...s, verdict: { ok: true } as SourceVerdict, score: 0 } satisfies ValidatedSource));
    return { kept, dropped: [], summary: { total: sources.length, kept: sources.length, dropped: 0, reasons: {} } };
  }

  const reasons: Record<string, number> = {};
  const scored: ValidatedSource[] = sources.map(s => {
    const verdict = checkSourceShape(s);
    const score = scoreRelevance(s, cfg.query);
    return { ...s, verdict, score };
  });

  let kept: ValidatedSource[] = [];
  let dropped: ValidatedSource[] = [];
  for (const s of scored) {
    if (!s.verdict.ok) {
      const r = s.verdict.reason ?? "unknown";
      reasons[r] = (reasons[r] ?? 0) + 1;
      dropped.push(s);
    } else {
      kept.push(s);
    }
  }

  // STRICT mode: also drop sources where the query has zero presence in
  // body — these are off-topic SERP misses. AND drop bottom quartile
  // when we have enough to spare.
  if (cfg.mode === "strict" && kept.length > 0) {
    const minRetained = cfg.minRetainedSources ?? 2;
    // Zero-relevance filter (no query token appears in body).
    const beforeRelevance = kept.length;
    kept = kept.filter(s => {
      if (s.score > 0) return true;
      // Only drop if doing so leaves at least minRetained.
      return false;
    });
    const droppedRelevance = beforeRelevance - kept.length;
    if (droppedRelevance > 0) {
      reasons["off-topic"] = droppedRelevance;
      // Mark the dropped sources so audit can see why.
      const offTopic = scored.filter(s => s.verdict.ok && s.score === 0);
      offTopic.forEach(s => dropped.push({ ...s, verdict: { ok: false, reason: "off-topic", detail: "no query token appears in body" } }));
    }
    // If we'd be left with fewer than minRetained, restore the top-scoring
    // off-topic sources rather than starving the synth.
    if (kept.length < minRetained) {
      const restoreNeeded = minRetained - kept.length;
      const restorable = dropped
        .filter(s => s.verdict.reason === "off-topic")
        .sort((a, b) => b.score - a.score)
        .slice(0, restoreNeeded);
      for (const r of restorable) {
        kept.push({ ...r, verdict: { ok: true } });
        dropped = dropped.filter(d => d !== r);
        reasons["off-topic"] = Math.max(0, (reasons["off-topic"] ?? 0) - 1);
      }
    }
    // Drop bottom quartile by score when we have enough sources AND the
    // caller didn't opt out. With 4+ sources, drop the lowest 1; with 8+,
    // drop the lowest 2.
    if ((cfg.dropLowQuartile ?? true) && kept.length >= 4) {
      kept.sort((a, b) => b.score - a.score);
      const cutCount = Math.floor(kept.length / 4);
      const finalKept = kept.slice(0, kept.length - cutCount);
      const cut = kept.slice(kept.length - cutCount);
      kept = finalKept;
      cut.forEach(s => {
        dropped.push({ ...s, verdict: { ok: false, reason: "low-quartile", detail: `relevance score ${s.score} fell in bottom quartile` } });
      });
      if (cutCount > 0) reasons["low-quartile"] = cutCount;
    }
  }

  // Tag-only mode: don't actually drop, just annotate (everything already
  // scored). Move all "dropped" back into kept but keep their verdict so
  // the synth can see the warning.
  if (cfg.mode === "tag-only") {
    for (const d of dropped) kept.push(d);
    dropped = [];
  }

  // Sort kept by relevance, highest first, so synth sees the best evidence
  // up front (which matters for synthesis prompts that bias toward early
  // context).
  kept.sort((a, b) => b.score - a.score);

  return {
    kept,
    dropped,
    summary: { total: sources.length, kept: kept.length, dropped: dropped.length, reasons },
  };
}
