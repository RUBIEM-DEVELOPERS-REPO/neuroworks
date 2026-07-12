import { useEffect, useState } from "react";
import { Card } from "../components/Card";
import { api } from "../lib/api";
import { setLanguage, loadSavedLanguage, availableLanguages, type Language } from "../lib/i18n";

type ModelInfo = {
  name: string;
  family: string;
  paramSize?: string;
  sizeGB?: number;
  capabilities: { jsonStrict: number; reasoning: number; longForm: number; speed: number; cost: number };
};

export function Settings() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-cream-50">Settings</h1>
        <p className="text-sm text-cream-300/70 mt-1">Personalize NeuroWorks.</p>
      </div>

      <Card title="Profile">
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-cream-300/70">Name</span><span className="text-cream-100">Arthur Magaya</span></div>
          <div className="flex justify-between"><span className="text-cream-300/70">Email</span><span className="text-cream-100">admin@rubiem.com</span></div>
          <div className="flex justify-between"><span className="text-cream-300/70">Org</span><span className="text-cream-100">RUBIEM Innovations · Aiia</span></div>
        </div>
      </Card>

      <LanguageSection />
      <ResponseStyleSection />

      <ModelsSection />

      <Card title="Configuration">
        <div className="text-xs text-cream-300/70 mb-3">NeuroWorks reads its config from <span className="font-mono">clawbot/.env</span>. Edit there and restart to apply changes durably.</div>
        <ul className="text-xs space-y-1.5 font-mono text-cream-200">
          <li><span className="text-cream-300/50">VAULT_PATH</span> — local Obsidian vault location</li>
          <li><span className="text-cream-300/50">VAULT_REPO</span> — GitHub repo for the vault</li>
          <li><span className="text-cream-300/50">GITHUB_TOKEN</span> — fine-grained PAT for Neuro</li>
          <li><span className="text-cream-300/50">OLLAMA_MODEL</span> — default model (overridable above at runtime)</li>
          <li><span className="text-cream-300/50">OLLAMA_PLAN_MODEL</span> — pin a model for planning (skips capability scorer)</li>
          <li><span className="text-cream-300/50">OLLAMA_SYNTH_MODEL</span> — pin a model for synthesis</li>
          <li><span className="text-cream-300/50">OLLAMA_TRIAGE_MODEL</span> — pin a model for triage / direct-answer classification</li>
          <li><span className="text-cream-300/50">OLLAMA_EXTRACT_MODEL</span> — pin a model for JSON extraction (personas, quality)</li>
          <li><span className="text-cream-300/50">NEUROWORKS_TRIAGE</span> — set to <span className="text-cream-300/40">0</span> to disable the direct-answer shortcut</li>
          <li><span className="text-cream-300/50">NEUROWORKS_PEERS</span> — comma-separated peer URLs for delegation + review</li>
          <li><span className="text-cream-300/50">NEUROWORKS_AUTO_REVIEW</span> — set to <span className="text-cream-300/40">0</span> to disable post-synthesis peer review</li>
          <li><span className="text-cream-300/50">NEUROWORKS_OVERLOAD_THRESHOLD</span> — local in-flight count that triggers peer hand-off (default 2)</li>
          <li><span className="text-cream-300/50">NEUROWORKS_VAULT_SCAN</span> — set to <span className="text-cream-300/40">0</span> to disable secret-scan gate on vault writes</li>
          <li><span className="text-cream-300/50">NEUROWORKS_AUTO_REBASE_RECOVERY</span> — set to <span className="text-cream-300/40">1</span> to enable post-push rebase recovery (off by default — risky)</li>
          <li><span className="text-cream-300/50">NEUROWORKS_NO_WARMUP</span> — set to <span className="text-cream-300/40">1</span> to skip Ollama pre-warm at boot</li>
          <li><span className="text-cream-300/50">NEUROWORKS_PORT</span> — backend bind port</li>
        </ul>
      </Card>

      <Card title="About">
        <div className="text-xs text-cream-300/70 leading-relaxed">
          NeuroWorks is the intelligent-organization platform — agents and people working as one system — from <a className="text-violet-400 hover:text-violet-500" href="https://www.aiinstituteafrica.com" target="_blank" rel="noopener noreferrer">Aiia</a>, built and shipped by RUBIEM Innovations.
          This local console is the first surface — describe a task, delegate it, get results. Governance and audit are first-class.
        </div>
      </Card>
    </div>
  );
}

