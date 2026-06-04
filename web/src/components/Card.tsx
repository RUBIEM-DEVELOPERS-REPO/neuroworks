import { ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Wrench, BookOpen, Repeat, Sparkles, Circle, type LucideIcon } from "lucide-react";

export function Card({ title, action, children, className = "", hoverable = false }: { title?: string; action?: ReactNode; children: ReactNode; className?: string; hoverable?: boolean }) {
  return (
    <div className={`bg-ink-900 border border-ink-800 rounded-xl ${hoverable ? "nw-card-hover" : ""} ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-ink-800">
          {title && <h3 className="text-sm font-semibold text-cream-100 tracking-tight">{title}</h3>}
          {action}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}

// Shimmering placeholder block — matches the eventual layout shape so
// the page doesn't reflow on load. Width/height are passed via Tailwind
// classes; rounded by default so a row of skeletons looks like list items.
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

// A row of skeleton lines — the lazy default for "I don't know the exact
// shape but I need a placeholder list". `rows` defaults to 4.
export function SkeletonList({ rows = 4, className = "" }: { rows?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`} aria-busy="true" aria-label="loading">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className={`h-4 ${i % 3 === 0 ? "w-3/4" : i % 3 === 1 ? "w-1/2" : "w-full"}`} />
      ))}
    </div>
  );
}

// Toast — one-line success/error banner that slides up from the bottom-
// right and auto-dismisses. Used for save/upload/copy feedback so the
// operator gets a tactile "yes that worked" without a modal.
export type ToastTone = "success" | "error" | "info";
export type ToastItem = { id: number; tone: ToastTone; text: string };
let _toastCounter = 0;
const _toastSubscribers: ((items: ToastItem[]) => void)[] = [];
let _toastItems: ToastItem[] = [];
export function showToast(text: string, tone: ToastTone = "success", ttlMs = 2600) {
  const id = ++_toastCounter;
  _toastItems = [..._toastItems, { id, tone, text }];
  _toastSubscribers.forEach(fn => fn(_toastItems));
  setTimeout(() => {
    _toastItems = _toastItems.filter(t => t.id !== id);
    _toastSubscribers.forEach(fn => fn(_toastItems));
  }, ttlMs);
}
// Mount this once at the layout root.
export function ToastRack() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    _toastSubscribers.push(setItems);
    return () => { const i = _toastSubscribers.indexOf(setItems); if (i >= 0) _toastSubscribers.splice(i, 1); };
  }, []);
  if (typeof document === "undefined" || items.length === 0) return null;
  return createPortal(
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 items-end pointer-events-none">
      {items.map(t => (
        <div
          key={t.id}
          role="status"
          className={`nw-toast pointer-events-auto px-4 py-2.5 rounded-lg border text-sm shadow-lg max-w-sm ${
            t.tone === "success" ? "bg-leaf-500/15 border-leaf-500/40 text-leaf-300"
            : t.tone === "error"  ? "bg-coral-500/15 border-coral-500/40 text-coral-300"
            :                       "bg-ink-800 border-ink-700 text-cream-100"
          }`}
        >
          {t.text}
        </div>
      ))}
    </div>,
    document.body,
  );
}

export function StatusDot({ ok, label }: { ok: boolean | "pending"; label: string }) {
  const color = ok === true ? "bg-leaf-500" : ok === "pending" ? "bg-flame-400" : "bg-coral-500";
  // State class drives the keyframes: pending = soft pulse, true = pop-in.
  const stateClass = ok === "pending" ? "is-running" : ok === true ? "is-succeeded" : "";
  return (
    <span className="inline-flex items-center gap-2 text-xs text-cream-300">
      <span className={`inline-block w-2 h-2 rounded-full nw-status-dot ${color} ${stateClass}`} />
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
  return <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${v} nw-press ${className}`}>{children}</button>;
}

export function RoleIcon({ role, className = "" }: { role: string; className?: string }) {
  const map: Record<string, { fg: string; bg: string; Icon: LucideIcon }> = {
    Engineering: { fg: "text-flame-400", bg: "bg-flame-500/15", Icon: Wrench },
    Knowledge: { fg: "text-violet-400", bg: "bg-violet-500/15", Icon: BookOpen },
    Operations: { fg: "text-leaf-400", bg: "bg-leaf-500/15", Icon: Repeat },
    Insights: { fg: "text-coral-400", bg: "bg-coral-500/15", Icon: Sparkles },
  };
  const m = map[role] ?? { fg: "text-cream-200", bg: "bg-ink-800", Icon: Circle };
  const Icon = m.Icon;
  return (
    <span className={`inline-grid place-items-center w-9 h-9 rounded-lg ${m.bg} ${m.fg} ${className}`}>
      <Icon size={18} />
    </span>
  );
}
