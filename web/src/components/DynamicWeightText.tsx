import { useEffect, useRef } from "react";

// Letters individually morph their `wght` (font-variation-settings) based on
// distance from the cursor — adapted from a Framer-marketplace component
// (Dynamic Weight / VariableFontCursorProximity). Adapted, not just trimmed:
//   - Dropped the bundled Inter Variable @font-face + Framer static-render
//     branching (RenderTarget/useIsStaticRenderer never applies outside
//     Framer's own canvas). Uses Plus Jakarta Sans instead — this app's own
//     display face (see index.html's wght@200..800 RANGE request, which
//     serves the actual variable font so this axis morph works at all; a
//     discrete weight list like "500;600;700" would not).
//   - Color defaults to var(--c-cream-50) instead of a fixed hex, so it
//     tracks the light/dark theme toggle like every other heading.
//   - The component is a headline replacement, not a floating layer: no
//     forced width:100%/height:100% (that assumed a Framer frame with an
//     explicit pixel size); sizes to its content like a normal <h1>.
// Per-frame style mutation is done directly on the DOM nodes (bypassing
// React), matching the original — needed to stay smooth at 60fps.

type Transition = { duration?: number; ease?: string };

const FONT_STACK = "'Plus Jakarta Sans', system-ui, sans-serif";
// Strength 1-100 -> proximity reach in px.
const MAX_REACH = 800;

type Props = {
  text: string;
  fromWeight?: number;
  toWeight?: number;
  strength?: number;
  fontSize?: number;
  color?: string;
  transition?: Transition;
  className?: string;
};

export function DynamicWeightText({
  text,
  fromWeight = 500,
  toWeight = 800,
  strength = 35,
  fontSize = 60,
  color = "var(--c-cream-50)",
  transition = { duration: 0.3 },
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const letterRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const letterFactorsRef = useRef<number[]>([]);
  const lastFrameRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const mouseRef = useRef({ x: -99999, y: -99999 });
  const reducedMotionRef = useRef(false);

  useEffect(() => {
    reducedMotionRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotionRef.current) return; // static rest weight, no listeners/rAF

    const updatePosition = (clientX: number, clientY: number) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      mouseRef.current = { x: clientX - rect.left, y: clientY - rect.top };
    };
    const handleMouseMove = (ev: MouseEvent) => updatePosition(ev.clientX, ev.clientY);
    const handleTouchMove = (ev: TouchEvent) => {
      if (ev.touches.length === 0) return;
      updatePosition(ev.touches[0].clientX, ev.touches[0].clientY);
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("touchmove", handleTouchMove);

    const reach = Math.max(1, (Math.max(1, Math.min(100, strength)) / 100) * MAX_REACH);
    const fromSettings = `'wght' ${fromWeight}`;

    const tick = (now: number) => {
      const container = containerRef.current;
      if (!container) { rafRef.current = requestAnimationFrame(tick); return; }
      const containerRect = container.getBoundingClientRect();
      const { x: mx, y: my } = mouseRef.current;

      const prevT = lastFrameRef.current || now;
      const dtSec = Math.min(0.1, Math.max(0, (now - prevT) / 1000));
      lastFrameRef.current = now;
      const tau = Math.max(0.016, transition?.duration ?? 0.3);
      const a = 1 - Math.exp(-dtSec / tau);

      for (let i = 0; i < letterRefs.current.length; i++) {
        const letterEl = letterRefs.current[i];
        if (!letterEl) continue;
        const rect = letterEl.getBoundingClientRect();
        const cx = rect.left + rect.width / 2 - containerRect.left;
        const cy = rect.top + rect.height / 2 - containerRect.top;
        const dx = mx - cx, dy = my - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);

        const target = Math.min(Math.max(1 - dist / reach, 0), 1);
        const prev = letterFactorsRef.current[i] ?? 0;
        const f = prev + (target - prev) * a;
        letterFactorsRef.current[i] = f;

        if (f < 0.001) {
          if (letterEl.style.fontVariationSettings !== fromSettings) letterEl.style.fontVariationSettings = fromSettings;
          continue;
        }
        const w = Math.round(fromWeight + (toWeight - fromWeight) * f);
        letterEl.style.fontVariationSettings = `'wght' ${w}`;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("touchmove", handleTouchMove);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [strength, fromWeight, toWeight, transition?.duration]);

  const srOnlyStyle: React.CSSProperties = {
    position: "absolute", width: 1, height: 1, padding: 0, margin: -1,
    overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap", borderWidth: 0,
  };
  const restSettings = `'wght' ${fromWeight}`;
  const words = text ? text.split(" ") : [];
  letterRefs.current = [];
  let letterIndex = 0;

  return (
    <div ref={containerRef} className={className} style={{ display: "inline-block", cursor: reducedMotionRef.current ? undefined : "default" }}>
      <span
        aria-hidden={words.length > 0}
        style={{ fontFamily: FONT_STACK, fontSize, color, lineHeight: 1.1, display: "block" }}
      >
        {words.length === 0 ? null : <span style={srOnlyStyle}>{text}</span>}
        {words.map((word, wi) => (
          <span key={wi} style={{ display: "inline-block", whiteSpace: "nowrap" }} aria-hidden>
            {word.split("").map((letter, li) => {
              const idx = letterIndex++;
              return (
                <span
                  key={li}
                  ref={(el) => { letterRefs.current[idx] = el; }}
                  style={{ display: "inline-block", fontVariationSettings: restSettings }}
                >
                  {letter}
                </span>
              );
            })}
            {wi < words.length - 1 && <span style={{ display: "inline-block" }}>&nbsp;</span>}
          </span>
        ))}
      </span>
    </div>
  );
}
