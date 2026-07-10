import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, CalendarDays, Users, Briefcase, AlertTriangle } from "lucide-react";
import { api } from "../lib/api";
import { Card, Button } from "../components/Card";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Format a Date as its LOCAL calendar day. Using toISOString() here would
// convert to UTC and shift the date by the timezone offset (e.g. local midnight
// in UTC+2 becomes the previous day) — the classic calendar off-by-one.
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function todayLocal(): Date { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function startOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }

// Activity calendar — the operator's "what did we actually do" view. Each
// cell shows that day's job count + the personas involved + a heat tint
// scaled by job count. Click a day → right-hand panel with the full agenda:
// meetings (if iCal feed configured), scheduled clawbot tasks for that day,
// activity (jobs that ran), and carryover from yesterday's unfinished work.
export function CalendarPage() {
  const [anchor, setAnchor] = useState(todayLocal());
  const [selected, setSelected] = useState(todayLocal());
  const [activity, setActivity] = useState<{ date: string; jobs: any[] }[]>([]);
  const [agenda, setAgenda] = useState<{ date: string; activity: any[]; meetings: any[]; meetingsError?: string; schedules: any[] } | null>(null);
  const [loading, setLoading] = useState(false);

  const monthStart = startOfMonth(anchor);
  const monthEnd = endOfMonth(anchor);
  // Fetch the visible window (the prev/next month bleed into the grid; pad
  // the request by ~10 days each side so the bleed cells show counts too).
  const fetchFrom = new Date(monthStart); fetchFrom.setDate(fetchFrom.getDate() - 10);
  const fetchTo = new Date(monthEnd); fetchTo.setDate(fetchTo.getDate() + 10);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.calendarActivity(ymd(fetchFrom), ymd(fetchTo))
      .then(r => { if (alive) setActivity(r.days); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor.getFullYear(), anchor.getMonth()]);

  useEffect(() => {
    let alive = true;
    api.calendarAgenda(ymd(selected)).then(r => { if (alive) setAgenda(r); }).catch(() => {});
    return () => { alive = false; };
  }, [selected]);

  // Build the month grid: 6 rows × 7 columns starting from the Sunday of
  // the week containing monthStart. Some cells are "out of month" — render
  // them dimmer so the eye scans the active month.
  const grid = useMemo(() => {
    const cells: Date[] = [];
    const first = new Date(monthStart);
    const dow = first.getDay();
    first.setDate(first.getDate() - dow);
    for (let i = 0; i < 42; i++) {
      const d = new Date(first); d.setDate(first.getDate() + i);
      cells.push(d);
    }
    return cells;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor.getFullYear(), anchor.getMonth()]);

  const dayMap = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const d of activity) m.set(d.date, d.jobs);
    return m;
  }, [activity]);
  const maxJobsInDay = useMemo(() => Math.max(1, ...activity.map(d => d.jobs.length)), [activity]);

  const monthLabel = anchor.toLocaleString("en-US", { month: "long", year: "numeric" });
  const isSelected = (d: Date) => ymd(d) === ymd(selected);
  const isToday = (d: Date) => ymd(d) === ymd(todayLocal());
  const inMonth = (d: Date) => d.getMonth() === anchor.getMonth();

  function shift(months: number) {
    const n = new Date(anchor); n.setMonth(n.getMonth() + months); setAnchor(n);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl text-cream-50 flex items-center gap-3"><CalendarDays size={24} /> Calendar</h1>
          <p className="text-sm text-cream-300/70 mt-1">Activity, meetings, and scheduled work in one view. Agents can read and plan from the same data — primitives <span className="font-mono">calendar.activity</span>, <span className="font-mono">calendar.plan_day</span>.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => shift(-1)}><ChevronLeft size={14} /></Button>
          <Button onClick={() => { const t = todayLocal(); setAnchor(t); setSelected(t); }}>Today</Button>
          <Button onClick={() => shift(1)}><ChevronRight size={14} /></Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card title={monthLabel} className="col-span-2">
          <div className="grid grid-cols-7 gap-px bg-ink-800 rounded-lg overflow-hidden border border-ink-800">
            {WEEKDAYS.map(d => (
              <div key={d} className="bg-ink-900 px-2 py-1.5 text-[10px] uppercase tracking-wider text-cream-300/50 text-center">{d}</div>
            ))}
            {grid.map((d, i) => {
              const k = ymd(d);
              const jobs = dayMap.get(k) ?? [];
              const heat = jobs.length === 0 ? 0 : Math.min(1, jobs.length / maxJobsInDay);
              const personas = new Set<string>(jobs.map((j: any) => j.personaName).filter(Boolean));
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setSelected(d)}
                  className={`bg-ink-950 px-2 py-2 text-left min-h-[78px] flex flex-col gap-1 group relative nw-fade-up nw-delay-${Math.min(7, Math.floor(i / 7) + 1)} ${inMonth(d) ? "" : "opacity-50"} ${isSelected(d) ? "ring-2 ring-violet-500" : "hover:bg-ink-900"} ${heat > 0 ? "heat-tint" : ""}`}
                  style={heat > 0 ? { "--heat": `${0.04 + heat * 0.12}` } as React.CSSProperties : undefined}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-mono ${isToday(d) ? "bg-violet-500 text-cream-50 rounded-full w-5 h-5 grid place-items-center" : "text-cream-100"}`}>{d.getDate()}</span>
                    {jobs.length > 0 && <span className="text-[9px] font-mono text-cream-300/60">{jobs.length}</span>}
                  </div>
                  {personas.size > 0 && (
                    <div className="flex items-center gap-0.5 flex-wrap">
                      {[...personas].slice(0, 4).map(p => (
                        <span key={p} className="text-[9px] px-1 rounded bg-violet-500/15 text-violet-300 truncate max-w-[64px]">{p}</span>
                      ))}
                      {personas.size > 4 && <span className="text-[9px] text-cream-300/60">+{personas.size - 4}</span>}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          {loading && activity.length === 0 && (
            <div className="text-[11px] text-cream-300/50 mt-2 inline-flex items-center gap-2">
              <span className="nw-thinking-dots text-cream-300/60"><span /><span /><span /></span>
              Loading activity
            </div>
          )}
        </Card>

        <Card title={selected.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}>
          {!agenda ? (
            <div className="text-sm text-cream-300/60">Loading…</div>
          ) : (
            <div className="space-y-4 text-sm">
              <AgendaSection
                icon={<CalendarDays size={14} />}
                title="Meetings"
                empty={agenda.meetingsError ? `iCal feed error: ${agenda.meetingsError}` : "No meetings (set NEUROWORKS_CALENDAR_ICAL_URL in clawbot/.env to overlay your real calendar)."}
                items={agenda.meetings.map(m => ({
                  title: m.summary,
                  meta: `${new Date(m.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}${m.end ? `–${new Date(m.end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}${m.location ? ` · ${m.location}` : ""}`,
                }))}
              />
              <AgendaSection
                icon={<Briefcase size={14} />}
                title={`Activity (${agenda.activity.length})`}
                empty="No agent activity recorded on this day."
                items={agenda.activity.slice(0, 12).map((j: any) => ({
                  title: j.title ?? j.kind,
                  meta: `${j.status}${j.personaName ? ` · ${j.personaName}` : ""}${j.finishedAt ? ` · ${new Date(j.finishedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}`,
                  href: `/results/${j.id}`,
                  badge: j.status === "failed" ? "fail" : j.scoreOrNull !== null ? Math.round(j.scoreOrNull * 100) + "" : undefined,
                  tone: j.status === "failed" ? "fail" : undefined,
                }))}
              />
              <AgendaSection
                icon={<Users size={14} />}
                title="Scheduled"
                empty="No Neuro schedules run on this day-of-week."
                items={agenda.schedules.map((s: any) => ({
                  title: s.label ?? s.templateId,
                  meta: `${s.cadence?.hour?.toString().padStart(2, "0") ?? "?"}:${s.cadence?.minute?.toString().padStart(2, "0") ?? "?"} · ${s.enabled === false ? "paused" : "active"}`,
                }))}
              />
              <div className="pt-2 border-t border-ink-800">
                <Link
                  to={`/chat?q=${encodeURIComponent(`Plan my day for ${ymd(selected)} using calendar.plan_day and the daily-briefing skill.`)}`}
                  className="inline-flex items-center gap-1.5 text-xs text-violet-400 hover:text-violet-500"
                >Plan this day with an agent →</Link>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

type AgendaItem = { title: string; meta: string; href?: string; badge?: string; tone?: "fail" };

function AgendaRow({ it }: { it: AgendaItem }) {
  const body = (
    <span className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${it.tone === "fail" ? "bg-coral-500/5 border border-coral-500/30" : "bg-ink-950 border border-ink-800"} ${it.href ? "hover:bg-ink-900" : ""}`}>
      <span className="flex-1 min-w-0">
        <span className="text-cream-100 truncate block">{it.title}</span>
        <span className="text-[10px] text-cream-300/60 truncate block">{it.meta}</span>
      </span>
      {it.badge && <span className={`text-[10px] font-mono shrink-0 ${it.tone === "fail" ? "text-coral-400" : "text-cream-300/70"}`}>{it.badge}</span>}
    </span>
  );
  return it.href ? <Link to={it.href}>{body}</Link> : body;
}

function AgendaSection({ icon, title, empty, items }: { icon: React.ReactNode; title: string; empty: string; items: AgendaItem[] }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-cream-300/60 mb-1.5">{icon} <span>{title}</span></div>
      {items.length === 0 ? (
        <div className="text-[12px] text-cream-300/50 italic flex items-start gap-1.5">{empty.startsWith("Set ") || empty.includes("error") || empty.startsWith("No meetings") ? <AlertTriangle size={12} className="mt-0.5 text-flame-400" /> : null}{empty}</div>
      ) : (
        <ul className="space-y-1">
          {items.map((it, i) => (
            <li key={i}><AgendaRow it={it} /></li>
          ))}
        </ul>
      )}
    </div>
  );
}
