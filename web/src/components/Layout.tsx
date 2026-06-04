import { NavLink, Link, useLocation } from "react-router-dom";
import { ReactNode, useEffect, useState } from "react";
import { ToastRack } from "./Card";
import {
  LayoutDashboard, MessageSquare, Users, ListChecks, FileText, BookOpen,
  CheckCircle2, Activity as ActivityIcon, Library, Settings as SettingsIcon,
  ShieldCheck, Plus, Sun, Moon, Search as SearchIcon, ChevronRight,
  Calendar, Shield, CalendarDays, FileEdit, Database,
  Terminal as TerminalIcon, FolderKanban, Wrench,
  type LucideIcon,
} from "lucide-react";
import { BrandMark } from "./BrandMark";
import { CommandPalette } from "./CommandPalette";
import { Kbd, MetaKey } from "./Kbd";
import { api } from "../lib/api";

type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  badgeKey?: "approvals" | "activity";
};

// Top-level: the everyday surfaces. Everything else folds into a collapsible
// group (Workspace / Library / System) so the rail stays short.
const primaryNav: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/chat", label: "Chat", icon: MessageSquare },
  { to: "/team", label: "Team", icon: Users },
  { to: "/tasks", label: "Tasks", icon: ListChecks },
];

const workspaceNav: NavItem[] = [
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/results", label: "Reports", icon: FileText },
  { to: "/knowledge", label: "Knowledge", icon: BookOpen },
  { to: "/data-sources", label: "Company data", icon: Database },
  { to: "/edit", label: "Doc editor", icon: FileEdit },
];

const watchNav: NavItem[] = [
  { to: "/approvals", label: "Approvals", icon: CheckCircle2, badgeKey: "approvals" },
  { to: "/activity", label: "Activity", icon: ActivityIcon, badgeKey: "activity" },
  { to: "/schedules", label: "Schedules", icon: Calendar },
];

const libraryNav: NavItem[] = [
  { to: "/templates", label: "Templates", icon: Library },
  { to: "/skills", label: "Skills", icon: Library },
  { to: "/personas", label: "Personas", icon: Users },
];

