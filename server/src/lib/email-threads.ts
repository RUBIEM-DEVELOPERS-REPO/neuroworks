// Email conversation memory. An inbound email used to start a brand-new chat
// session every time, so a back-and-forth over email lost all context between
// messages. This store keys turns by mail thread (derived from the RFC822
// References / In-Reply-To headers) so a reply continues the same conversation
// — the inbound handler replays prior turns into /api/chat, exactly like the
// web chat preserves its message list.
//
// Scope: small, bounded, JSON-backed under .neuroworks. Capped per thread and
// in total so a long-running mailbox can't grow it without limit. This is
// conversational context, not an audit log (jobs + the vault already hold the
// durable record).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = resolve(__dirname, "../../../.neuroworks");
const FILE = join(STATE_DIR, "email-threads.json");

const MAX_TURNS_PER_THREAD = 12;  // keep the last N turns (6 exchanges)
const MAX_THREADS = 200;          // evict oldest threads beyond this
const MAX_CONTENT_CHARS = 4000;   // clamp any single turn

export type ThreadTurn = { role: "user" | "assistant"; content: string; at: string };
type Thread = { key: string; messages: ThreadTurn[]; updatedAt: string };
type Store = { threads: Record<string, Thread> };

let cache: Store | null = null;

function load(): Store {
  if (cache) return cache;
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
  if (!existsSync(FILE)) { cache = { threads: {} }; return cache; }
  try {
    const parsed = JSON.parse(readFileSync(FILE, "utf8"));
    cache = { threads: parsed?.threads && typeof parsed.threads === "object" ? parsed.threads : {} };
  } catch {
    cache = { threads: {} };
  }
  return cache;
}

function persist() {
  if (!cache) return;
  try { writeFileSync(FILE, JSON.stringify(cache, null, 2)); }
  catch (e) { console.warn(`[email-threads] persist failed: ${(e as Error).message}`); }
}

// Derive a stable thread key from an inbound message. The thread root is the
// first References id (the message that started the thread); fall back to
// In-Reply-To, then the message's own id, then a sender+subject digest so even
// a header-poor client groups follow-ups under the same subject.
export function threadKeyFor(opts: { references?: string[]; inReplyTo?: string; messageId?: string; sender: string; subject: string }): string {
  const fromRefs = opts.references?.find(Boolean);
  if (fromRefs) return fromRefs.trim();
  if (opts.inReplyTo?.trim()) return opts.inReplyTo.trim();
  if (opts.messageId?.trim()) return opts.messageId.trim();
  const subj = (opts.subject ?? "").toLowerCase().replace(/^\s*(re|fwd?|aw|wg)\s*:\s*/gi, "").trim();
  return `${opts.sender.toLowerCase()}::${subj}`.slice(0, 200);
}

// The prior turns for a thread, oldest-first, ready to prepend to a new chat.
export function getThreadHistory(key: string): ThreadTurn[] {
  const t = load().threads[key];
  return t ? t.messages.slice() : [];
}

// Append a turn and persist. Trims the thread to the last N turns and evicts
// the oldest threads when over the global cap.
export function appendThreadTurn(key: string, role: ThreadTurn["role"], content: string): void {
  const store = load();
  const now = new Date().toISOString();
  const turn: ThreadTurn = { role, content: (content ?? "").slice(0, MAX_CONTENT_CHARS), at: now };
  const existing = store.threads[key];
  if (existing) {
    existing.messages.push(turn);
    if (existing.messages.length > MAX_TURNS_PER_THREAD) existing.messages = existing.messages.slice(-MAX_TURNS_PER_THREAD);
    existing.updatedAt = now;
  } else {
    store.threads[key] = { key, messages: [turn], updatedAt: now };
  }
  // Evict oldest threads beyond the cap.
  const keys = Object.keys(store.threads);
  if (keys.length > MAX_THREADS) {
    const sorted = keys
      .map(k => ({ k, at: store.threads[k].updatedAt }))
      .sort((a, b) => a.at.localeCompare(b.at));
    for (const { k } of sorted.slice(0, keys.length - MAX_THREADS)) delete store.threads[k];
  }
  persist();
}
