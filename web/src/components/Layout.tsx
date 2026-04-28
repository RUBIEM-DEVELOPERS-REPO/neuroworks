import { NavLink } from "react-router-dom";
import { ReactNode } from "react";

const nav = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/repos", label: "Repos" },
  { to: "/brain", label: "Brain" },
  { to: "/tasks", label: "Tasks" },
];

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full">
      <aside className="w-56 shrink-0 bg-ink-900 border-r border-ink-700 flex flex-col">
        <div className="px-5 py-5 border-b border-ink-700">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-gradient-to-br from-neuro-500 to-pulse-500" />
            <div>
              <div className="font-semibold text-slate-100 leading-none">NeuroWorks</div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider mt-0.5">clawbot console</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {nav.map(n => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) =>
              `block px-3 py-2 rounded-md text-sm transition-colors ${isActive ? "bg-ink-800 text-slate-100 font-medium" : "text-slate-400 hover:text-slate-200 hover:bg-ink-800/60"}`
            }>{n.label}</NavLink>
          ))}
        </nav>
        <div className="px-5 py-3 text-[10px] text-slate-600 border-t border-ink-700">
          local · 127.0.0.1
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <div className="max-w-6xl mx-auto px-8 py-6">{children}</div>
      </main>
    </div>
  );
}
