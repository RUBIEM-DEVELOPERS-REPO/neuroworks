// Human-work ledger — the people half of the hybrid workforce's books.
//
// The system already knows everything about AGENT work (jobs journal, cost
// tracker). This store records HUMAN work signals so the monitor can compare
// the two sides: hours logged per person per day, ingested from
//   - timesheet CSV uploads (Workforce/Users page),
//   - company-system connectors (a sync endpoint POSTs rows),
//   - manual entries.
//
// Combined with the salary field on users (ZAR/month → rate/hour), this is
// what lets the Cost page price human work next to agent spend, and the
// time-waste analysis attribute hours to the human side.
//
// Persisted append-only at .neuroworks/human-work.jsonl (gitignored, same
// pattern as the jobs journal — durable, jq-able, no DB dependency).

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = resolve(__dirname, "../../../.neuroworks");
const LEDGER_PATH = resolve(CONFIG_DIR, "human-work.jsonl");

export type HumanWorkSource = "upload" | "connector" | "manual";

export type HumanWorkEntry = {
  id: string;
  userEmail: string;        // matched against the Users directory (lowercase)
  date: string;             // YYYY-MM-DD the work happened
  hours: number;            // decimal hours, 0 < h <= 24
  description?: string;
  taskRef?: string;         // optional job id / ticket ref the hours attach to
  source: HumanWorkSource;
  ts: string;               // ingestion timestamp
};

function ensureDir(): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normDate(v: unknown): string | null {
  const s = String(v ?? "").trim().slice(0, 10);
  if (DATE_RE.test(s)) return s;
  const d = new Date(String(v ?? ""));
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

// Validate + normalise a raw row into an entry. Returns null (with a reason)
// rather than throwing so a bulk ingest reports per-row errors.
export function coerceEntry(raw: any, source: HumanWorkSource): { entry?: HumanWorkEntry; error?: string } {
  const email = String(raw?.userEmail ?? raw?.email ?? raw?.user ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) return { error: "missing/invalid email" };
  const date = normDate(raw?.date ?? raw?.day ?? raw?.worked_on);
  if (!date) return { error: "missing/invalid date (want YYYY-MM-DD)" };
  const hours = Number(raw?.hours ?? raw?.hrs ?? raw?.duration);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) return { error: "hours must be a number in (0, 24]" };
  return {
    entry: {
      id: randomUUID(),
      userEmail: email,
      date,
      hours: Math.round(hours * 100) / 100,
      description: raw?.description ? String(raw.description).slice(0, 300) : (raw?.task ? String(raw.task).slice(0, 300) : undefined),
      taskRef: raw?.taskRef ? String(raw.taskRef).slice(0, 100) : undefined,
      source,
      ts: new Date().toISOString(),
    },
  };
}

export function addHumanWork(rows: any[], source: HumanWorkSource): { added: number; errors: { row: number; error: string }[] } {
  ensureDir();
  const errors: { row: number; error: string }[] = [];
  let added = 0;
  const lines: string[] = [];
  rows.forEach((raw, i) => {
    const { entry, error } = coerceEntry(raw, source);
    if (!entry) { errors.push({ row: i, error: error ?? "invalid row" }); return; }
    lines.push(JSON.stringify(entry));
    added += 1;
  });
  if (lines.length > 0) appendFileSync(LEDGER_PATH, lines.join("\n") + "\n", "utf8");
  return { added, errors };
}

// Minimal CSV parser for timesheets — header row + comma/semicolon delimiter,
// quoted fields supported. Header names are matched loosely (email/user,
// date/day, hours/hrs/duration, description/task/notes).
export function parseTimesheetCsv(text: string): any[] {
  const rows: string[][] = [];
  let field = "", row: string[] = [], inQuotes = false;
  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => { if (row.length > 1 || row[0]?.trim()) rows.push(row); row = []; };
  const delim = text.split("\n")[0]?.includes(";") && !text.split("\n")[0]?.includes(",") ? ";" : ",";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delim) pushField();
    else if (c === "\n") { pushField(); pushRow(); }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { pushField(); pushRow(); }
  if (rows.length < 2) return [];
  const header = rows[0].map(h => h.trim().toLowerCase());
  const col = (names: string[]) => header.findIndex(h => names.some(n => h === n || h.includes(n)));
  const iEmail = col(["email", "user", "person", "employee"]);
  const iDate = col(["date", "day", "worked"]);
  const iHours = col(["hours", "hrs", "duration", "time"]);
  const iDesc = col(["description", "task", "notes", "activity", "work"]);
  if (iEmail === -1 || iDate === -1 || iHours === -1) return [];
  return rows.slice(1).map(r => ({
    email: r[iEmail],
    date: r[iDate],
    hours: r[iHours],
    description: iDesc >= 0 ? r[iDesc] : undefined,
  }));
}

export function listHumanWork(sinceDays = 30): HumanWorkEntry[] {
  if (!existsSync(LEDGER_PATH)) return [];
  const cutoff = new Date(Date.now() - sinceDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const out: HumanWorkEntry[] = [];
  try {
    for (const line of readFileSync(LEDGER_PATH, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line) as HumanWorkEntry;
        if (e.date >= cutoff) out.push(e);
      } catch { /* tolerate a torn line */ }
    }
  } catch { return []; }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

export type HumanWorkSummary = {
  sinceDays: number;
  totalHours: number;
  entryCount: number;
  byUser: { email: string; hours: number; entries: number; lastDate?: string }[];
  byDay: { date: string; hours: number }[];
};

export function summarizeHumanWork(sinceDays = 30): HumanWorkSummary {
  const entries = listHumanWork(sinceDays);
  const byUserMap = new Map<string, { hours: number; entries: number; lastDate?: string }>();
  const byDayMap = new Map<string, number>();
  let totalHours = 0;
  for (const e of entries) {
    totalHours += e.hours;
    const u = byUserMap.get(e.userEmail) ?? { hours: 0, entries: 0 };
    u.hours += e.hours; u.entries += 1;
    if (!u.lastDate || e.date > u.lastDate) u.lastDate = e.date;
    byUserMap.set(e.userEmail, u);
    byDayMap.set(e.date, (byDayMap.get(e.date) ?? 0) + e.hours);
  }
  return {
    sinceDays,
    totalHours: Math.round(totalHours * 100) / 100,
    entryCount: entries.length,
    byUser: [...byUserMap.entries()].map(([email, v]) => ({ email, hours: Math.round(v.hours * 100) / 100, entries: v.entries, lastDate: v.lastDate })).sort((a, b) => b.hours - a.hours),
    byDay: [...byDayMap.entries()].map(([date, hours]) => ({ date, hours: Math.round(hours * 100) / 100 })).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

// Standard working-hours assumption for converting a monthly salary to an
// hourly rate: ~21.67 working days × 8h. Kept in one place so the Cost page
// and time-waste analysis price human hours identically.
export const WORK_HOURS_PER_MONTH = 21.67 * 8;

export function hourlyRate(salaryMonthly: number | undefined): number | undefined {
  if (!Number.isFinite(Number(salaryMonthly)) || Number(salaryMonthly) <= 0) return undefined;
  return Number(salaryMonthly) / WORK_HOURS_PER_MONTH;
}
