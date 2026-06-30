import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Terminal, Megaphone, TrendingUp, Users, CreditCard, Scale, Headphones, Settings,
  ArrowRight, Check, Loader2, Zap, Plug, Calendar, Clock, UserPlus,
  type LucideIcon,
} from "lucide-react";
import { api } from "../lib/api";
import { Card, Button, showToast } from "../components/Card";

const ICON_MAP: Record<string, LucideIcon> = {
  Terminal, Megaphone, TrendingUp, Users, CreditCard, Scale, Headphones, Settings,
};

type DeptInfo = {
  id: string; name: string; tagline: string; description: string;
  icon: string; color: string;
  agentCount: number; integrationCount: number;
  hasSchedule: boolean; workflowSteps: number;
};

export function Departments() {
  const [depts, setDepts] = useState<DeptInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  async function load() {
    try {
      const r = await api.listDepartments();
      setDepts(r.departments);
    } catch { }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function apply(id: string) {
    setApplying(id); setResult(null);
    try {
      const r = await api.applyDepartment(id);
      setResult(r);
      showToast(`Deployed ${r.departmentName} — ${r.personas.length} agent${r.personas.length === 1 ? "" : "s"} created`, "success");
    } catch (e: any) {
      showToast(`Failed: ${e.message}`, "error");
    } finally { setApplying(null); }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-cream-50 flex items-center gap-2">
          <Zap size={22} className="text-violet-400" /> Department Marketplace
        </h1>
        <p className="text-sm text-cream-300/70 mt-1 max-w-2xl">
          Pre-configured department bundles. Each one creates the agent(s), templates, and workflows for a complete team — ready to hire in one click.
        </p>
      </div>

      {loading ? (
        <div className="text-cream-300/60 text-sm flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Loading departments…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {depts.map(d => {
            const Icon = ICON_MAP[d.icon] ?? Settings;
            const colorMap: Record<string, string> = {
              violet: "border-violet-500/30 bg-violet-500/5 text-violet-300",
              coral: "border-coral-500/30 bg-coral-500/5 text-coral-300",
              green: "border-leaf-500/30 bg-leaf-500/5 text-leaf-300",
              blue: "border-blue-500/30 bg-blue-500/5 text-blue-300",
              amber: "border-amber-500/30 bg-amber-500/5 text-amber-300",
              purple: "border-purple-500/30 bg-purple-500/5 text-purple-300",
              teal: "border-teal-500/30 bg-teal-500/5 text-teal-300",
              slate: "border-slate-500/30 bg-slate-500/5 text-slate-300",
            };
            const colors = colorMap[d.color] ?? colorMap.slate;
            return (
              <div key={d.id} className={`bg-ink-900 border border-ink-800 hover:border-ink-700 rounded-xl p-5 transition-colors`}>
                <div className="flex items-start justify-between mb-3">
                  <div className={`p-2 rounded-lg border ${colors}`}>
                    <Icon size={20} />
                  </div>
                </div>
                <div className="font-display text-lg text-cream-50">{d.name}</div>
                <div className="text-xs text-cream-300/70 mt-1">{d.tagline}</div>
                <p className="text-xs text-cream-300/60 mt-2 leading-relaxed line-clamp-3">{d.description}</p>

                <div className="flex flex-wrap gap-2 mt-4 text-[10px] text-cream-300/60">
                  <span className="inline-flex items-center gap-1"><UserPlus size={11} /> {d.agentCount} agent{d.agentCount === 1 ? "" : "s"}</span>
                  <span className="inline-flex items-center gap-1"><Plug size={11} /> {d.integrationCount} integrations</span>
                  {d.hasSchedule && <span className="inline-flex items-center gap-1"><Calendar size={11} /> schedule</span>}
                  <span className="inline-flex items-center gap-1"><Clock size={11} /> {d.workflowSteps} steps</span>
                </div>

                <button
                  onClick={() => apply(d.id)}
                  disabled={applying === d.id}
                  className="mt-4 w-full flex items-center justify-center gap-2 bg-ink-800 hover:bg-violet-500/20 border border-ink-700 hover:border-violet-500/40 disabled:opacity-50 text-cream-100 text-sm py-2.5 rounded-lg transition-colors"
                >
                  {applying === d.id ? <><Loader2 size={14} className="animate-spin" /> Deploying…</> : <><Zap size={14} className="text-violet-400" /> Deploy department</>}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Deployment result */}
      {result && (
        <Card title={`${result.departmentName} deployed`} className="border-leaf-500/30">
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2 text-leaf-400">
              <Check size={16} /> {result.personas.length} agent{result.personas.length === 1 ? "" : "s"} created
            </div>
            <ul className="space-y-1">
              {result.personas.map((p: any) => (
                <li key={p.id} className="flex items-center gap-2 text-cream-100">
                  <UserPlus size={14} className="text-violet-400" />
                  <span className="font-medium">{p.name}</span>
                  <span className="text-cream-300/50">· {p.role}</span>
                  <Link to="/personas" className="text-violet-400 hover:text-violet-500 ml-auto text-xs">Manage →</Link>
                </li>
              ))}
            </ul>
            {result.recommendedIntegrations?.length > 0 && (
              <div className="mt-3">
                <div className="text-xs text-cream-300/60">Suggested integrations: {result.recommendedIntegrations.join(", ")}</div>
              </div>
            )}
            {result.workflow?.length > 0 && (
              <div className="mt-2">
                <div className="text-xs text-cream-300/60 mb-1">Default workflow:</div>
                <ol className="space-y-0.5">
                  {result.workflow.map((w: any, i: number) => (
                    <li key={i} className="text-xs text-cream-300/80 flex items-start gap-2">
                      <span className="text-violet-400 font-mono mt-0.5">{i + 1}.</span>
                      <span><span className="text-cream-100">{w.persona}</span>: {w.task}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
