// MiniSearch-backed inverted index over the vault's text files.
//
// searchVault() does a linear walk + readFileSync on every cache-miss query.
// At ~150 files that's fine; at the ~1000+ we now have post bulk-import, the
// walk is noticeable (~200-300ms first time, then a 60s TTL cache). This
// module replaces the walk with a one-time index build + per-query O(log N)
// lookups. The index lives in memory and is invalidated by the existing
// vault watcher signals (no separate watcher — we just expose
// `invalidateIndex` and have vault.ts call it from the same coalesced
// timer that busts the legacy cache).
//
// Persistence: not on disk for now — rebuilds take ~1-2s for 1500 markdown
// files, fine for a cold server boot. A future iteration can serialize
// MiniSearch.toJSON() to .neuroworks/vault-index.json for instant startup.
//
// Falls back to a linear walk if MiniSearch fails to load (defence: an
// extractor crash on one note shouldn't take search down for the rest).

import MiniSearch from "minisearch";
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative, sep, extname, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type IndexedDoc = {
  id: string;          // vault-relative path with forward slashes
  path: string;        // same as id (kept for clarity in result handlers)
  title: string;       // h1 if present, else filename stem
  body: string;        // file contents (text + extracted excerpts already inline)
};

export type IndexSearchHit = {
  path: string;
  line: number;
  preview: string;
  score: number;
};

const HIDDEN_PREFIXES = [".git", ".obsidian", "node_modules"];
const TEXT_EXTS = new Set([".md", ".markdown", ".txt", ".canvas"]);

let index: MiniSearch<IndexedDoc> | null = null;
let buildTimer: NodeJS.Timeout | null = null;
let lastBuiltAt = 0;
let buildPromise: Promise<void> | null = null;
// True while the IIFE inside buildIndex is reading vault files. The watcher
// in vault.ts can fire spurious events during this window (subst-mapped
// drives on Windows + fs.watch is a known-flaky combination); if we let
// those events invalidate mid-build, the build completes but is immediately
// nuked before the first search ever gets to use it. The watcher checks
// this flag via isBuildInProgress() and SKIPS invalidation while true.
//
// We also keep a POST-BUILD GRACE WINDOW (the `buildEndedAt + GRACE_MS`
// envelope) — Windows fs.watch on subst-mapped drives can fire events
// for a few hundred ms AFTER the build's last read, and treating those
// as real external writes loops the index back to null. The grace window
// makes the invalidation deaf to such trailing events. Real external
// edits land outside the window and still invalidate as intended.
let buildInProgress = false;
let buildEndedAt = 0;
const BUILD_POST_GRACE_MS = 1500;
export function isBuildInProgress(): boolean {
  if (buildInProgress) return true;
  return Date.now() - buildEndedAt < BUILD_POST_GRACE_MS;
}

// Shared config — newIndex() AND MiniSearch.loadJSON() must use the SAME
// options or load throws ("incompatible"). Factor it out so they can't drift.
const INDEX_OPTIONS = {
  fields: ["title", "body"],
  storeFields: ["path", "title"],
  searchOptions: {
    // Prefix matching catches "neur" → "neuroworks"; fuzzy 0.2 tolerates
    // one-character typos on words of length ≥5 without exploding the
    // false-positive rate.
    prefix: true,
    fuzzy: 0.2,
    boost: { title: 3 },
    combineWith: "AND" as const,
  },
};

function newIndex(): MiniSearch<IndexedDoc> {
  return new MiniSearch<IndexedDoc>(INDEX_OPTIONS);
}

// Persisted snapshot lives in the state dir (next to executor.json), NOT the
// vault — it's derived data, and on Docker the state dir is its own volume.
// __dirname = server/src/lib → ../../../.neuroworks at the repo/app root.
const __dirname = dirname(fileURLToPath(import.meta.url));
const PERSIST_PATH = resolve(__dirname, "../../../.neuroworks", "vault-index.json");
const PERSIST_VERSION = 1;

// Serialize the live index so a cold boot is instant instead of a 1-2s rebuild.
// Best-effort: a write failure (read-only FS, disk full) must never fail a build.
function persistIndex(idx: MiniSearch<IndexedDoc>, docs: number): void {
  try {
    mkdirSync(dirname(PERSIST_PATH), { recursive: true });
    const payload = JSON.stringify({ v: PERSIST_VERSION, builtAt: Date.now(), docs, index: idx.toJSON() });
    writeFileSync(PERSIST_PATH, payload, "utf8");
  } catch (e: any) {
    console.warn(`[vault-index] persist skipped: ${e?.message ?? e}`);
  }
}

// Load a persisted snapshot into memory for instant cold-start readiness.
// Returns true on success. The caller still kicks a background rebuild to catch
// any edits made while the server was down.
export function loadPersistedIndex(): boolean {
  try {
    if (!existsSync(PERSIST_PATH)) return false;
    const parsed = JSON.parse(readFileSync(PERSIST_PATH, "utf8"));
    if (parsed?.v !== PERSIST_VERSION || !parsed.index) return false;
    index = MiniSearch.loadJS(parsed.index, INDEX_OPTIONS) as MiniSearch<IndexedDoc>;
    lastBuiltAt = Number(parsed.builtAt) || Date.now();
    console.log(`[vault-index] loaded persisted snapshot — ${index.documentCount} docs (will refresh in background)`);
    return true;
  } catch (e: any) {
    console.warn(`[vault-index] persisted snapshot ignored: ${e?.message ?? e}`);
    return false;
  }
}