const systemNav: NavItem[] = [
  { to: "/terminal", label: "Terminal", icon: TerminalIcon },
  { to: "/governance", label: "Governance", icon: Shield },
  { to: "/admin", label: "Admin", icon: ShieldCheck },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

export function Layout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [health, setHealth] = useState<{ ready: boolean; missing?: string[] } | null>(null);
  const [counts, setCounts] = useState<{ approvals: number; activity: number }>({ approvals: 0, activity: 0 });
  const [persona, setPersona] = useState<{ id: string; name: string; role: string } | null>(null);
  // Per-group open state. Undefined = "not toggled yet"; a group with an active
  // child defaults to open so the current page is always visible in the rail.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
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
  const statusLabel = !health ? "connecting" : statusOk ? "All systems nominal" : "Degraded, check Settings";

  const renderNavItem = (n: NavItem) => {
    const Icon = n.icon;
    return (
      <NavLink key={n.to} to={n.to} className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${isActive ? "bg-ink-800 text-cream-50" : "text-cream-300 hover:text-cream-50 hover:bg-ink-800/60"}`
      }>
        <Icon size={16} className="text-cream-300/70 shrink-0" />
        <span className="flex-1 truncate">{n.label}</span>
        {n.badgeKey && counts[n.badgeKey] > 0 && (
          <span className="bg-violet-500/20 text-violet-400 text-[10px] px-1.5 py-0.5 rounded-full font-mono">{counts[n.badgeKey]}</span>
        )}
      </NavLink>
    );
  };

  // Collapsible nav group (same pattern the Library used). Open when the user
  // has toggled it open, or — until they touch it — whenever it holds the
  // active route so the current page never hides inside a closed group.
  const renderGroup = (key: string, label: string, Icon: LucideIcon, items: NavItem[]) => {
    const hasActive = items.some(n => location.pathname.startsWith(n.to));
    const open = openGroups[key] ?? hasActive;
    return (
      <div key={key}>
        <button
          type="button"
          onClick={() => setOpenGroups(g => ({ ...g, [key]: !(g[key] ?? hasActive) }))}
          className="w-full flex items-center gap-3 px-3 py-2 mt-3 rounded-md text-sm text-cream-300 hover:text-cream-50 hover:bg-ink-800/60 transition-colors"
        >
          <Icon size={16} className="text-cream-300/70 shrink-0" />
          <span className="flex-1 text-left">{label}</span>
          <ChevronRight size={14} className={`text-cream-300/50 transition-transform ${open ? "rotate-90" : ""}`} />
        </button>
        {open && (
          <div className="ml-3 pl-3 border-l border-ink-800 space-y-0.5">
            {items.map(renderNavItem)}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full">
      <aside className="w-60 shrink-0 bg-ink-900 border-r border-ink-800 flex flex-col">
        <div className="px-5 py-5">
          <Link to="/dashboard" className="flex items-center gap-2.5">
            <BrandMark size={26} />
            <div>
              <div className="font-semibold text-cream-50 text-lg leading-none tracking-tight">NeuroWorks</div>
              <div className="text-[10px] text-cream-300/70 mt-1 tracking-wider uppercase">The AI Workforce</div>
            </div>
          </Link>
        </div>

        <div className="px-3 pb-3">
          <Link to="/chat" className="w-full flex items-center justify-center gap-1.5 bg-ink-800 hover:bg-ink-700 border border-ink-700 hover:border-violet-500/40 rounded-md py-2 text-sm text-cream-100 transition-colors">
            <Plus size={14} className="text-violet-400" /> New chat
          </Link>
        </div>

        <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto scrollbar-thin">
          {primaryNav.map(renderNavItem)}
          {renderGroup("workspace", "Workspace", FolderKanban, workspaceNav)}

          <div className="pt-3 pb-1 px-3 text-[10px] uppercase tracking-wider text-cream-300/40">Watch</div>
          {watchNav.map(renderNavItem)}

          {renderGroup("library", "Library", Library, libraryNav)}
          {renderGroup("system", "System", Wrench, systemNav)}
        </nav>

        <div className="px-3 py-3 border-t border-ink-800">
          <div className="px-3 text-[10px] text-cream-300/40">local, 127.0.0.1</div>
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
              <Link to="/personas" className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border bg-violet-500/10 border-violet-500/30 text-violet-300" title="Active persona">
                <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />
                {persona.name} <span className="opacity-60">· {persona.role}</span>
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
              aria-label="Toggle theme"
              className="grid place-items-center w-8 h-8 border border-ink-700 hover:border-violet-500/40 rounded-md text-cream-300 hover:text-cream-100 transition-colors"
            >
              {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
            </button>
            <button
              type="button"
              onClick={() => {
                const ev = new KeyboardEvent("keydown", { key: "k", metaKey: true, ctrlKey: true, bubbles: true });
                document.dispatchEvent(ev);
              }}
              className="flex items-center gap-2 text-xs px-3 py-1.5 border border-ink-700 hover:border-violet-500/40 rounded-md text-cream-300 hover:text-cream-100 transition-colors"
              title="Open command palette"
            >
              <SearchIcon size={12} />
              <span>Search</span>
              <span className="flex items-center gap-0.5"><MetaKey /><Kbd>K</Kbd></span>
            </button>
          </div>
        </header>
        <div className="flex-1 overflow-auto scrollbar-thin">
          {/* key re-keys the wrapper on route change, restarting the
              nw-page-enter animation. Reduced-motion users get an instant
              swap (the keyframe collapses to no-op in CSS). */}
          <div key={location.pathname.split("/")[1] || "/"} className="max-w-6xl mx-auto px-8 py-7 nw-page-enter">
            {children}
          </div>
        </div>
      </main>
      <CommandPalette />
      <ToastRack />
    </div>
  );
}
