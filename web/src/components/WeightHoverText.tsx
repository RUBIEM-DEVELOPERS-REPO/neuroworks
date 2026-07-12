import { useMemo, useState, type CSSProperties } from "react";

// Text whose letters animate their `wght` (font-variation-settings) on
// hover, staggered letter-by-letter. Adapted from a Framer-marketplace
// component (Weight Hover / VariableFontHoverByLetter) — adapted, not just
// trimmed:
//   - framer-motion dropped entirely (not a dependency of this app, and a
//     staggered weight ramp doesn't need a spring library): CSS transitions
//     animate font-variation-settings natively; the stagger is per-letter
//     transition-delay. The debounced-hover machinery goes with it — CSS
//     transitions retarget mid-flight for free, which is the whole problem
//     that machinery existed to solve.
//   - The original bundled Inter Variable from rsms.me (an external CDN
//     @font-face). This app already loads Plus Jakarta Sans as a TRUE
//     variable range (wght 200..800 — see index.html), so the morph rides
//     the app's own display face and no new external dependency appears.
//
// prefers-reduced-motion: letters render at the resting weight and the
// hover does nothing (matches the other adapted animation components).

type StaggerFrom = "first" | "last" | "center" | "random";

type Props = {
  label: string;
  fromWeight?: number;
  toWeight?: number;
  /** Per-letter stagger, ms. */
  staggerMs?: number;
  staggerFrom?: StaggerFrom;
  /** Seconds for one letter's weight ramp. */
  durationSeconds?: number;
  className?: string;
  style?: CSSProperties;
};

export function WeightHoverText({
  label,
  fromWeight = 400,
  toWeight = 800,
  staggerMs = 30,
  staggerFrom = "random",
  durationSeconds = 0.45,
  className,
  style,
}: Props) {
  const [hovered, setHovered] = useState(false);
  const reducedMotion =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const letters = useMemo(() => (label ? label.split("") : []), [label]);

  // Per-letter stagger order. Random is shuffled once per label (stable
  // across hovers — same as the original's useMemo); the others are simple
  // index math.
  const order = useMemo(() => {
    const n = letters.length;
    const idx = Array.from({ length: n }, (_, i) => i);
    if (staggerFrom === "last") return idx.map(i => n - 1 - i);
    if (staggerFrom === "center") {
      const mid = (n - 1) / 2;
      return idx.map(i => Math.round(Math.abs(i - mid)));
    }
    if (staggerFrom === "random") {
      const shuffled = [...idx];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return idx.map(i => shuffled[i]);
    }
    return idx; // "first"
  }, [letters.length, staggerFrom]);

  const srOnlyStyle: CSSProperties = {
    position: "absolute", width: 1, height: 1, padding: 0, margin: -1,
    overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap", borderWidth: 0,
  };

  if (letters.length === 0) return null;

  const active = hovered && !reducedMotion;

  const letterStyle = (i: number): CSSProperties => ({
    display: "inline-block",
    whiteSpace: "pre",
    fontVariationSettings: `'wght' ${active ? toWeight : fromWeight}`,
    transition: reducedMotion ? undefined : `font-variation-settings ${durationSeconds}s ease`,
    transitionDelay: reducedMotion ? undefined : `${((order[i] ?? 0) * staggerMs) / 1000}s`,
  });

  // Letters grouped into per-word nowrap spans so the bolder (wider) hover
  // state can only wrap at spaces, never mid-word — bare inline-block letter
  // spans wrap ANYWHERE, and the hover widening pushed "Organization" past
  // the sidebar container and split it "Organ / ization" (seen live).
  const wordGroups: { start: number; chars: string[] }[] = [];
  {
    let current: { start: number; chars: string[] } | null = null;
    letters.forEach((ch, i) => {
      if (ch === " ") { current = null; return; }
      if (!current) { current = { start: i, chars: [] }; wordGroups.push(current); }
      current.chars.push(ch);
    });
  }

  return (
    <span
      className={className}
      style={style}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span style={srOnlyStyle}>{label}</span>
      {wordGroups.map((w, wi) => (
        <span key={wi} aria-hidden>
          <span style={{ display: "inline-block", whiteSpace: "nowrap" }}>
            {w.chars.map((letter, li) => (
              <span key={li} style={letterStyle(w.start + li)}>{letter}</span>
            ))}
          </span>
          {wi < wordGroups.length - 1 && " "}
        </span>
      ))}
    </span>
  );
}
