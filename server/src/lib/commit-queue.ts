// Serialised, debounced commit queue for vault writes.
//
// The vault is a git repo shared by many writers — agent journal entries,
// curation captures, research.deep notes, session snapshots, the user's own
// Obsidian edits. Without coordination, each writer calls commitAndPush
// independently → 10 jobs finishing back-to-back produces 10 commits and 10
// pushes, and two `git add .` calls racing can corrupt the index.
//
// The queue:
//   • Coalesces enqueue() calls inside DEBOUNCE_MS into a single commit. The
//     final commit message is the most recent enqueue's message.
//   • Serialises actual git operations so only one commitAndPush is in flight
//     at a time.
//   • Returns a promise per caller that resolves with the same result as
//     commitAndPush, so callers can still surface "committed: false / pushed:
//     false" if they care.
//   • Survives a failed commit — the next enqueue retries cleanly.
//
// Set NEUROWORKS_COMMIT_DEBOUNCE_MS to tune debounce. 0 = commit immediately
// (effectively pre-queue behaviour). Default: 4000ms — long enough to absorb
// a wave of sub-agent writes, short enough that the user doesn't wait for
// their note to appear in the vault.

import { commitAndPush, vaultAheadBy } from "./vault.js";

const DEBOUNCE_MS = Number(process.env.NEUROWORKS_COMMIT_DEBOUNCE_MS ?? "4000");

type Pending = {
  message: string;
  resolvers: ((value: CommitResult) => void)[];
};

type CommitResult = {
  committed: boolean;
  pushed?: boolean;
  error?: string;
  // Coalesced count — how many enqueue() calls landed in this commit.
  coalesced: number;
};

let pending: Pending | null = null;
let inFlight: Promise<CommitResult> | null = null;
let timer: NodeJS.Timeout | null = null;

let lastCommit: { at: number; message: string; ok: boolean; pushed: boolean; error?: string } | null = null;
let totalCommits = 0;
let coalescedSavings = 0;  // every "extra" enqueue beyond the first per batch.

// Schedule a commit. Multiple calls inside the debounce window batch into a
// single commit; the returned promise resolves when that batch lands.
export function enqueueVaultCommit(message: string): Promise<CommitResult> {
  return new Promise<CommitResult>((resolve) => {
    if (!pending) pending = { message, resolvers: [resolve] };
    else {
      pending.message = message;            // most recent message wins
      pending.resolvers.push(resolve);      // but every caller still gets resolved
      coalescedSavings++;
    }
    if (DEBOUNCE_MS === 0) {
      void flushNow();
      return;
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { void flushNow(); }, DEBOUNCE_MS);
  });
}

// Force the queue to flush right now — used on server shutdown so we don't
// lose pending writes, and by routes that want a synchronous "save now".
export async function flushVaultCommits(): Promise<CommitResult | null> {
  if (timer) { clearTimeout(timer); timer = null; }
  return flushNow();
}

async function flushNow(): Promise<CommitResult | null> {
  if (inFlight) {
    // Another flush is already running — wait for it, then check if we have
    // more pending work (it may have been queued after that flush started).
    await inFlight;
    if (!pending) return null;
    return flushNow();
  }
  const batch = pending;
  pending = null;
  if (timer) { clearTimeout(timer); timer = null; }
  if (!batch) return null;

  const exec = (async (): Promise<CommitResult> => {
    try {
      const r = await commitAndPush(batch.message);
      const result: CommitResult = {
        committed: r.committed === true,
        pushed: r.pushed === true,
        error: r.error,
        coalesced: batch.resolvers.length,
      };
      if (result.committed) totalCommits++;
      lastCommit = {
        at: Date.now(),
        message: batch.message,
        ok: result.committed,
        pushed: result.pushed === true,
        error: result.error,
      };
      return result;
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      lastCommit = { at: Date.now(), message: batch.message, ok: false, pushed: false, error: msg };
      return { committed: false, error: msg, coalesced: batch.resolvers.length };
    }
  })();

  inFlight = exec;
  const result = await exec;
  inFlight = null;
  for (const r of batch.resolvers) r(result);
  return result;
}

// Observability — surfaced by /api/status so the Admin page can show
// "last commit 12s ago · 14 coalesced writes saved". The aheadBy field
// (when present) tells the user how many local commits have NOT reached
// origin — important when commitAndPush silently timed out and the
// commit is durable-locally but invisible to anyone else syncing the
// vault repo.
//
// Cached at ~5s freshness so consumers polling /api/status don't
// trigger a git status call on every refresh.
let aheadByCache: { at: number; value: number | null } | null = null;
const AHEAD_BY_TTL_MS = 5_000;

export async function refreshAheadBy(): Promise<number | null> {
  const v = await vaultAheadBy();
  aheadByCache = { at: Date.now(), value: v };
  return v;
}

export function vaultCommitStats() {
  // Refresh aheadBy in the background if stale — first call returns
  // null/undefined; subsequent calls within 5s see the fresh value.
  // This avoids making the stats endpoint async (and rippling out to
  // every other caller).
  if (!aheadByCache || Date.now() - aheadByCache.at > AHEAD_BY_TTL_MS) {
    void refreshAheadBy().catch(() => { /* tolerate */ });
  }
  return {
    lastCommit,
    totalCommits,
    coalescedSavings,
    pendingWrites: pending?.resolvers.length ?? 0,
    inFlight: inFlight !== null,
    debounceMs: DEBOUNCE_MS,
    aheadBy: aheadByCache?.value ?? null,
    aheadByAt: aheadByCache?.at ?? null,
  };
}

// On SIGTERM/SIGINT we flush so a graceful shutdown doesn't strand pending
// writes. Wired up in index.ts when the server starts.
export async function shutdownCommitQueue(): Promise<void> {
  await flushVaultCommits();
  // Wait for any in-flight commit to settle.
  if (inFlight) await inFlight;
}
