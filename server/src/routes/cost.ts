import { Router } from "express";
import { getCostSummary, getCostRecords } from "../lib/cost-tracker.js";
import { addHumanWork, listHumanWork, parseTimesheetCsv, summarizeHumanWork, hourlyRate, WORK_HOURS_PER_MONTH } from "../lib/human-work.js";
import { listUsers } from "../lib/users.js";

export const costRouter = Router();

costRouter.get("/summary", (_req, res) => {
  res.json(getCostSummary());
});

costRouter.get("/records", (req, res) => {
  const since = typeof req.query.since === "string" ? req.query.since : undefined;
  res.json({ records: getCostRecords(since) });
});

// ── Human side of the books ───────────────────────────────────────────────

// Ingest human work: JSON rows ({rows:[{email,date,hours,description?}]}),
// a raw timesheet CSV ({csv:"email,date,hours\n..."}), or both. `source`
// defaults to "manual"; connectors POST with source:"connector".
costRouter.post("/human-work", (req, res) => {
  const b = req.body ?? {};
  const source = ["upload", "connector", "manual"].includes(b.source) ? b.source : "manual";
  const rows: any[] = Array.isArray(b.rows) ? [...b.rows] : [];
  if (typeof b.csv === "string" && b.csv.trim()) {
    const parsed = parseTimesheetCsv(b.csv);
    if (parsed.length === 0) return res.status(400).json({ error: "couldn't parse the CSV — need a header row with email, date, and hours columns" });
    rows.push(...parsed);
  }
  if (rows.length === 0) return res.status(400).json({ error: "provide rows[] or csv" });
  const result = addHumanWork(rows, source);
  res.json(result);
});

costRouter.get("/human-work", (req, res) => {
  const days = Math.max(1, Math.min(365, Number(req.query.days ?? 30)));
  res.json({ entries: listHumanWork(days).slice(0, 500) });
});

// The workforce ledger — agent spend and human spend side by side, priced
// from the same window. Human cost = logged hours × (salaryMonthly ÷ standard
// month hours) per user; users with hours but no salary are listed unpriced
// so the gap is visible instead of silently under-counting.
costRouter.get("/workforce", (req, res) => {
  const days = Math.max(1, Math.min(365, Number(req.query.days ?? 30)));
  const sinceIso = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

  const agentRecords = getCostRecords(sinceIso);
  const agentCostUsd = agentRecords.reduce((s, r) => s + r.costUsd, 0);
  const agentCalls = agentRecords.length;

  const human = summarizeHumanWork(days);
  const users = listUsers();
  const byEmail = new Map(users.map(u => [u.email.toLowerCase(), u]));
  let humanCostZar = 0;
  let unpricedHours = 0;
  const perUser = human.byUser.map(u => {
    const user = byEmail.get(u.email);
    const rate = hourlyRate((user as any)?.salaryMonthly);
    const costZar = rate !== undefined ? u.hours * rate : undefined;
    if (costZar !== undefined) humanCostZar += costZar;
    else unpricedHours += u.hours;
    return {
      email: u.email,
      name: user?.name,
      workMode: (user as any)?.workMode,
      hours: u.hours,
      entries: u.entries,
      hourlyRateZar: rate !== undefined ? Math.round(rate * 100) / 100 : undefined,
      costZar: costZar !== undefined ? Math.round(costZar * 100) / 100 : undefined,
      salarySet: rate !== undefined,
    };
  });

  res.json({
    days,
    agent: { costUsd: Math.round(agentCostUsd * 10000) / 10000, calls: agentCalls },
    human: {
      totalHours: human.totalHours,
      costZar: Math.round(humanCostZar * 100) / 100,
      unpricedHours: Math.round(unpricedHours * 100) / 100,
      workHoursPerMonth: Math.round(WORK_HOURS_PER_MONTH * 100) / 100,
      byUser: perUser,
      byDay: human.byDay,
    },
  });
});
