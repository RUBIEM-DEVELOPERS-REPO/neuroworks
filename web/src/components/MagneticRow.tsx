import { useEffect, useRef, useState, type ReactNode } from "react";

// macOS-dock magnify for a row of cards: the card under the cursor grows
// widest, neighbors taper off by distance (smoothstep falloff), everything
// eases with a continuous JS lerp loop so it tracks the cursor smoothly.
// Adapted from a Framer-marketplace component (Magnetic Carousel) — adapted,
// not just trimmed:
//   - The original was an image strip (thin image bars + click-to-open a
//     large square with a blurred backdrop). Here the magnify physics wrap
//     ARBITRARY card children (template pickers, hire-a-worker cards) whose
//     own click behavior must keep working — so the open/close lightbox
//     state, backdrop, and blur are gone, and children render inside
//     flex-sized slots instead of background-image divs.
//   - Cards grow via flexGrow (0..growMax) instead of absolute width px, so
//     the row keeps filling its container exactly like the grid it replaces
//     and never overflows at any viewport width.
// The per-frame lerp loop and cursor→slot-center smoothstep falloff are the
// original's, kept intact.
//
// prefers-reduced-motion: no magnify, plain evenly-sized row.

type Props = {
  children: ReactNode[];
  /** Extra flex-grow the focused card gains (0.5 = 50% wider than rest). */
  growMax?: number;
  /** Cursor influence radius, px. */
  influence?: number;
  gap?: number;
  className?: string;
};

export function MagneticRow({ children, growMax = 0.55, influence = 220, gap = 12, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const count = children.length;
  const [factors, setFactors] = useState<number[]>(() => Array(count).fill(0));
  const targetRef = useRef<number[]>(Array(count).fill(0));
  const curRef = useRef<number[]>(Array(count).fill(0));
  const loopRef = useRef(0);
  const reducedMotionRef = useRef(false);

  useEffect(() => {
    reducedMotionRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    targetRef.current = Array(count).fill(0);
    curRef.current = Array(count).fill(0);
    setFactors(Array(count).fill(0));
  }, [count]);

  useEffect(() => () => cancelAnimationFrame(loopRef.current), []);

  const startLoop = () => {
    if (loopRef.current) return;
    const step = () => {
      const tgt = targetRef.current;
      const cur = curRef.current;
      let moving = false;
      for (let i = 0; i < cur.length; i++) {
        const d = (tgt[i] ?? 0) - cur[i];
        if (Math.abs(d) > 0.001) { cur[i] += d * 0.2; moving = true; }
        else cur[i] = tgt[i] ?? 0;
      }
      setFactors([...cur]);
      loopRef.current = moving ? requestAnimationFrame(step) : 0;
    };
    loopRef.current = requestAnimationFrame(step);
  };

  const onMove = (e: React.MouseEvent) => {
    if (reducedMotionRef.current) return;
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    // Slot centers from the UNIFORM layout (rect width / count) — same
    // "stable collapsed-layout centers" trick as the original, so the
    // magnify peak tracks the cursor without feedback jitter as cards grow.
    const slotW = (rect.width - gap * (count - 1)) / count;
    targetRef.current = Array.from({ length: count }, (_, i) => {
      const center = i * (slotW + gap) + slotW / 2;
      const dist = Math.abs(cx - center);
      const f = Math.max(0, 1 - dist / influence);
      return f * f * (3 - 2 * f); // smoothstep falloff
    });
    startLoop();
  };

  const onLeave = () => {
    targetRef.current = Array(count).fill(0);
    startLoop();
  };

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ display: "flex", alignItems: "stretch", gap }}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
    >
      {children.map((child, i) => (
        <div
          key={i}
          style={{
            flexBasis: 0,
            flexGrow: 1 + (factors[i] ?? 0) * growMax,
            minWidth: 0,
            display: "flex",
            willChange: "flex-grow",
          }}
        >
          {child}
        </div>
      ))}
    </div>
  );
}
