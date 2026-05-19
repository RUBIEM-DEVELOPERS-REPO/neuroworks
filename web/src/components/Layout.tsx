import { NavLink, Link } from "react-router-dom";
import { ReactNode, useEffect, useState } from "react";
import { BrandMark } from "./BrandMark";
import { api } from "../lib/api";

const primaryNav = [
  { to: "/dashboard", label: "Dashboard", icon: "◉" },
  { to: "/chat", label: "Chat", icon: "◌" },
  { to: "/tasks", label: "Tasks", icon: "▤" },
  { to: "/results", label: "Reports", icon: "❡" },
  { to: "/approvals", label: "Approvals", icon: "✓", badgeKey: "approvals" },
  { to: "/activity", label: "Activity", icon: "≋", badgeKey: "activity" },
  { to: "/admin", label: "Admin", icon: "⚙" },
];
const secondaryNav = [
  { to: "/templates", label: "Templates", icon: "◫" },
  { to: "/skills", label: "Skills", icon: "◇" },
  { to: "/knowledge", label: "Knowledge", icon: "◈" },
  { to: "/personas", label: "Personas", icon: "◐" },
  { to: "/settings", label: "Settings", icon: "⚒" },
];

export function Layout({ children }: { children: ReactNode }) {
  const [health, setHealth] = useState<{ ready: boolean; missing?: string[] } | null>(null);
  const [counts, setCounts] = useState<{ approvals: number; activity: number }>({ approvals: 0, activity: 0 });
  const [persona, setPersona] = useState<{ id: string; name: string; role: string } | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    if (typeof window === "undefined") return "dark";
    const saved = localStorage.getItem("neuroworks.theme");
    return saved === "light" ? "light" : "dark";
  });
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("neuroworks.theme", theme);
  }, [theme]);

  async function tick() {
    try {
      const h = await api.health();
      setHealth(h);
      const j = await api.listJobs().catch(() => ({ jobs: [] }));
      const running = j.jobs.filter((x: any) => x.status === "running").length;
      const pendingApproval = j.jobs.filter((x: any) => x.requiresApproval && x.status === "pending").length;
      setCounts({ approvals: pendingApproval, activity: running });
      const p = await api.listPersonas().catch(() => ({ active: null } as any));
      setPersona(p.active);
    } catch {}
  }
  useEffect(() => { tick(); const i = setInterval(tick, 5000); return () => clearInterval(i); }, []);

  const statusOk = health?.ready === true;
  const statusLabel = !health ? "connecting…" : statusOk ? "All systems nominal" : "Degraded — check Settings";

  return (
    <div className="flex h-full">
      <aside className="w-60 shrink-0 bg-ink-900 border-r border-ink-800 flex flex-col">
        <div className="px-5 py-5">
          <Link to="/dashboard" className="flex items-center gap-2.5">
            <BrandMark size={26} />
            <div>
              <div className="font-display font-semibold text-cream-50 text-lg leading-none">NeuroWorks</div>
              <div className="text-[10px] text-cream-300/70 mt-1 tracking-wider uppercase">The AI Workforce</div>
            </div>
          </Link>
        </div>

        <div className="px-3 pb-3">
          <Link to="/chat" className="w-full flex items-center justify-center gap-1.5 bg-ink-800 hover:bg-ink-700 border border-ink-700 hover:border-violet-500/40 rounded-md py-2 text-sm text-cream-100 transition-colors">
            <span className="text-violet-400">+</span> New chat
          </Link>
        </div>

        <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto scrollbar-thin">
          {primaryNav.map(n => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${isActive ? "bg-ink-800 text-cream-50" : "text-cream-300 hover:text-cream-50 hover:bg-ink-800/60"}`
            }>
              <span className="text-cream-300/60 w-3 text-center">{n.icon}</span>
              <span className="flex-1">{n.label}</span>
              {n.badgeKey && counts[n.badgeKey as keyof typeof counts] > 0 && (
                <span className="bg-violet-500/20 text-violet-400 text-[10px] px-1.5 py-0.5 rounded-full font-mono">{counts[n.badgeKey as keyof typeof counts]}</span>
              )}
            </NavLink>
          ))}
          <div className="border-t border-ink-800 my-3" />
          {secondaryNav.map(n => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${isActive ? "bg-ink-800 text-cream-50" : "text-cream-300 hover:text-cream-50 hover:bg-ink-800/60"}`
            }>
              <span className="text-cream-300/60 w-3 text-center">{n.icon}</span>
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="px-5 py-3 border-t border-ink-800 text-[10px] text-cream-300/40">
          local · 127.0.0.1
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="flex items-center justify-between px-8 py-3 border-b border-ink-800">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-coral-500 grid place-items-center text-[11px] font-semibold text-white">A</div>
            <div className="text-sm text-cream-200">Arthur Magaya <span className="text-cream-300/50">· admin@rubiem.com</span></div>
          </div>
          <div className="flex items-center gap-2">
            {persona && (
              <Link to="/personas" className="text-xs px-3 py-1.5 rounded-full border bg-violet-500/10 border-violet-500/30 text-violet-300" title="Active persona">
                ◐ {persona.name} <span className="opacity-60">· {persona.role}</span>
              </Link>
            )}
            <div className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-full border ${statusOk ? "bg-leaf-500/10 border-leaf-500/30 text-leaf-400" : "bg-flame-500/10 border-flame-500/30 text-flame-400"}`}>
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${statusOk ? "bg-leaf-500" : "bg-flame-500 animate-pulse"}`} />
              {statusLabel}
            </div>
            <button
              type="button"
              onClick={() => setTheme(t => t === "dark" ? "light" : "dark")}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              className="text-xs px-2.5 py-1.5 border border-ink-700 hover:border-violet-500/40 rounded-md text-cream-300 hover:text-cream-100 transition-colors"
            >
              {theme === "dark" ? "☼" : "☾"}
            </button>
          </div>
          <Link to="/knowledge" className="text-xs text-cream-300/70 hover:text-cream-100 px-3 py-1.5 border border-ink-700 rounded-md">Search ⌕</Link>
        </header>
        <div className="flex-1 overflow-auto scrollbar-thin">
          <div className="max-w-6xl mx-auto px-8 py-7">{children}</div>
        </div>
      </main>
    </div>
  );
}
