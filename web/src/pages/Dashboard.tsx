import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, Template } from "../lib/api";
import { Card, RoleIcon } from "../components/Card";
import { TaskRunner } from "../components/TaskRunner";
import { AgentVisualizer } from "../components/AgentVisualizer";

export function Dashboard() {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [recent, setRecent] = useState<any[]>([]);
  const [active, setActive] = useState<Template | null>(null);
  const [prefill, setPrefill] = useState<Record<string, any> | undefined>(undefined);
  const [nl, setNl] = useState("");
  const [intentBusy, setIntentBusy] = useState(false);
  const [err, setErr] = useState("");
  const [persona, setPersona] = useState<any>(null);

  async function load() {
    try {
      const [t, j, p] = await Promise.all([
        api.listTemplates(),
        api.listJobs().catch(() => ({ jobs: [] as any[] })),
        api.listPersonas().catch(() => ({ active: null } as any)),
      ]);
      setTemplates(t.templates);
      setRecent(j.jobs.slice(0, 4));
      setPersona(p.active);
    } catch (e: any) { setErr(e.message); }
  }
  useEffect(() => { load(); const i = setInterval(load, 6000); return () => clearInterval(i); }, []);

  // When a persona is active, prioritise its starter templates (id prefix
  // `custom-<personaId>-`) at the top of Quick Start so the dashboard reflects
  // the role's day-to-day work the moment a JD is uploaded.
  const quickStart = useMemo(() => {
    const all = templates ?? [];
    if (persona?.id) {
      const personaPrefix = `custom-${persona.id}-`;
      const personaT = all.filter(t => t.id.startsWith(personaPrefix));
      const others = all.filter(t => !t.id.startsWith(personaPrefix));
      return [...personaT, ...others].slice(0, 4);
    }
    return all.slice(0, 4);
  }, [templates, persona?.id]);

  async function submitNL(e: React.FormEvent) {
    e.preventDefault();
    if (!nl.trim() || !templates) return;
    setIntentBusy(true); setErr("");
    try {
      const intent = await api.intent(nl);
      const t = templates.find(x => x.id === intent.templateId);
      if (!t) { setErr("Couldn't match this to any template — pick one above or open Templates."); return; }
      setPrefill(intent.inputs ?? {});
      setActive(t);
      setNl("");
    } catch (e: any) { setErr(e.message); }
    finally { setIntentBusy(false); }
  }

  return (
    <div className="space-y-9">
      <section className="text-center pt-10 pb-6">
        <div className="text-xs uppercase tracking-[0.3em] text-cream-300/50">Welcome to</div>
        <h1 className="font-display text-6xl text-cream-50 mt-2">NeuroWorks</h1>
        <p className="text-cream-300/70 mt-2 text-sm">The AI Workforce — describe what you want done, delegate, get results.</p>
      </section>

      <section>
        <div className="flex items-baseline justify-between mb-3 px-1">
          <div className="text-xs uppercase tracking-[0.25em] text-cream-300/60">
            Quick start — {persona ? <>tasks tuned for <span className="text-violet-400">{persona.name}</span></> : "suggested tasks"}
          </div>
          <Link to="/templates" className="text-xs text-cream-300 hover:text-cream-50">View all templates →</Link>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {(quickStart.length ? quickStart : Array(4).fill(null)).map((t: Template | null, i) => t ? (
            <button key={t.id} onClick={() => setActive(t)} className="text-left bg-ink-900 hover:bg-ink-850 border border-ink-800 hover:border-violet-500/40 rounded-xl p-4 transition-colors">
              <RoleIcon role={t.role} className="mb-3" />
              <div className="text-xs text-cream-300/60 uppercase tracking-wider">{t.role}</div>
              <div className="font-display text-lg text-cream-50 mt-0.5 leading-tight">{t.title}</div>
              <div className="text-xs text-cream-300/70 mt-2 line-clamp-2">{t.description}</div>
            </button>
          ) : (
            <div key={i} className="bg-ink-900 border border-ink-800 rounded-xl p-4 h-32 animate-pulse" />
          ))}
        </div>
      </section>

      <section>
        <form onSubmit={submitNL} className="bg-ink-900 border border-ink-800 rounded-xl p-1.5 flex items-center gap-2 focus-within:border-violet-500/60 transition-colors">
          <span className="px-3 text-violet-400 text-lg">+</span>
          <input
            value={nl}
            onChange={e => setNl(e.target.value)}
            placeholder="Describe your task — e.g., Summarize the scraper-hub project"
            className="flex-1 bg-transparent py-3 outline-none text-cream-100 placeholder:text-cream-300/40"
          />
          <button type="submit" disabled={intentBusy} className="bg-violet-500 hover:bg-violet-600 disabled:opacity-50 text-white text-sm font-medium px-5 py-2.5 rounded-md mr-1.5">{intentBusy ? "Routing…" : "Delegate →"}</button>
        </form>
        <div className="mt-2 text-xs text-cream-300/50 text-center">Your task gets routed to the closest template via Ollama; you can edit the parameters before final delegation.</div>
      </section>

      <section>
        <AgentVisualizer />
      </section>

      <section className="grid grid-cols-3 gap-4">
        <Card title="Recent activity" className="col-span-2">
          {recent.length === 0 && <div className="text-sm text-cream-300/60">No tasks yet. Pick one above to delegate something.</div>}
          {recent.length > 0 && (
            <ul className="divide-y divide-ink-800">
              {recent.map(j => (
                <li key={j.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${j.status === "succeeded" ? "bg-leaf-500" : j.status === "failed" ? "bg-coral-500" : j.status === "running" ? "bg-flame-400 animate-pulse" : "bg-cream-300/30"}`} />
                    <div className="min-w-0">
                      <div className="text-sm text-cream-100 truncate">{j.title ?? j.kind}</div>
                      <div className="text-[11px] text-cream-300/50 font-mono">{new Date(j.startedAt).toLocaleString()}</div>
                    </div>
                  </div>
                  <Link to={`/tasks?focus=${j.id}`} className="text-xs text-violet-400 hover:text-violet-500 shrink-0">view</Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="At a glance">
          <div className="space-y-2.5 text-sm">
            <div className="flex justify-between"><span className="text-cream-300/70">Templates</span><span className="text-cream-100 font-mono">{templates?.length ?? "—"}</span></div>
            <div className="flex justify-between"><span className="text-cream-300/70">Tasks today</span><span className="text-cream-100 font-mono">{recent.length}</span></div>
            <div className="flex justify-between"><span className="text-cream-300/70">Agents</span><span className="text-cream-100 font-mono">1 (clawbot)</span></div>
          </div>
        </Card>
      </section>

      {err && <div className="text-coral-400 text-sm">Error: {err}</div>}
      {active && <TaskRunner template={active} prefill={prefill} onClose={() => { setActive(null); setPrefill(undefined); load(); }} />}
    </div>
  );
}
