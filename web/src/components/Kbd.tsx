import { ReactNode } from "react";

// Physical-key treatment for keyboard shortcuts. Use across cmd-K palette,
// composer footer hints, and anywhere a shortcut is surfaced. Centralized so
// every <kbd> on the surface reads as the same key style.
export function Kbd({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={`inline-grid place-items-center min-w-[20px] h-5 px-1.5 text-[10px] font-mono leading-none text-cream-200 bg-ink-950 border border-ink-700 border-b-2 rounded ${className}`}
    >
      {children}
    </kbd>
  );
}

// Convenience: the platform-specific Cmd/Ctrl key as a Kbd.
export function MetaKey({ className = "" }: { className?: string }) {
  const isMac = typeof navigator !== "undefined" && navigator.platform.includes("Mac");
  return <Kbd className={className}>{isMac ? "⌘" : "Ctrl"}</Kbd>;
}
