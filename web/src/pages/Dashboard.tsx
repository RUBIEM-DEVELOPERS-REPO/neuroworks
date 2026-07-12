import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, Template } from "../lib/api";
import { Card, RoleIcon } from "../components/Card";
import { TaskRunner } from "../components/TaskRunner";
import { AgentVisualizer } from "../components/AgentVisualizer";
import { DynamicWeightText } from "../components/DynamicWeightText";
import { TextMorph } from "../components/TextMorph";
import { MagneticRow } from "../components/MagneticRow";
import { lazy, Suspense } from "react";

// three.js is ~600KB — the globe loads as its own chunk only when the
// Workforce card actually renders, so the dashboard's initial JS stays flat.
const WorkforceGlobe = lazy(() => import("../components/WorkforceGlobe").then(m => ({ default: m.WorkforceGlobe })));
import { t, loadSavedLanguage } from "../lib/i18n";
import { MapPin, Building2, Globe, BookOpen, Plug, Zap, ShieldCheck, Server, Flag } from "lucide-react";
import type { SectorInfo, KnowledgePack } from "../lib/api";

export function Dashboard() {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [recent, setRecent] = useState<any[]>([]);
  const [active, setActive] = useState<Template | null>(null);
  const [prefill, setPrefill] = useState<Record<string, any> | undefined>(undefined);
  const [nl, setNl] = useState("");
  const [intentBusy, setIntentBusy] = useState(false);
  const [err, setErr] = useState("");
  const [persona, setPersona] = useState<any>(null);
  const [onboarding, setOnboarding] = useState<{ sector?: string; customSectorName?: string; orgName?: string; completed?: boolean }>({});
  const [sectorContext, setSectorContext] = useState("");
  const [sectorLabel, setSectorLabel] = useState("");
  const [activeSectorInfo, setActiveSectorInfo] = useState<SectorInfo | null>(null);
  const [allDepartments, setAllDepartments] = useState<any[]>([]);
  const [knowledgePack, setKnowledgePack] = useState<KnowledgePack | null>(null);
  const [orgStatus, setOrgStatus] = useState<{
    activePolicyCount: number; activePolicies: string[];
    connectedSystemCount: number; connectedSystems: string[];
    computeMode: "local-only" | "cloud-assisted"; dataResidency: "local" | "mixed";
  } | null>(null);
  // Full roster + the live clawbot fleet so the dashboard answers "who can I
  // hire right now, and who's currently working?" The roster comes from
  // /api/personas; the fleet comes from /api/peers (self + reachable peers).
  const [personas, setPersonas] = useState<any[]>([]);
  const [fleet, setFleet] = useState<{ self: any; peers: any[] } | null>(null);
  // External (CLI / process-per-task) agents like Hermes — surfaced in the
  // workforce card alongside clawbots so the operator sees a single roster.
  const [externalAgents, setExternalAgents] = useState<any[]>([]);
  const [activating, setActivating] = useState<string | null>(null);
  // Running jobs — the Workforce card derives live sub-agents (in-flight plan
  // steps; parallel waves = several sub-agents) from these.
  const [running, setRunning] = useState<any[]>([]);

  async function load() {
    try {
      const [t, j, p, peers, ext, ob, depts, packs, st] = await Promise.all([
        api.listTemplates(),
        api.listJobs().catch(() => ({ jobs: [] as any[] })),
        api.listPersonas().catch(() => ({ active: null, personas: [] } as any)),
        api.peers().catch(() => null),
        api.externalAgents().catch(() => ({ agents: [] as any[] })),
        api.getOnboarding().catch(() => ({ state: {} } as any)),
        api.listDepartments().catch(() => ({ departments: [] as any[] })),
        api.listKnowledgePacks().catch(() => ({ packs: [] as KnowledgePack[] })),
        api.status().catch(() => null),
      ]);
      setTemplates(t.templates);
      setRecent(j.jobs.slice(0, 4));
      setRunning((j.jobs ?? []).filter((x: any) => x.status === "running" || x.status === "pending"));
      setPersona(p.active);
      setPersonas(Array.isArray(p.personas) ? p.personas : []);
      if (peers) setFleet(peers);
      setExternalAgents(ext.agents ?? []);
      setAllDepartments(depts.departments ?? []);
      if (st?.orgStatus) setOrgStatus(st.orgStatus);
      if (ob.state) {
        setOnboarding(ob.state);
        loadSavedLanguage();
        if (ob.state.sector) {
          api.getOnboardingContext(ob.state.sector).then(ctx => setSectorContext(ctx.context)).catch(() => {});
          // Sector "name" in the label pill: for the free-text "custom"
          // sector this is the org's own sector name, not the catalog
          // entry's generic "Custom" placeholder.
          const info = (ob.sectors ?? []).find((s: any) => s.id === ob.state.sector) ?? null;
          setActiveSectorInfo(info);
          const label = ob.state.sector === "custom" ? (ob.state.customSectorName || "Custom sector") : (info?.name ?? ob.state.sector);
          setSectorLabel(label);
          setKnowledgePack((packs.packs ?? []).find(pk => pk.sectorId === ob.state.sector && pk.kind !== "dataset") ?? null);
        }
      }
    } catch (e: any) { setErr(e.message); }
  }
  useEffect(() => { load(); const i = setInterval(load, 6000); return () => clearInterval(i); }, []);

  const featuredDepartments = useMemo(() => {
    const ids = activeSectorInfo?.suggestedDepartments ?? [];
    if (ids.length === 0) return [];
    return ids.map(id => allDepartments.find(d => d.id === id)).filter(Boolean);
  }, [allDepartments, activeSectorInfo]);

  async function hire(personaId: string) {
    setActivating(personaId);
    try { await api.activatePersona(personaId); await load(); }
    catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setActivating(null); }
  }

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
        {onboarding?.orgName ? (
          <div className="text-xs uppercase tracking-[0.3em] text-cream-300/50">{onboarding.orgName}</div>
        ) : (
          <div className="text-xs uppercase tracking-[0.3em] text-cream-300/50">{t("dashboard.welcome")}</div>
        )}
        <h1 className="mt-2 flex justify-center">
          <DynamicWeightText text={t("app.title")} fontSize={60} />
        </h1>
        <p className="text-cream-300/70 mt-2 text-sm">
          {sectorLabel && <span className="inline-flex items-center gap-1.5 text-violet-400 mr-1.5"><Building2 size={14} />{sectorLabel}</span>}
          {t("app.subtitle")}
        </p>
      </section>

      {sectorContext && (
        <section className="bg-gradient-to-r from-leaf-500/5 via-leaf-500/10 to-transparent border border-leaf-500/20 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-leaf-500/10 text-leaf-400 shrink-0 mt-0.5"><MapPin size={18} /></div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium text-cream-100">
                <Globe size={14} className="text-leaf-400" />
                {t("dashboard.zimbabweContext")}
              </div>
              <p className="text-xs text-cream-300/80 mt-1.5 leading-relaxed">{sectorContext}</p>
            </div>
          </div>
        </section>
      )}

      {orgStatus && (
        <section>
          <div className="flex items-baseline justify-between mb-3 px-1">
            <div className="text-xs uppercase tracking-[0.25em] text-cream-300/60">
              <TextMorph words={["Mission Control", "Org at a Glance", "Live Status"]} />
            </div>
            <Link to="/quality" className="text-xs text-cream-300 hover:text-cream-50 inline-flex items-center gap-1"><Flag size={11} /> Flag an output →</Link>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Link to="/governance" className="bg-ink-900 border border-ink-800 hover:border-violet-500/40 rounded-xl p-4 transition-colors">
              <div className="flex items-center gap-2 text-xs text-cream-300/60 mb-1.5"><ShieldCheck size={13} /> Policy documents</div>
              <div className="font-display text-2xl text-cream-50">{orgStatus.activePolicyCount}</div>
              <div className="text-[11px] text-cream-300/50 mt-1 truncate">{orgStatus.activePolicies.slice(0, 2).join(", ") || "None active"}</div>
            </Link>
            <Link to="/connectors" className="bg-ink-900 border border-ink-800 hover:border-violet-500/40 rounded-xl p-4 transition-colors">
              <div className="flex items-center gap-2 text-xs text-cream-300/60 mb-1.5"><Plug size={13} /> Connected systems</div>
              <div className="font-display text-2xl text-cream-50">{orgStatus.connectedSystemCount}</div>
              <div className="text-[11px] text-cream-300/50 mt-1 truncate">{orgStatus.connectedSystems.slice(0, 2).join(", ") || "None connected"}</div>
            </Link>
            <Link to="/models" className="bg-ink-900 border border-ink-800 hover:border-violet-500/40 rounded-xl p-4 transition-colors">
              <div className="flex items-center gap-2 text-xs text-cream-300/60 mb-1.5"><Server size={13} /> Compute mode</div>
              <div className="font-display text-lg text-cream-50 capitalize">{orgStatus.computeMode.replace("-", " ")}</div>
              <div className="text-[11px] text-cream-300/50 mt-1">{orgStatus.computeMode === "local-only" ? "All inference on this machine" : "Some inference may use a cloud LLM"}</div>
            </Link>
            <div className="bg-ink-900 border border-ink-800 rounded-xl p-4">
              <div className="flex items-center gap-2 text-xs text-cream-300/60 mb-1.5"><Globe size={13} /> Data residency</div>
              <div className={`font-display text-lg capitalize ${orgStatus.dataResidency === "local" ? "text-leaf-400" : "text-amber-400"}`}>{orgStatus.dataResidency}</div>
              <div className="text-[11px] text-cream-300/50 mt-1">{orgStatus.dataResidency === "local" ? "Task content stays on this machine" : "Confirm your DPA data-sharing agreement"}</div>
            </div>
          </div>
        </section>
      )}

      {activeSectorInfo && (featuredDepartments.length > 0 || knowledgePack || (activeSectorInfo.suggestedIntegrations?.length ?? 0) > 0) && (
        <section>
          <div className="flex items-baseline justify-between mb-3 px-1">
            <div className="text-xs uppercase tracking-[0.25em] text-cream-300/60">Featured for {sectorLabel}</div>
            <Link to="/departments" className="text-xs text-cream-300 hover:text-cream-50">Department marketplace →</Link>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {featuredDepartments.length > 0 && (
              <Link to="/departments" className="lg:col-span-2 bg-ink-900 border border-ink-800 hover:border-violet-500/40 rounded-xl p-4 transition-colors">
                <div className="flex items-center gap-2 text-sm font-medium text-cream-100 mb-2">
                  <Zap size={14} className="text-violet-400" /> Recommended departments
                </div>
                <div className="flex flex-wrap gap-2">
                  {featuredDepartments.map((d: any) => (
                    <span key={d.id} className="text-xs bg-ink-800 border border-ink-700 rounded-full px-3 py-1 text-cream-200">{d.name}</span>
                  ))}
                </div>
              </Link>
            )}
            <div className="bg-ink-900 border border-ink-800 rounded-xl p-4 space-y-3">
              <Link to="/knowledge-packs" className="flex items-center gap-2 text-sm text-cream-100 hover:text-violet-300 transition-colors">
                <BookOpen size={14} className={knowledgePack?.installed ? "text-leaf-400" : "text-cream-300/50"} />
                Knowledge pack
                <span className={`ml-auto text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border ${knowledgePack?.installed ? "border-leaf-500/40 text-leaf-400" : "border-ink-700 text-cream-300/50"}`}>
                  {knowledgePack?.installed ? "active" : "not installed"}
                </span>
              </Link>
              {(activeSectorInfo.suggestedIntegrations?.length ?? 0) > 0 && (
                <Link to="/integrations" className="flex items-start gap-2 text-xs text-cream-300/70 hover:text-cream-100 transition-colors">
                  <Plug size={13} className="mt-0.5 shrink-0" />
                  <span>Suggested connections: {activeSectorInfo.suggestedIntegrations!.join(", ")}</span>
                </Link>
              )}
            </div>
          </div>
        </section>
      )}

      <section>
        <div className="flex items-baseline justify-between mb-3 px-1">
          <div className="text-xs uppercase tracking-[0.25em] text-cream-300/60">
            {t("dashboard.quickStart")} — {persona ? <>{t("dashboard.quickStart.persona")} <span className="text-violet-400">{persona.name}</span></> : "suggested tasks"}
          </div>
          <Link to="/templates" className="text-xs text-cream-300 hover:text-cream-50">View all templates →</Link>
        </div>
        {quickStart.length ? (
          <MagneticRow gap={12}>
            {quickStart.map((t: Template, i) => (
              <button key={t.id} onClick={() => setActive(t)} className={`w-full text-left bg-ink-900 hover:bg-ink-850 border border-ink-800 hover:border-violet-500/40 rounded-xl p-4 transition-colors nw-fade-up nw-delay-${Math.min(7, i + 1)}`}>
                <RoleIcon role={t.role} className="mb-3" />
                <div className="text-xs text-cream-300/60 uppercase tracking-wider">{t.role}</div>
                <div className="font-display text-lg text-cream-50 mt-0.5 leading-tight">{t.title}</div>
                <div className="text-xs text-cream-300/70 mt-2 line-clamp-2">{t.description}</div>
              </button>
            ))}
          </MagneticRow>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {Array(4).fill(null).map((_, i) => (
              <div key={i} className="bg-ink-900 border border-ink-800 rounded-xl p-4 h-32 skeleton" />
            ))}
          </div>
        )}
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

      <section>
        <div className="flex items-baseline justify-between mb-3 px-1">
          <div className="text-xs uppercase tracking-[0.25em] text-cream-300/60">
            Hire an employee — {persona ? <>currently working as <span className="text-violet-400">{persona.name}</span></> : <>no employee active</>}
          </div>
          <Link to="/personas" className="text-xs text-cream-300 hover:text-cream-50">Manage employees →</Link>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {personas.length === 0 ? (
            <div className="text-sm text-cream-300/60 col-span-3">No employees on the roster yet. Visit Personas to add one.</div>
          ) : personas.slice(0, 6).map((p: any) => {
            const isActive = persona?.id === p.id;
            const isHiring = activating === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => hire(p.id)}
                disabled={isHiring || isActive}
                className={`text-left rounded-xl p-4 transition-colors border ${
                  isActive
                    ? "bg-violet-500/10 border-violet-500/50"
                    : "bg-ink-900 hover:bg-ink-850 border-ink-800 hover:border-violet-500/40"
                } disabled:cursor-not-allowed`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="font-display text-lg text-cream-50 leading-tight">{p.name}</div>
                  {isActive
                    ? <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 shrink-0">On the clock</span>
                    : isHiring
                      ? <span className="text-[10px] text-violet-400">hiring…</span>
                      : <span className="text-[10px] text-cream-300/40 group-hover:text-violet-300">Hire</span>}
                </div>
                <div className="text-xs text-cream-300/60 uppercase tracking-wider">{p.role}</div>
                <div className="text-xs text-cream-300/70 mt-2 line-clamp-2">{p.description}</div>
              </button>
            );
          })}
        </div>
        {personas.length > 6 && (
          <div className="text-[11px] text-cream-300/50 mt-2 px-1">+{personas.length - 6} more on the roster · <Link to="/personas" className="text-violet-400 hover:text-violet-500">see all</Link></div>
        )}
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
        <Card title="Workforce">
          <ClawbotFleet fleet={fleet} externalAgents={externalAgents} running={running} templatesCount={templates?.length} tasksToday={recent.length} personasCount={personas.length} />
        </Card>
      </section>

      {err && <div className="text-coral-400 text-sm">Error: {err}</div>}
      {active && <TaskRunner template={active} prefill={prefill} onClose={() => { setActive(null); setPrefill(undefined); load(); }} />}
    </div>
  );
}