// Org-wide default language for agent output (plan/direct/synth prompts —
// see server/src/lib/language-prompts.ts). Per-agent overrides live on
// Personas instead; this is the fallback every agent without one uses.
function LanguageSection() {
  const [lang, setLang] = useState<Language>(loadSavedLanguage());
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.getOnboarding().then(r => {
      if (r.state?.language) setLang(r.state.language as Language);
    }).catch(() => {});
  }, []);

  async function choose(code: Language) {
    if (code === lang || busy) return;
    setBusy(true); setSaved(false);
    try {
      // completed:true is required by the route's own contract, not a
      // re-run of onboarding — everything else (sector, orgName) is left
      // untouched since this is a true partial patch.
      await api.setOnboarding({ completed: true, language: code });
      setLanguage(code);
      setLang(code);
      setSaved(true);
      // i18n.ts is a module-level var, not a React context — nothing else
      // mounted right now re-renders on its own when it changes. A reload
      // is the simplest way to make every already-mounted page (Dashboard's
      // Zimbabwe Context card, etc.) actually reflect the new language,
      // and matches how Onboarding.tsx's own language step takes effect
      // (via the navigate-to-dashboard remount right after).
      setTimeout(() => window.location.reload(), 500);
    } catch { /* keep the previous selection on failure */ }
    finally { setBusy(false); }
  }

  return (
    <Card title="Language">
      <div className="text-xs text-cream-300/70 mb-3">
        Default language for agent output — plans, replies, and generated documents. Agents with their own language set (Team page) use that instead.
      </div>
      {saved && <div className="text-xs text-leaf-400 bg-leaf-500/10 border border-leaf-500/30 rounded-md px-3 py-2 mb-3">Saved — reloading…</div>}
      <div className="grid grid-cols-3 gap-2">
        {availableLanguages().map(l => (
          <button
            key={l.code}
            type="button"
            onClick={() => choose(l.code)}
            disabled={busy}
            className={`p-3 rounded-lg border text-center transition-colors disabled:opacity-50 ${
              lang === l.code
                ? "bg-violet-500/10 border-violet-500/50 ring-1 ring-violet-500/30 text-cream-50"
                : "bg-ink-950 border-ink-800 text-cream-300 hover:border-violet-500/30"
            }`}
          >
            <div className="text-sm font-medium">{l.name}</div>
          </button>
        ))}
      </div>
    </Card>
  );
}

