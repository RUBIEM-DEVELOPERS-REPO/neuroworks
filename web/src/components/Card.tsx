import { ReactNode } from "react";

export function Card({ title, action, children, className = "" }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`bg-ink-900 border border-ink-800 rounded-xl ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-ink-800">
          {title && <h3 className="text-sm font-semibold text-cream-100 tracking-wide">{title}</h3>}
          {action}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}

export function StatusDot({ ok, label }: { ok: boolean | "pending"; label: string }) {
  const color = ok === true ? "bg-leaf-500" : ok === "pending" ? "bg-flame-400 animate-pulse" : "bg-coral-500";
  return (
    <span className="inline-flex items-center gap-2 text-xs text-cream-300">
      <span className={`inline-block w-2 h-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}

export function Button({ onClick, disabled, children, variant = "primary", className = "", type = "button" }: { onClick?: () => void; disabled?: boolean; children: ReactNode; variant?: "primary" | "ghost" | "subtle"; className?: string; type?: "button" | "submit" }) {
  const base = "px-4 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const v = variant === "primary"
    ? "bg-violet-500 hover:bg-violet-600 text-white"
    : variant === "subtle"
    ? "bg-ink-800 hover:bg-ink-700 text-cream-100 border border-ink-700"
    : "text-cream-300 hover:text-cream-100";
  return <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${v} ${className}`}>{children}</button>;
}

export function RoleIcon({ role, className = "" }: { role: string; className?: string }) {
  const map: Record<string, { fg: string; bg: string; glyph: string }> = {
    Engineering: { fg: "text-flame-400", bg: "bg-flame-500/15", glyph: "⌬" },
    Knowledge: { fg: "text-violet-400", bg: "bg-violet-500/15", glyph: "◈" },
    Operations: { fg: "text-leaf-400", bg: "bg-leaf-500/15", glyph: "↻" },
    Insights: { fg: "text-coral-400", bg: "bg-coral-500/15", glyph: "✦" },
  };
  const m = map[role] ?? { fg: "text-cream-200", bg: "bg-ink-800", glyph: "·" };
  return <span className={`inline-grid place-items-center w-9 h-9 rounded-lg ${m.bg} ${m.fg} text-lg ${className}`}>{m.glyph}</span>;
}