// Live snapshot of the running clawbot fleet. Each row is one clawbot — self
// or peer — with current inflight count, role, and ready state. Replaces the
// previous hardcoded "1 (clawbot)" line which was a lie the moment a worker
// peer came online.
function ClawbotFleet({ fleet, externalAgents, running, templatesCount, tasksToday, personasCount }: {
  fleet: { self: any; peers: any[] } | null;
  externalAgents: any[];
  running: any[];
  templatesCount?: number;
  tasksToday: number;
  personasCount: number;
}) {
  if (!fleet) return <div className="text-sm text-cream-300/60">Loading fleet…</div>;

  // Derive live sub-agents from running jobs: each in-flight plan step is a
  // spawned sub-agent; a wave with >1 step is several working in parallel.
  const subAgents: { job: string; label: string; parallel: boolean }[] = [];
  for (const job of running ?? []) {
    const r = job.result ?? {};
    const steps: any[] = r.plan?.steps ?? [];
    const runs: any[] = r.runs ?? [];
    const waves: number[][] = (r.plan?.waves && r.plan.waves.length > 0) ? r.plan.waves : steps.map((_: any, i: number) => [i]);
    for (const ids of waves) {
      const parallel = ids.length > 1;
      for (const i of ids) {
        const run = runs[i];
        const inflight = run?.startedAt && !run?.ok && !run?.error;
        if (inflight) subAgents.push({ job: job.title ?? job.kind ?? "task", label: steps[i]?.label ?? steps[i]?.tool ?? "step", parallel });
      }
    }
  }
  const bots: { name: string; role: string; url?: string; ok: boolean; ready: boolean; inflight: number; model?: string; isSelf: boolean }[] = [];
  if (fleet.self) {
    bots.push({
      name: fleet.self.name ?? "primary",
      role: fleet.self.role ?? "primary",
      url: fleet.self.url,
      ok: true,
      ready: !!fleet.self.ready,
      inflight: Number(fleet.self.inflightJobs ?? 0),
      model: fleet.self.model,
      isSelf: true,
    });
  }
  for (const p of fleet.peers ?? []) {
    bots.push({
      name: p.name ?? p.url ?? "peer",
      role: p.role ?? "peer",
      url: p.url,
      ok: !!p.ok,
      ready: !!p.ready,
      inflight: Number(p.inflightJobs ?? 0),
      model: p.model,
      isSelf: false,
    });
  }
  const activeCount = bots.filter(b => b.ok && b.ready).length;
  // The fleet has no real geo data (every neuro runs on the operator's own
  // machines) — markers are REPRESENTATIVE: one distinct Zimbabwe city per
  // neuro, primary pinned to Harare, so each worker reads as a live dot on
  // the map rather than all stacking invisibly on one point.
  const ZIM_CITIES: { lat: number; lng: number }[] = [
    { lat: -17.83, lng: 31.05 }, // Harare — primary
    { lat: -20.16, lng: 28.58 }, // Bulawayo
    { lat: -18.97, lng: 32.67 }, // Mutare
    { lat: -19.45, lng: 29.82 }, // Gweru
    { lat: -20.07, lng: 30.83 }, // Masvingo
    { lat: -18.93, lng: 29.81 }, // Kwekwe
    { lat: -18.33, lng: 29.91 }, // Kadoma
    { lat: -17.37, lng: 30.19 }, // Chinhoyi
  ];
  const markers = bots.filter(b => b.ok).map((b, i) => ({ ...ZIM_CITIES[i % ZIM_CITIES.length], label: b.name }));
  return (
    <div className="space-y-3 text-sm">
      <Suspense fallback={<div className="h-[220px] grid place-items-center text-xs text-cream-300/40">loading globe…</div>}>
        <WorkforceGlobe markers={markers} height={220} />
      </Suspense>
      <div className="space-y-1.5">
        {bots.length === 0 && <div className="text-cream-300/60">No neuros reachable.</div>}
        {bots.map((b, i) => (
          <div key={i} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md bg-ink-950 border border-ink-800">
            <div className="flex items-center gap-2 min-w-0">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${b.ok && b.ready ? (b.inflight > 0 ? "bg-flame-400 animate-pulse" : "bg-leaf-500") : "bg-coral-500"}`} />
              <div className="min-w-0">
                <div className="text-xs text-cream-100 truncate">
                  {b.name}
                  {b.isSelf && <span className="text-[10px] text-cream-300/40 ml-1">· self</span>}
                </div>
                <div className="text-[10px] text-cream-300/50 truncate">{b.role}{b.model ? ` · ${b.model}` : ""}</div>
              </div>
            </div>
            <span className={`text-[10px] font-mono shrink-0 ${b.inflight > 0 ? "text-flame-400" : "text-cream-300/60"}`}>{b.inflight > 0 ? `${b.inflight} working` : "idle"}</span>
          </div>
        ))}
        {externalAgents.length > 0 && externalAgents.map((a, i) => {
          const r = a.recentJobs ?? { last1h: 0, last24h: 0, total: 0 };
          const live = r.last1h > 0;
          return (
            <div key={`ext-${i}`} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md bg-ink-950 border border-ink-800">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${a.installed ? (live ? "bg-flame-400 animate-pulse" : "bg-leaf-500") : "bg-coral-500"}`} />
                <div className="min-w-0">
                  <div className="text-xs text-cream-100 truncate">
                    {a.name}
                    <span className="text-[10px] text-cream-300/40 ml-1">· {a.kind}</span>
                  </div>
                  <div className="text-[10px] text-cream-300/50 truncate">
                    {a.installed ? `external · ${r.total} run${r.total === 1 ? "" : "s"} tracked` : "not installed"}
                  </div>
                </div>
              </div>
              <span className={`text-[10px] font-mono shrink-0 ${live ? "text-flame-400" : "text-cream-300/60"}`}>{live ? `${r.last1h} in 1h` : "idle"}</span>
            </div>
          );
        })}
      </div>

      {/* Live sub-agents spawned by running tasks. */}
      {subAgents.length > 0 && (
        <div className="border-t border-ink-800 pt-2.5">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-violet-300/70 mb-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse" /> Sub-agents · {subAgents.length} live
          </div>
          <div className="space-y-1">
            {subAgents.slice(0, 6).map((s, i) => (
              <div key={i} className="flex items-center gap-2 px-2 py-1 rounded-md bg-violet-500/5 border border-violet-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse shrink-0" />
                <span className="text-xs text-cream-200 truncate flex-1">
                  {s.label}
                  {s.parallel && <span className="text-[10px] text-violet-400/70 ml-1">· parallel</span>}
                </span>
                <span className="text-[10px] text-cream-300/40 truncate max-w-[45%]" title={s.job}>{s.job}</span>
              </div>
            ))}
            {subAgents.length > 6 && <div className="text-[10px] text-cream-300/40 px-2">+{subAgents.length - 6} more</div>}
          </div>
        </div>
      )}

      <div className="border-t border-ink-800 pt-2.5 space-y-2 text-xs">
        <div className="flex justify-between"><span className="text-cream-300/70">Neuros online</span><span className="text-cream-100 font-mono">{activeCount}/{bots.length}</span></div>
        {subAgents.length > 0 && <div className="flex justify-between"><span className="text-cream-300/70">Sub-agents active</span><span className="text-violet-300 font-mono">{subAgents.length}</span></div>}
        {externalAgents.length > 0 && <div className="flex justify-between"><span className="text-cream-300/70">External agents</span><span className="text-cream-100 font-mono">{externalAgents.filter(a => a.installed).length}/{externalAgents.length}</span></div>}
        <div className="flex justify-between"><span className="text-cream-300/70">Employees</span><span className="text-cream-100 font-mono">{personasCount}</span></div>
        <div className="flex justify-between"><span className="text-cream-300/70">Templates</span><span className="text-cream-100 font-mono">{templatesCount ?? "—"}</span></div>
        <div className="flex justify-between"><span className="text-cream-300/70">Tasks today</span><span className="text-cream-100 font-mono">{tasksToday}</span></div>
      </div>
    </div>
  );
}
