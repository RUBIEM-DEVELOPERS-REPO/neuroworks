import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";

// Browseable catalog of the agent's skill playbooks. The agent loads
// these at synth time based on a composite intent + keyword score (see
// server/src/lib/skills.ts). Until now there was no way for the customer
// to see what their AI workforce knows how to do — this page renders the
// /api/skills index and lets them click in to read any individual
// playbook body via /api/skills/:name.

type SkillRow = {
  name: string;
  description: string;
  source: "builtin" | "user" | "remote";
  applies_to: string[];
  bodyChars: number;
};

type FullSkill = {
  name: string;
  description: string;
  source: "builtin" | "user" | "remote";
  applies_to: string[];
  path: string;
  body: string;
};

export function Skills() {
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [filter, setFilter] = useState("");
  const [active, setActive] = useState<FullSkill | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeLoading, setActiveLoading] = useState(false);

  useEffect(() => {
    api.listSkills()
      .then(r => setSkills(r.skills))
      .catch(() => { /* surface as empty */ })
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = filter.toLowerCase().trim();
    if (!q) return skills;
    return skills.filter(s =>
      s.name.toLowerCase().includes(q)
      || s.description.toLowerCase().includes(q)
      || s.applies_to.some(a => a.toLowerCase().includes(q)),
    );
  }, [skills, filter]);

  function openSkill(name: string) {
    setActiveLoading(true);
    setActive(null);
    api.getSkill(name)
      .then(s => setActive(s))
      .catch(() => setActive(null))
      .finally(() => setActiveLoading(false));
  }

  const builtinCount = skills.filter(s => s.source === "builtin").length;
  const userCount = skills.filter(s => s.source === "user").length;
  const remoteCount = skills.filter(s => s.source === "remote").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-cream-50">Skills</h1>
        <p className="text-sm text-cream-300/70 mt-1">
          Playbooks the agent loads when a task matches their intent or keywords.
          Drop a custom .md into <code className="text-cream-200">server/src/skills/_user/</code> to override a built-in.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <input
          type="text"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter by name, description, or intent…"
          className="flex-1 bg-ink-800 border border-ink-700 rounded-md px-3 py-2 text-sm text-cream-100 placeholder-cream-300/40 focus:outline-none focus:border-violet-500/40"
        />
        <div className="text-xs text-cream-300/70">
          {builtinCount} built-in
          {userCount > 0 && <> · {userCount} user</>}
          {remoteCount > 0 && <> · {remoteCount} remote</>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-4">
        <div className="space-y-1.5 overflow-y-auto scrollbar-thin max-h-[calc(100vh-260px)]">
          {loading && <div className="text-sm text-cream-300/60 px-3 py-2">Loading skills…</div>}
          {!loading && filtered.length === 0 && (
            <div className="text-sm text-cream-300/60 px-3 py-2">No skills match.</div>
          )}
          {filtered.map(s => (
            <button
              key={s.name}
              onClick={() => openSkill(s.name)}
              className={`w-full text-left px-3 py-2.5 rounded-md border transition-colors ${
                active?.name === s.name
                  ? "bg-ink-800 border-violet-500/40"
                  : "bg-ink-900 border-ink-800 hover:bg-ink-800/60 hover:border-ink-700"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="font-mono text-sm text-cream-100 truncate">{s.name}</div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono ${
                  s.source === "builtin" ? "bg-ink-800 text-cream-300/70"
                    : s.source === "user" ? "bg-violet-500/15 text-violet-300"
                    : "bg-coral-500/15 text-coral-300"
                }`}>{s.source}</span>
              </div>
              <div className="text-xs text-cream-300/70 mt-1 line-clamp-2">{s.description}</div>
              {s.applies_to.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {s.applies_to.slice(0, 4).map(a => (
                    <span key={a} className="text-[10px] px-1.5 py-0.5 rounded-full bg-ink-800 text-cream-300/70 font-mono">{a}</span>
                  ))}
                  {s.applies_to.length > 4 && (
                    <span className="text-[10px] text-cream-300/50">+{s.applies_to.length - 4}</span>
                  )}
                </div>
              )}
            </button>
          ))}
        </div>

        <div className="bg-ink-900 border border-ink-800 rounded-md p-5 overflow-y-auto scrollbar-thin max-h-[calc(100vh-260px)]">
          {activeLoading && <div className="text-sm text-cream-300/60">Loading playbook…</div>}
          {!activeLoading && !active && (
            <div className="text-sm text-cream-300/60">Pick a skill on the left to read its playbook.</div>
          )}
          {!activeLoading && active && (
            <div className="space-y-3">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="font-display text-xl text-cream-50">{active.name}</h2>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full font-mono bg-ink-800 text-cream-300/70">{active.source}</span>
                </div>
                <p className="text-sm text-cream-300/80 mt-1">{active.description}</p>
                {active.applies_to.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    <span className="text-[11px] text-cream-300/60">intents:</span>
                    {active.applies_to.map(a => (
                      <span key={a} className="text-[10px] px-1.5 py-0.5 rounded-full bg-ink-800 text-cream-300/70 font-mono">{a}</span>
                    ))}
                  </div>
                )}
              </div>
              <pre className="text-xs text-cream-200 whitespace-pre-wrap bg-ink-950/50 border border-ink-800 rounded-md p-3 font-mono leading-relaxed">{active.body}</pre>
              <div className="text-[10px] text-cream-300/50 font-mono break-all">{active.path}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
