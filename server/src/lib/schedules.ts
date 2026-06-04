import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = resolve(__dirname, "../../../.neuroworks");
const FILE = join(STATE_DIR, "schedules.json");

// Cadence shape. Friendly time picker compiles to this; cron is computed
// at fire-evaluation time. Day-of-week is 0-6 (Sun=0), matching Date.getDay().
export type Cadence = {
  daysOfWeek: number[];   // 0..6 (Sun..Sat). Empty array means every day.
  hour: number;           // 0..23 in local time
  minute: number;         // 0..59 in local time
};

export type Schedule = {
  id: string;
  name: string;            // user-facing label, e.g. "Weekly digest"
  templateId: string;      // template to run
  inputs: Record<string, unknown>;
  cadence: Cadence;
  enabled: boolean;
  createdAt: string;
  lastFiredAt?: string;    // ISO, set after a successful fire
  lastJobId?: string;      // last job id triggered
  lastError?: string;      // most recent fire error (cleared on success)
  fireCount: number;
};

type Store = { schedules: Schedule[] };
let cache: Store | null = null;

function load(): Store {
  if (cache) return cache;
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
  if (!existsSync(FILE)) {
    cache = { schedules: [] };
    persist();
    return cache;
  }
  try {
    const raw = readFileSync(FILE, "utf8");
    const parsed = JSON.parse(raw);
    cache = { schedules: Array.isArray(parsed.schedules) ? parsed.schedules : [] };
  } catch (e) {
    console.warn(`[schedules] failed to read ${FILE}: ${(e as Error).message}. Starting empty.`);
    cache = { schedules: [] };
  }
  return cache;
}

function persist() {
  if (!cache) return;
  try { writeFileSync(FILE, JSON.stringify(cache, null, 2)); }
  catch (e) { console.warn(`[schedules] persist failed: ${(e as Error).message}`); }
}

export function listSchedules(): Schedule[] {
  return load().schedules.slice();
}

export function getSchedule(id: string): Schedule | undefined {
  return load().schedules.find(s => s.id === id);
}

export function createSchedule(input: Omit<Schedule, "id" | "createdAt" | "fireCount" | "enabled"> & { enabled?: boolean }): Schedule {
  const s = load();
  const id = `sched-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const fresh: Schedule = {
    id,
    name: input.name,
    templateId: input.templateId,
    inputs: input.inputs ?? {},
    cadence: input.cadence,
    enabled: input.enabled ?? true,
    createdAt: new Date().toISOString(),
    fireCount: 0,
  };
  s.schedules.push(fresh);
  persist();
  return fresh;
}

export function updateSchedule(id: string, patch: Partial<Pick<Schedule, "name" | "templateId" | "inputs" | "cadence" | "enabled">>): Schedule | null {
  const s = load();
  const idx = s.schedules.findIndex(x => x.id === id);
  if (idx === -1) return null;
  s.schedules[idx] = { ...s.schedules[idx], ...patch };
  persist();
  return s.schedules[idx];
}

export function deleteSchedule(id: string): boolean {
  const s = load();
  const before = s.schedules.length;
  s.schedules = s.schedules.filter(x => x.id !== id);
  if (s.schedules.length === before) return false;
  persist();
  return true;
}

// Compute the next fire time for a cadence, in absolute ms-since-epoch.
// Uses local time (server-local). Returns null when cadence is empty
// (e.g. no days selected).
export function nextFireAt(cadence: Cadence, from: Date = new Date()): number | null {
  const days = cadence.daysOfWeek.length === 0 ? [0,1,2,3,4,5,6] : cadence.daysOfWeek.slice().sort((a,b)=>a-b);
  if (days.length === 0) return null;
  // Try today + each of the next 7 days; return the first match strictly
  // after `from`.
  for (let offset = 0; offset < 8; offset++) {
    const candidate = new Date(from.getTime());
    candidate.setDate(candidate.getDate() + offset);
    candidate.setHours(cadence.hour, cadence.minute, 0, 0);
    if (!days.includes(candidate.getDay())) continue;
    if (candidate.getTime() <= from.getTime()) continue;
    return candidate.getTime();
  }
  return null;
}

// Mark a schedule as fired with a jobId. Updates lastFiredAt + fireCount +
// clears lastError.
export function recordFire(id: string, jobId: string) {
  const s = load();
  const idx = s.schedules.findIndex(x => x.id === id);
  if (idx === -1) return;
  s.schedules[idx] = {
    ...s.schedules[idx],
    lastFiredAt: new Date().toISOString(),
    lastJobId: jobId,
    lastError: undefined,
    fireCount: (s.schedules[idx].fireCount ?? 0) + 1,
  };
  persist();
}

export function recordFireError(id: string, error: string) {
  const s = load();
  const idx = s.schedules.findIndex(x => x.id === id);
  if (idx === -1) return;
  s.schedules[idx] = { ...s.schedules[idx], lastError: error.slice(0, 500) };
  persist();
}

// ---------- Tick scheduler ----------
//
// Single setInterval polls every 30s. For each enabled schedule, compute
// nextFireAt against (lastFiredAt or createdAt). If it's <= now, fire the
// schedule via the template-run endpoint and record the fire.
//
// We do NOT use a strict cron library to keep this dependency-free. The
// 30s tick + lastFiredAt clamp guarantees each cadence fires at most once
// per window even if the server restarts mid-window.

let timer: NodeJS.Timeout | null = null;

async function fireSchedule(s: Schedule): Promise<void> {
  const url = `http://127.0.0.1:${config.port}/api/templates/run/${encodeURIComponent(s.templateId)}`;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(s.inputs ?? {}),
    });
    const body: any = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = body?.error ? String(body.error) : `HTTP ${r.status}`;
      console.warn(`[schedules] fire failed: ${s.id} (${s.name}) — ${msg}`);
      recordFireError(s.id, msg);
      return;
    }
    if (!body?.jobId) {
      console.warn(`[schedules] fire returned no jobId: ${s.id} (${s.name})`);
      recordFireError(s.id, "no jobId in response");
      return;
    }
    recordFire(s.id, body.jobId);
    console.log(`[schedules] fired ${s.id} (${s.name}) → job ${String(body.jobId).slice(0, 8)}`);
  } catch (e: any) {
    console.warn(`[schedules] fire crashed: ${s.id} (${s.name}) — ${e?.message ?? e}`);
    recordFireError(s.id, String(e?.message ?? e));
  }
}

function tick() {
  const now = Date.now();
  for (const s of listSchedules()) {
    if (!s.enabled) continue;
    // Compute next fire from the last fire (or createdAt if never fired).
    // We only fire when next <= now. The 30s tick keeps lateness <= 30s.
    const from = new Date(s.lastFiredAt ?? s.createdAt);
    const next = nextFireAt(s.cadence, from);
    if (next === null) continue;
    if (next <= now) {
      void fireSchedule(s);
    }
  }
}

export function startScheduleScheduler() {
  if (timer) return;
  // 30s tick — fine-grained enough for minute-precision cadence without
  // wasted CPU. Each tick is a few file reads + a Date.now() compare per
  // schedule, so even with hundreds of schedules it's <1ms.
  timer = setInterval(tick, 30_000);
  timer.unref?.();
  // One immediate tick on boot so a schedule that was due during downtime
  // fires within seconds instead of waiting up to 30s.
  setTimeout(tick, 2_000);
}

export function stopScheduleScheduler() {
  if (timer) { clearInterval(timer); timer = null; }
}
