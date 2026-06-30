import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, Calendar, Plug, Check, Loader2 } from "lucide-react";
import { Card, Button, showToast } from "../components/Card";
import { api, type Preset, type PresetApplyResult } from "../lib/api";

// Role Presets — one-click "hire a worker" bundles. Picking one activates the
// persona, ensures its templates, optionally stands up a morning schedule
// (emailed to you), and points you at the integrations that role uses.
export function Presets() {
  const nav = useNavigate();
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);   // preset being configured
  const [email, setEmail] = useState("admin@rubiem.com");
  const [withSchedules, setWithSchedules] = useState(true);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<PresetApplyResult | null>(null);

  useEffect(() => {
    api.listPresets()
      .then(r => setPresets(r.presets))
      .catch(e => setLoadErr(e?.message ?? String(e)))
      .finally(() => setLoading(false));
  }, []);

  async function apply(p: Preset) {
    setApplying(true);
    setResult(null);
    try {
      const r = await api.applyPreset(p.id, {
        deliverEmail: email.trim() || undefined,
        createSchedules: withSchedules,
      });
      setResult(r);
      showToast(`Hired ${r.persona.name} — ${r.persona.role}`, "success");
    } catch (e: any) {
      showToast(`Apply failed: ${e.message}`, "error");
    } finally {
      setApplying(false);
    }
  }

  const selected = presets.find(p => p.id === active) ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-cream-50 flex items-center gap-2">
          <Sparkles size={22} className="text-violet-400" /> Hire a worker
        </h1>
        <p className="text-sm text-cream-300/70 mt-1 max-w-2xl">
          One-click role presets. Each one activates the right persona, sets up its starter
          templates, and can stand up a recurring briefing emailed to you — so a new worker is
          productive in a single click.
        </p>
      </div>

      {loading ? (
        <div className="text-cream-300/60 text-sm flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Loading presets…</div>
      ) : loadErr ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-sm text-cream-200">
          <p className="font-medium text-red-400 mb-1">Couldn't load presets</p>
          <p className="text-cream-300/70">{loadErr}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {presets.map(p => {
            const isActive = active === p.id;
            return (
              <button
                key={p.id}
                onClick={() => { setActive(p.id); setResult(null); }}
                className={`text-left rounded-xl border p-4 transition-colors ${isActive ? "border-violet-500/60 bg-violet-500/5" : "border-ink-800 bg-ink-900 hover:border-ink-700"}`}
              >
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-cream-50">{p.name}</div>
                  {isActive && <Check size={16} className="text-violet-400" />}
                </div>
                <div className="text-sm text-cream-300/70 mt-1">{p.tagline}</div>
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {p.recommendedSkills.slice(0, 3).map(s => (
                    <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-ink-800 text-cream-300/70 font-mono">{s}</span>
                  ))}
                  {p.schedules?.length ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-leaf-500/10 text-leaf-400 font-mono flex items-center gap-1"><Calendar size={10} /> {p.schedules.length} schedule</span>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <Card title={`Set up: ${selected.name}`}>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-cream-300/70 uppercase tracking-wider">Email briefings to</label>
              <input
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com (optional)"
                className="mt-1 w-full bg-ink-950 border border-ink-700 rounded-md px-3 py-2 text-sm text-cream-50 focus:outline-none focus:border-violet-500/50"
              />
              <p className="text-[11px] text-cream-300/50 mt-1">
                {selected.schedules?.length
                  ? "This preset includes a recurring briefing. Add an address to have it emailed; leave blank to keep results on the Tasks page."
                  : "This preset has no schedule — the address is unused."}
              </p>
            </div>

            {!!selected.schedules?.length && (
              <label className="flex items-center gap-2 text-sm text-cream-200">
                <input type="checkbox" checked={withSchedules} onChange={e => setWithSchedules(e.target.checked)} />
                Create {selected.schedules.length} schedule{selected.schedules.length === 1 ? "" : "s"}: {selected.schedules.map(s => s.name).join(", ")}
              </label>
            )}

            <div>
              <div className="text-xs text-cream-300/70 uppercase tracking-wider mb-1.5">Recommended integrations</div>
              <div className="flex flex-wrap gap-2">
                {selected.recommendedIntegrations.map(i => (
                  <span key={i} className="text-xs px-2 py-1 rounded-full bg-ink-800 text-cream-200 flex items-center gap-1.5"><Plug size={11} /> {i}</span>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3 pt-1">
              <Button onClick={() => apply(selected)} disabled={applying}>
                {applying ? <span className="flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Hiring…</span> : `Hire ${selected.name}`}
              </Button>
              <Button variant="ghost" onClick={() => setActive(null)}>Cancel</Button>
            </div>

            {result && (
              <div className="mt-2 rounded-lg border border-leaf-500/30 bg-leaf-500/5 p-3 text-sm space-y-1.5">
                <div className="text-leaf-400 font-medium flex items-center gap-1.5"><Check size={14} /> {result.persona.name} ({result.persona.role}) is now active.</div>
                <div className="text-cream-300/80">Ensured {result.templatesEnsured} starter template{result.templatesEnsured === 1 ? "" : "s"}.</div>
                {result.schedulesCreated.length > 0 && (
                  <div className="text-cream-300/80">
                    Scheduled: {result.schedulesCreated.map(s => `${s.name}${s.emailTo ? ` → ${s.emailTo}` : ""}`).join(", ")}.
                  </div>
                )}
                {result.missingIntegrations.length > 0 && (
                  <div className="text-cream-300/80">
                    Connect next: {result.missingIntegrations.join(", ")}.{" "}
                    <button onClick={() => nav("/integrations")} className="text-violet-400 hover:underline">Open Integrations →</button>
                  </div>
                )}
                <div className="flex gap-3 pt-1">
                  <button onClick={() => nav("/chat")} className="text-violet-400 hover:underline">Start a task →</button>
                  {result.schedulesCreated.length > 0 && <button onClick={() => nav("/schedules")} className="text-violet-400 hover:underline">View schedules →</button>}
                </div>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
