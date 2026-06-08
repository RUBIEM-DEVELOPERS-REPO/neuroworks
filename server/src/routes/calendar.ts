import { Router } from "express";
import { loadJobsInWindow } from "../lib/job-store.js";
import { listJobs } from "../lib/jobs.js";

// Activity-calendar endpoints. The Calendar page asks "what did the agents
// actually do on each day?" — that's a journal aggregation over [from, to],
// merging the in-memory recent jobs with the persisted JSONL store so a day
// from a week ago still shows up. The `agenda` endpoint extends with iCal
// meetings (if configured) and upcoming schedules, so one day can be read as
// a complete picture: meetings + work-done + work-planned.

export const calendarRouter = Router();

type DayJob = {
  id: string;
  kind: string;
  template?: string;
  title?: string;
  personaName?: string;
  status: string;
  startedAt: string;
  finishedAt?: string;
  durationSec?: number;
  scoreOrNull?: number | null;
};

// Bucket by LOCAL calendar day. The server runs on the operator's machine, so
// its local timezone matches theirs — using the raw UTC slice (iso.slice(0,10))
// would put late-evening / early-morning jobs on the wrong day for any non-UTC
// timezone. localYmd matches the LOCAL date the Calendar UI renders.
function localYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function dayKey(iso: string): string { return localYmd(new Date(iso)); }
// Local-day bounds in ms. A date-time string without a timezone suffix is
// parsed as LOCAL by V8, so "<date>T00:00:00" is local midnight.
const localDayStart = (date: string) => Date.parse(date + "T00:00:00.000");
const localDayEnd = (date: string) => Date.parse(date + "T23:59:59.999");

function jobsInRange(fromMs: number, toMs: number): DayJob[] {
  // Merge persisted (older) + in-memory (recent) so the calendar covers a
  // long window without dropping fresh jobs that haven't been flushed yet.
  const persisted = loadJobsInWindow(fromMs, toMs);
  const inMem = listJobs();
  const map = new Map<string, DayJob>();
  for (const j of persisted) {
    const at = Date.parse(j.finishedAt ?? j.startedAt);
    if (!Number.isFinite(at) || at < fromMs || at > toMs) continue;
    // PersistedJob is the slim store shape — personaName / result live on the
    // in-memory Job and may be absent on disk. Cast and tolerate undefined.
    const any = j as any;
    map.set(j.id, {
      id: j.id, kind: j.kind, template: j.template, title: j.title,
      personaName: any.personaName, status: j.status,
      startedAt: j.startedAt, finishedAt: j.finishedAt,
      durationSec: j.finishedAt ? Math.max(0, Math.round((Date.parse(j.finishedAt) - Date.parse(j.startedAt)) / 1000)) : undefined,
      scoreOrNull: any.result?.quality?.score ?? null,
    });
  }
  for (const j of inMem) {
    const at = Date.parse(j.finishedAt ?? j.startedAt);
    if (!Number.isFinite(at) || at < fromMs || at > toMs) continue;
    map.set(j.id, {
      id: j.id, kind: j.kind, template: j.template, title: j.title,
      personaName: j.personaName, status: j.status,
      startedAt: j.startedAt, finishedAt: j.finishedAt,
      durationSec: j.finishedAt ? Math.max(0, Math.round((Date.parse(j.finishedAt) - Date.parse(j.startedAt)) / 1000)) : undefined,
      scoreOrNull: (j.result as any)?.quality?.score ?? null,
    });
  }
  return [...map.values()].sort((a, b) => (a.finishedAt ?? a.startedAt).localeCompare(b.finishedAt ?? b.startedAt));
}

// GET /api/calendar/activity?from=YYYY-MM-DD&to=YYYY-MM-DD
// Returns jobs grouped by day in the requested range. Default window is the
// last 31 days ending today.
calendarRouter.get("/activity", (req, res) => {
  try {
    const today = new Date();
    const defTo = localYmd(today);
    const def = localYmd(new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000));
    const from = String(req.query.from ?? def);
    const to = String(req.query.to ?? defTo);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return res.status(400).json({ error: "from/to must be YYYY-MM-DD" });
    }
    const fromMs = localDayStart(from);
    const toMs = localDayEnd(to);
    const jobs = jobsInRange(fromMs, toMs);
    const days = new Map<string, { date: string; jobs: DayJob[] }>();
    // Pre-seed every day in the window so empty days render in the UI. Iterate
    // from local noon to dodge DST edges when stepping by calendar date.
    for (let d = new Date(from + "T12:00:00"); localYmd(d) <= to; d.setDate(d.getDate() + 1)) {
      const k = localYmd(d);
      days.set(k, { date: k, jobs: [] });
    }
    for (const j of jobs) {
      const k = dayKey(j.finishedAt ?? j.startedAt);
      const bucket = days.get(k) ?? { date: k, jobs: [] };
      bucket.jobs.push(j);
      days.set(k, bucket);
    }
    res.json({ from, to, days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)) });
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message ?? e).slice(0, 300) });
  }
});

// GET /api/calendar/agenda?date=YYYY-MM-DD
// Complete view of one day: activity (jobs that completed on this day),
// meetings (from iCal if configured), and any scheduled tasks due today.
calendarRouter.get("/agenda", async (req, res) => {
  try {
    const date = String(req.query.date ?? localYmd(new Date()));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "date must be YYYY-MM-DD" });
    const fromMs = localDayStart(date);
    const toMs = localDayEnd(date);
    const jobs = jobsInRange(fromMs, toMs);

    let meetings: any[] = [];
    let meetingsError: string | undefined;
    const icalSource = process.env.CLAWBOT_CALENDAR_ICAL_URL;
    if (icalSource) {
      try {
        const { readICalSource } = await import("../lib/calendar-ical.js");
        const all = await readICalSource(icalSource);
        meetings = all.filter(e => localYmd(new Date(e.start)) === date).sort((a, b) => a.start.localeCompare(b.start));
      } catch (e: any) { meetingsError = String(e?.message ?? e).slice(0, 200); }
    }

    let schedules: any[] = [];
    try {
      const { listSchedules } = await import("../lib/schedules.js");
      const all = listSchedules();
      const targetDow = new Date(date + "T12:00:00").getDay();
      schedules = all.filter((s: any) => {
        const days = s.cadence?.daysOfWeek ?? [];
        return days.length === 0 || days.includes(targetDow);
      }).map((s: any) => ({ id: s.id, templateId: s.templateId, label: s.label, cadence: s.cadence, enabled: s.enabled }));
    } catch { /* schedules optional */ }

    res.json({ date, activity: jobs, meetings, meetingsError, schedules });
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message ?? e).slice(0, 300) });
  }
});