// Org-wide answer style. "Caveman" = radically terse agent replies (no
// filler, no pleasantries, fragments fine) with every number, name, link,
// and citation kept. Server side: OnboardingState.responseStyle →
// injectLanguagePrompt in language-prompts.ts (synth/direct only).
function ResponseStyleSection() {
  const [style, setStyle] = useState<"standard" | "caveman">("standard");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.getOnboarding().then(r => {
      if ((r.state as any)?.responseStyle) setStyle((r.state as any).responseStyle);
    }).catch(() => {});
  }, []);

  async function choose(next: "standard" | "caveman") {
    if (next === style || busy) return;
    setBusy(true); setSaved(false);
    try {
      await api.setOnboarding({ completed: true, responseStyle: next } as any);
      setStyle(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch { /* keep previous on failure */ }
    finally { setBusy(false); }
  }

  return (
    <Card title="Answer style">
      <div className="text-xs text-cream-300/70 mb-3">
        How agents write their answers. Caveman mode is radically terse — filler and pleasantries go, every fact, number, and citation stays.
      </div>
      {saved && <div className="text-xs text-leaf-400 bg-leaf-500/10 border border-leaf-500/30 rounded-md px-3 py-2 mb-3">Saved — applies to the next task.</div>}
      <div className="grid grid-cols-2 gap-2">
        {([
          { code: "standard" as const, name: "Standard", hint: "Full professional prose" },
          { code: "caveman" as const, name: "Caveman", hint: "Terse. Substance only." },
        ]).map(o => (
          <button
            key={o.code}
            type="button"
            onClick={() => choose(o.code)}
            disabled={busy}
            className={`p-3 rounded-lg border text-center transition-colors disabled:opacity-50 ${
              style === o.code
                ? "bg-violet-500/10 border-violet-500/50 ring-1 ring-violet-500/30 text-cream-50"
                : "bg-ink-950 border-ink-800 text-cream-300 hover:border-violet-500/30"
            }`}
          >
            <div className="text-sm font-medium">{o.name}</div>
            <div className="text-[11px] text-cream-300/50 mt-0.5">{o.hint}</div>
          </button>
        ))}
      </div>
    </Card>
  );
}

function ModelsSection() {
  const [data, setData] = useState<{ default: string; models: ModelInfo[]; recommendations: Record<string, string>; profiles: Record<string, Record<string, number>> } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  async function load() {
    try { setData(await api.listModels()); } catch (e: any) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function setDefault(name: string) {
    setBusy(name); setErr(""); setMsg("");
    try {
      const r = await api.setDefaultModel(name);
      setMsg(`Default is now ${r.default}. ${r.hint}`);
      await load();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(null); }
  }

  if (!data) {
    return <Card title="Local models"><div className="text-sm text-cream-300/60">Loading models from Ollama…</div></Card>;
  }

  // Sort by score against a "balanced" need vector so the most useful model
  // surfaces first. Simple heuristic: capabilities sum minus cost weight.
  const ranked = [...data.models].sort((a, b) => {
    const sa = a.capabilities.jsonStrict + a.capabilities.reasoning + a.capabilities.longForm + a.capabilities.speed - a.capabilities.cost * 0.5;
    const sb = b.capabilities.jsonStrict + b.capabilities.reasoning + b.capabilities.longForm + b.capabilities.speed - b.capabilities.cost * 0.5;
    return sb - sa;
  });

  // Reverse map: model → which profiles recommend it
  const profileByModel: Record<string, string[]> = {};
  for (const [profile, model] of Object.entries(data.recommendations)) {
    (profileByModel[model] ??= []).push(profile);
  }

  return (
    <Card title="Local models">
      <div className="text-xs text-cream-300/70 mb-3">
        These are pulled into Ollama. The router scores each against the active task profile and picks the best fit per call.
        Default model: <span className="font-mono text-cream-100">{data.default}</span>
      </div>
      {msg && <div className="text-xs text-leaf-400 bg-leaf-500/10 border border-leaf-500/30 rounded-md px-3 py-2 mb-3">{msg}</div>}
      {err && <div className="text-xs text-coral-400 bg-coral-500/10 border border-coral-500/30 rounded-md px-3 py-2 mb-3">{err}</div>}

      <div className="space-y-2">
        {ranked.map(m => (
          <div key={m.name} className={`bg-ink-950 border rounded-lg p-3 ${m.name === data.default ? "border-violet-500/50" : "border-ink-800"}`}>
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="min-w-0">
                <div className="font-mono text-sm text-cream-50">
                  {m.name}
                  {m.name === data.default && <span className="ml-2 text-[10px] uppercase tracking-wider bg-violet-500/20 text-violet-300 px-1.5 py-0.5 rounded border border-violet-500/30">default</span>}
                </div>
                <div className="text-[11px] text-cream-300/60 mt-0.5">
                  {m.family}{m.paramSize ? ` · ${m.paramSize}` : ""}{m.sizeGB ? ` · ${m.sizeGB} GB` : ""}
                </div>
                {profileByModel[m.name] && (
                  <div className="text-[10px] text-cream-300/50 mt-1">
                    Picked for: {profileByModel[m.name].map(p => <span key={p} className="font-mono text-violet-400 mr-2">{p}</span>)}
                  </div>
                )}
              </div>
              {m.name !== data.default && (
                <button
                  onClick={() => setDefault(m.name)}
                  disabled={busy === m.name}
                  className="text-xs text-cream-100 bg-ink-800 hover:bg-ink-700 border border-ink-700 px-3 py-1 rounded-md disabled:opacity-50"
                >
                  {busy === m.name ? "…" : "Set default"}
                </button>
              )}
            </div>
            <CapabilityBars cap={m.capabilities} />
          </div>
        ))}
      </div>

      <div className="mt-4 pt-3 border-t border-ink-800">
        <div className="text-[10px] uppercase tracking-wider text-cream-300/50 mb-2">Profile → Model routing</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] font-mono">
          {Object.entries(data.recommendations).map(([profile, model]) => (
            <div key={profile} className="flex justify-between gap-3">
              <span className="text-cream-300/60">{profile}</span>
              <span className="text-cream-100 truncate">{model}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function CapabilityBars({ cap }: { cap: { jsonStrict: number; reasoning: number; longForm: number; speed: number; cost: number } }) {
  const rows: { label: string; value: number; max: number; color: string; invert?: boolean }[] = [
    { label: "JSON strict", value: cap.jsonStrict, max: 10, color: "bg-violet-500" },
    { label: "Reasoning", value: cap.reasoning, max: 10, color: "bg-leaf-500" },
    { label: "Long-form", value: cap.longForm, max: 10, color: "bg-flame-500" },
    { label: "Speed", value: cap.speed, max: 10, color: "bg-cream-300" },
    { label: "Cost", value: cap.cost, max: 10, color: "bg-coral-500", invert: true },
  ];
  return (
    <div className="grid grid-cols-5 gap-2">
      {rows.map(r => (
        <div key={r.label} className="text-[10px]">
          <div className="text-cream-300/60 mb-0.5">{r.label}{r.invert ? " (lower = better)" : ""}</div>
          <div className="h-1 bg-ink-800 rounded overflow-hidden">
            <div className={`h-full ${r.color}`} style={{ width: `${(r.value / r.max) * 100}%` }} />
          </div>
          <div className="text-cream-300/40 mt-0.5 font-mono">{r.value}/{r.max}</div>
        </div>
      ))}
    </div>
  );
}
