import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Calendar, Play, Pause, Trash2, Plus, AlertTriangle, ArrowRight } from "lucide-react";
import { api, type Schedule, type Template, type Cadence } from "../lib/api";
import { Card, Button } from "../components/Card";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatNext(ts: number | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts);
  const now = Date.now();
  const diff = d.getTime() - now;
  if (diff < 0) return "due now";
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `in ${hrs}h`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `in ${days}d`;
  return d.toLocaleString();
}

function formatCadence(c: Cadence): string {
  const t = `${c.hour.toString().padStart(2, "0")}:${c.minute.toString().padStart(2, "0")}`;
  if (c.daysOfWeek.length === 0 || c.daysOfWeek.length === 7) return `Every day at ${t}`;
  const weekdays = [1, 2, 3, 4, 5];
  if (c.daysOfWeek.length === 5 && weekdays.every(d => c.daysOfWeek.includes(d))) return `Weekdays at ${t}`;
  const sorted = c.daysOfWeek.slice().sort((a, b) => a - b);
  return `${sorted.map(d => DAY_LABELS[d]).join(", ")} at ${t}`;
}

export function Schedules() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [err, setErr] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  async function load() {
    try {
      const [s, t] = await Promise.all([api.listSchedules(), api.listTemplates()]);
      setSchedules(s.schedules);
      setTemplates(t.templates);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    }
  }
  useEffect(() => {
    load();
    const i = setInterval(load, 5000);
    return () => clearInterval(i);
  }, []);

  async function togglePause(s: Schedule) {
    try { await api.updateSchedule(s.id, { enabled: !s.enabled }); await load(); }
    catch (e: any) { setErr(e?.message ?? String(e)); }
  }
  async function remove(s: Schedule) {
    if (!confirm(`Delete schedule "${s.name}"? This cannot be undone.`)) return;
    try { await api.deleteSchedule(s.id); await load(); }
    catch (e: any) { setErr(e?.message ?? String(e)); }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-cream-50">Schedules</h1>
          <p className="text-sm text-cream-300/70 mt-1">Run any template on a day-of-week and time cadence. Fires happen on the primary server.</p>
        </div>
        <Button onClick={() => setShowCreate(o => !o)} variant={showCreate ? "subtle" : "primary"}>
          <span className="inline-flex items-center gap-1.5"><Plus size={14} /> {showCreate ? "Cancel" : "New schedule"}</span>
        </Button>
      </div>

      {err && (
        <div className="bg-coral-500/10 border border-coral-500/30 text-coral-300 text-sm rounded-md px-3 py-2 flex items-center gap-2">
          <AlertTriangle size={14} /> {err}
        </div>
      )}

      {showCreate && (
        <CreateScheduleForm
          templates={templates}
          onCreated={async () => { setShowCreate(false); await load(); }}
          onError={setErr}
        />
      )}

      <Card title={`Active schedules (${schedules.length})`}>
        {schedules.length === 0 ? (
          <p className="text-sm text-cream-300/60">
            No schedules yet. Click <span className="text-cream-100">New schedule</span> above to set one up.
          </p>
        ) : (
          <div className="divide-y divide-ink-800">
            {schedules.map(s => {
              const tpl = templates.find(t => t.id === s.templateId);
              return (
                <div key={s.id} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Calendar size={14} className={s.enabled ? "text-violet-400" : "text-cream-300/40"} />
                        <span className="text-sm text-cream-50 font-medium truncate">{s.name}</span>
                        {!s.enabled && <span className="text-[10px] uppercase tracking-wider text-cream-300/50 bg-ink-850 border border-ink-700 rounded px-1.5 py-0.5">paused</span>}
                      </div>
                      <div className="text-[11px] text-cream-300/70 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span>{formatCadence(s.cadence)}</span>
                        <span className="text-cream-300/40">·</span>
                        <span>Runs <span className="text-cream-100">{tpl?.title ?? s.templateId}</span></span>
                        <span className="text-cream-300/40">·</span>
                        <span>Next: <span className="text-cream-100">{s.enabled ? formatNext(s.nextFireAt) : "paused"}</span></span>
                        {s.fireCount > 0 && (<><span className="text-cream-300/40">·</span><span>{s.fireCount} fire{s.fireCount === 1 ? "" : "s"}</span></>)}
                      </div>
                      {s.lastFiredAt && (
                        <div className="text-[10px] text-cream-300/50 mt-1">
                          Last fired {new Date(s.lastFiredAt).toLocaleString()}
                          {s.lastJobId && (
                            <> · <Link to={`/tasks?focus=${s.lastJobId}`} className="text-violet-400 hover:text-violet-500">
                              job {s.lastJobId.slice(0, 8)} <ArrowRight size={10} className="inline" />
                            </Link></>
                          )}
                        </div>
                      )}
                      {s.lastError && (
                        <div className="text-[10px] text-coral-400 mt-1 flex items-start gap-1">
                          <AlertTriangle size={11} className="mt-0.5" /> Last fire failed: {s.lastError}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => togglePause(s)}
                        className="text-cream-300 hover:text-cream-50 p-1.5 rounded hover:bg-ink-800"
                        title={s.enabled ? "Pause schedule" : "Resume schedule"}
                        aria-label={s.enabled ? "Pause schedule" : "Resume schedule"}
                      >
                        {s.enabled ? <Pause size={14} /> : <Play size={14} />}
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(s)}
                        className="text-cream-300/70 hover:text-coral-400 p-1.5 rounded hover:bg-ink-800"
                        title="Delete schedule"
                        aria-label="Delete schedule"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

function CreateScheduleForm({ templates, onCreated, onError }: {
  templates: Template[];
  onCreated: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [submitting, setSubmitting] = useState(false);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [deliverEmail, setDeliverEmail] = useState("");

  const tpl = useMemo(() => templates.find(t => t.id === templateId), [templates, templateId]);

  function toggleDay(d: number) {
    setDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort((a, b) => a - b));
  }

  async function submit() {
    if (!name.trim() || !templateId) { onError("Name and template are required."); return; }
    setSubmitting(true);
    try {
      // Coerce inputs by declared type.
      const coerced: Record<string, unknown> = {};
      for (const i of tpl?.inputs ?? []) {
        const v = inputs[i.name];
        if (v === undefined || v === "") continue;
        if (i.type === "number") coerced[i.name] = Number(v);
        else if (i.type === "boolean") coerced[i.name] = v === "true";
        else coerced[i.name] = v;
      }
      await api.createSchedule({
        name: name.trim(),
        templateId,
        inputs: coerced,
        cadence: { daysOfWeek: days, hour, minute },
        enabled: true,
        ...(deliverEmail.trim() ? { deliver: { email: deliverEmail.trim() } } : {}),
      });
      await onCreated();
      setName(""); setTemplateId(""); setInputs({}); setDeliverEmail("");
    } catch (e: any) {
      onError(e?.message ?? String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card title="Create a new schedule">
      <div className="space-y-4">
        <div>
          <label htmlFor="sched-name" className="block text-[11px] uppercase tracking-wider text-cream-300/60 mb-1">Name</label>
          <input
            id="sched-name"
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Weekly project digest"
            className="w-full bg-ink-950 border border-ink-800 focus:border-violet-500/60 rounded-md px-3 py-2 text-sm focus:outline-none placeholder:text-cream-300/40"
          />
        </div>

        <div>
          <label htmlFor="sched-template" className="block text-[11px] uppercase tracking-wider text-cream-300/60 mb-1">Template to run</label>
          <select
            id="sched-template"
            value={templateId}
            onChange={e => { setTemplateId(e.target.value); setInputs({}); }}
            className="w-full bg-ink-950 border border-ink-800 focus:border-violet-500/60 rounded-md px-3 py-2 text-sm focus:outline-none cursor-pointer"
          >
            <option value="">Pick a template...</option>
            {templates.map(t => (
              <option key={t.id} value={t.id}>{t.title} ({t.role})</option>
            ))}
          </select>
          {tpl && <div className="text-[11px] text-cream-300/60 mt-1">{tpl.description}</div>}
        </div>

        {tpl && tpl.inputs.length > 0 && (
          <div className="space-y-2 bg-ink-950 border border-ink-800 rounded-md p-3">
            <div className="text-[10px] uppercase tracking-wider text-cream-300/50">Template inputs</div>
            {tpl.inputs.map(input => (
              <div key={input.name}>
                <label htmlFor={`input-${input.name}`} className="block text-[11px] text-cream-200 mb-1">
                  {input.label}{input.required && <span className="text-coral-400 ml-1">*</span>}
                </label>
                {input.type === "boolean" ? (
                  <select
                    id={`input-${input.name}`}
                    value={inputs[input.name] ?? String(input.default ?? "false")}
                    onChange={e => setInputs(p => ({ ...p, [input.name]: e.target.value }))}
                    className="w-full bg-ink-900 border border-ink-800 focus:border-violet-500/60 rounded px-2 py-1 text-xs"
                  >
                    <option value="false">No</option>
                    <option value="true">Yes</option>
                  </select>
                ) : (
                  <input
                    id={`input-${input.name}`}
                    type={input.type === "number" ? "number" : "text"}
                    value={inputs[input.name] ?? (input.default !== undefined ? String(input.default) : "")}
                    onChange={e => setInputs(p => ({ ...p, [input.name]: e.target.value }))}
                    placeholder={(input as any).placeholder ?? ""}
                    className="w-full bg-ink-900 border border-ink-800 focus:border-violet-500/60 rounded px-2 py-1 text-xs"
                  />
                )}
              </div>
            ))}
          </div>
        )}

        <div>
          <label className="block text-[11px] uppercase tracking-wider text-cream-300/60 mb-1">Days to run</label>
          <div className="flex flex-wrap gap-1">
            {DAY_LABELS.map((d, i) => (
              <button
                key={d}
                type="button"
                onClick={() => toggleDay(i)}
                className={`text-xs px-3 py-1.5 rounded border ${days.includes(i) ? "bg-violet-500/15 border-violet-500/40 text-violet-200" : "bg-ink-950 border-ink-800 text-cream-300 hover:border-ink-700"}`}
              >
                {d}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 mt-1.5">
            <button type="button" onClick={() => setDays([1, 2, 3, 4, 5])} className="text-[10px] text-violet-400 hover:text-violet-500">Weekdays</button>
            <span className="text-cream-300/30">·</span>
            <button type="button" onClick={() => setDays([0, 6])} className="text-[10px] text-violet-400 hover:text-violet-500">Weekends</button>
            <span className="text-cream-300/30">·</span>
            <button type="button" onClick={() => setDays([0, 1, 2, 3, 4, 5, 6])} className="text-[10px] text-violet-400 hover:text-violet-500">Every day</button>
          </div>
        </div>

        <div>
          <label className="block text-[11px] uppercase tracking-wider text-cream-300/60 mb-1">Time of day (server local)</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={hour}
              onChange={e => setHour(Math.max(0, Math.min(23, Number(e.target.value))))}
              min={0}
              max={23}
              className="w-16 bg-ink-950 border border-ink-800 focus:border-violet-500/60 rounded px-2 py-1.5 text-sm text-center"
              aria-label="Hour (0-23)"
            />
            <span className="text-cream-300">:</span>
            <input
              type="number"
              value={minute}
              onChange={e => setMinute(Math.max(0, Math.min(59, Number(e.target.value))))}
              min={0}
              max={59}
              className="w-16 bg-ink-950 border border-ink-800 focus:border-violet-500/60 rounded px-2 py-1.5 text-sm text-center"
              aria-label="Minute (0-59)"
            />
            <span className="text-[11px] text-cream-300/50 ml-2">24-hour clock</span>
          </div>
        </div>

        <div>
          <label htmlFor="sched-email" className="block text-[11px] uppercase tracking-wider text-cream-300/60 mb-1">Email the result to (optional)</label>
          <input
            id="sched-email"
            type="email"
            value={deliverEmail}
            onChange={e => setDeliverEmail(e.target.value)}
            placeholder="you@example.com — leave blank to keep results on the Tasks page"
            className="w-full bg-ink-950 border border-ink-800 focus:border-violet-500/60 rounded-md px-3 py-2 text-sm focus:outline-none placeholder:text-cream-300/40"
          />
          <p className="text-[11px] text-cream-300/50 mt-1">When set, the finished result is emailed to this address the moment the job completes (needs the email bridge configured).</p>
        </div>

        <div className="flex items-center gap-3 pt-2 border-t border-ink-800">
          <Button onClick={submit} disabled={submitting || !name.trim() || !templateId || days.length === 0}>
            {submitting ? "Creating..." : "Create schedule"}
          </Button>
          {tpl && days.length > 0 && (
            <span className="text-[11px] text-cream-300/60">
              Will run <span className="text-cream-100">{tpl.title}</span> at <span className="text-cream-100">{hour.toString().padStart(2, "0")}:{minute.toString().padStart(2, "0")}</span> on selected days.
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}