function* walk(root: string): Generator<string> {
  let entries: any[];
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (HIDDEN_PREFIXES.some(p => e.name.startsWith(p))) continue;
    const full = join(root, e.name);
    if (e.isDirectory()) yield* walk(full);
    else {
      const ext = extname(e.name).toLowerCase();
      if (TEXT_EXTS.has(ext)) yield full;
    }
  }
}

function extractTitle(body: string, fallback: string): string {
  const h1 = body.match(/^#\s+(.+)$/m);
  if (h1) return h1[1].trim().slice(0, 200);
  const fmTitle = body.match(/^title:\s*"?([^"\n]+?)"?\s*$/m);
  if (fmTitle) return fmTitle[1].trim().slice(0, 200);
  return fallback;
}

// Build (or rebuild) the index from scratch. Idempotent — concurrent callers
// share the same in-flight promise so we don't index the vault twice in
// parallel during cold start.
export function buildIndex(vaultRoot: string): Promise<void> {
  if (buildPromise) return buildPromise;
  buildPromise = (async () => {
    // CRITICAL: every code path inside this IIFE must clear buildPromise
    // before returning, OR the guard `if (buildPromise) return buildPromise`
    // at the top would lock out future rebuilds forever. The previous
    // version left buildPromise as a rejected Promise on any unhandled throw
    // (e.g. a transient ENOENT from a watcher race on a deleted file), which
    // looked like "index never settles" externally. Try/finally fixes that.
    buildInProgress = true;
    try {
      if (!existsSync(vaultRoot)) return;
      const next = newIndex();
      let count = 0;
      const t0 = Date.now();
      for (const full of walk(vaultRoot)) {
        try {
          const st = statSync(full);
          if (st.size > 1_000_000) continue;
          const body = readFileSync(full, "utf8");
          const rel = relative(vaultRoot, full).split(sep).join("/");
          const filename = full.split(sep).pop() ?? rel;
          const stem = filename.replace(/\.(md|markdown|txt|canvas)$/i, "");
          next.add({
            id: rel,
            path: rel,
            title: extractTitle(body, stem),
            body,
          });
          count += 1;
        } catch { /* tolerate one bad file */ }
      }
      index = next;
      lastBuiltAt = Date.now();
      const elapsed = Date.now() - t0;
      console.log(`[vault-index] built — ${count} docs in ${elapsed}ms`);
      // Snapshot to disk so the next cold boot is instant (load + background
      // refresh) instead of a full walk. Synchronous + best-effort.
      persistIndex(next, count);
    } catch (e: any) {
      console.warn(`[vault-index] build failed: ${e?.message ?? e}`);
    } finally {
      buildPromise = null;
      buildInProgress = false;
      buildEndedAt = Date.now();
    }
  })();
  // Debug aid for cold-start diagnosis — uncomment to trace the build sequence.
  // console.log(`[vault-index] kicked off build (existing buildPromise was ${buildPromise === null ? "null" : "set"})`);
  return buildPromise;
}

// Coalesced invalidation — vault.ts watcher fires this whenever an
// observed change is detected. We DON'T rebuild immediately; the next
// search() call triggers a lazy rebuild. This keeps a burst of writes
// from triggering N rebuilds in a row.
export function invalidateIndex(): void {
  index = null;
  if (buildTimer) { clearTimeout(buildTimer); buildTimer = null; }
}

// Returns true if the index exists AND is fresher than a configurable
// max-age. Stale indexes still serve queries (caller decides whether to
// rebuild); this is just a probe used by /api/status surfacing.
export function indexStats(): { ready: boolean; docs: number; ageMs: number; built: boolean } {
  return {
    ready: index !== null,
    docs: index ? index.documentCount : 0,
    ageMs: index ? Date.now() - lastBuiltAt : -1,
    built: lastBuiltAt > 0,
  };
}

// Run a search query against the index. Returns null when the index isn't
// available yet — callers should fall back to the linear walk in that case.
//
// We also synthesise a "line + preview" so the result shape matches the
// existing SearchHit so the caller can substitute one for the other without
// touching downstream rendering. Line is approximated by find-first-match
// on the original body (cheap; under 1ms per result for typical previews).
export function searchIndex(query: string, vaultRoot: string, limit = 50): IndexSearchHit[] | null {
  if (!index) return null;
  const q = query.trim();
  if (!q) return [];
  const raw = index.search(q, { combineWith: "AND" }).slice(0, limit);
  const hits: IndexSearchHit[] = [];
  for (const r of raw) {
    try {
      const full = join(vaultRoot, r.path);
      const body = readFileSync(full, "utf8");
      const lines = body.split("\n");
      // Find the first line matching any query term.
      const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
      let line = 1, preview = lines[0] ?? "";
      for (let i = 0; i < lines.length; i++) {
        const lower = lines[i].toLowerCase();
        if (terms.some(t => lower.includes(t))) {
          line = i + 1;
          preview = lines[i];
          break;
        }
      }
      hits.push({
        path: r.path,
        line,
        preview: preview.slice(0, 200),
        score: r.score,
      });
    } catch {
      hits.push({ path: r.path, line: 1, preview: r.title ?? r.path, score: r.score });
    }
  }
  return hits;
}
