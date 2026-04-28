import { ReactNode } from "react";

export function Card({ title, action, children, className = "" }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`bg-ink-900 border border-ink-700 rounded-lg ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-ink-700">
          {title && <h3 className="text-sm font-semibold text-slate-200">{title}</h3>}
          {action}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}

export function StatusDot({ ok, label }: { ok: boolean | "pending"; label: string }) {
  const color = ok === true ? "bg-pulse-500" : ok === "pending" ? "bg-amber-400 animate-pulse" : "bg-red-500";
  return (
    <span className="inline-flex items-center gap-2 text-xs text-slate-400">
      <span className={`inline-block w-2 h-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}

export function Button({ onClick, disabled, children, variant = "primary" }: { onClick?: () => void; disabled?: boolean; children: ReactNode; variant?: "primary" | "ghost" }) {
  const base = "px-3 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const v = variant === "primary"
    ? "bg-neuro-500 hover:bg-neuro-600 text-white"
    : "bg-ink-800 hover:bg-ink-700 text-slate-200 border border-ink-700";
  return <button onClick={onClick} disabled={disabled} className={`${base} ${v}`}>{children}</button>;
}
