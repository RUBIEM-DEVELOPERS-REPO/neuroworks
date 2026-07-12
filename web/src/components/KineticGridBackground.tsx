import { useEffect, useRef } from "react";

// A reactive dot grid, pulled toward the cursor within a radius, with a
// fading trail line — the animation that was drafted earlier this session
// alongside GlitterBackground/PixelDriftText but held back with no assigned
// placement. Now the Login page's background. Adapted from a
// Framer-marketplace component (Kinetic Grid), not just trimmed:
//   - Dropped the Framer static-renderer branch (useIsStaticRenderer/
//     RenderTarget never applies outside Framer's own canvas — this always
//     runs the live interactive path).
//   - Colors switched from the original's default black/white/blue to the
//     app's own palette (ink background showing through — this renders on
//     a transparent canvas — cream dots, violet mesh lines/trail) so it
//     reads as part of this app, not a pasted-in demo.
//   - Added prefers-reduced-motion (skip the rAF loop, draw the settled
///    grid once) and document-visibility pause, matching GlitterBackground
//     and PixelDriftText's conventions.

type Dot = { hx: number; hy: number; x: number; y: number; vx: number; vy: number };

type Props = {
  dotColor?: string;
  lineColor?: string;
  trailColor?: string;
  spacing?: number;
  radius?: number;
  strength?: number;
};

export function KineticGridBackground({
  dotColor = "#c7d3ea",
  lineColor = "#7d57f6",
  trailColor = "#e46d4c",
  spacing = 34,
  radius = 220,
  strength = 4,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const GAP = Math.max(8, spacing);
    const R = Math.max(1, radius);
    const PULL = (Math.max(1, Math.min(10, strength)) / 10) * 4;

    let W = 1, H = 1;
    let cols: Dot[][] = [];
    let dots: Dot[] = [];
    const mouse = { x: -9999, y: -9999, active: false };
    const trail: { x: number; y: number; t: number }[] = [];

    const build = (mw?: number, mh?: number) => {
      const r = host.getBoundingClientRect();
      W = Math.max(1, Math.floor(mw ?? r.width));
      H = Math.max(1, Math.floor(mh ?? r.height));
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(W * dpr);
      canvas.height = Math.floor(H * dpr);
      canvas.style.width = W + "px";
      canvas.style.height = H + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      cols = []; dots = [];
      const nCols = Math.floor(W / GAP) + 2;
      const nRows = Math.floor(H / GAP) + 2;
      for (let c = 0; c < nCols; c++) {
        const col: Dot[] = [];
        for (let rIdx = 0; rIdx < nRows; rIdx++) {
          const hx = c * GAP, hy = rIdx * GAP;
          const d = { hx, hy, x: hx, y: hy, vx: 0, vy: 0 };
          col.push(d); dots.push(d);
        }
        cols.push(col);
      }
    };

    const drawSettled = () => {
      ctx.clearRect(0, 0, W, H);
      ctx.globalAlpha = 0.12;
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 0.75;
      for (let c = 0; c < cols.length; c++) {
        for (let rIdx = 0; rIdx < cols[c].length; rIdx++) {
          const d = cols[c][rIdx];
          const right = cols[c + 1]?.[rIdx];
          const down = cols[c]?.[rIdx + 1];
          if (right) { ctx.beginPath(); ctx.moveTo(d.hx, d.hy); ctx.lineTo(right.hx, right.hy); ctx.stroke(); }
          if (down) { ctx.beginPath(); ctx.moveTo(d.hx, d.hy); ctx.lineTo(down.hx, down.hy); ctx.stroke(); }
        }
      }
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = dotColor;
      for (const d of dots) { ctx.beginPath(); ctx.arc(d.hx, d.hy, 1.2, 0, 2 * Math.PI); ctx.fill(); }
      ctx.globalAlpha = 1;
    };

    build();

    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      build(cr?.width, cr?.height);
      if (reducedMotion) drawSettled();
    });
    ro.observe(host);

    if (reducedMotion) {
      drawSettled();
      return () => ro.disconnect();
    }

    const setMouse = (clientX: number, clientY: number) => {
      const r = canvas.getBoundingClientRect();
      const mx = clientX - r.left, my = clientY - r.top;
      mouse.x = mx; mouse.y = my; mouse.active = true;
      const now = performance.now();
      trail.push({ x: mx, y: my, t: now });
      if (trail.length > 80) trail.shift();
    };
    const onMove = (e: MouseEvent) => setMouse(e.clientX, e.clientY);
    const onLeave = () => { mouse.active = false; mouse.x = -9999; mouse.y = -9999; };
    const onTouch = (e: TouchEvent) => { const t = e.touches[0]; if (t) setMouse(t.clientX, t.clientY); };

    host.addEventListener("mousemove", onMove);
    host.addEventListener("mouseleave", onLeave);
    host.addEventListener("touchmove", onTouch, { passive: true });
    host.addEventListener("touchend", onLeave);

    let raf = 0;
    let paused = document.hidden;
    const onVisibility = () => {
      paused = document.hidden;
      if (!paused && !raf) raf = requestAnimationFrame(frame);
    };
    document.addEventListener("visibilitychange", onVisibility);

    const frame = () => {
      if (paused) { raf = 0; return; }
      const m = mouse;
      ctx.clearRect(0, 0, W, H);

      for (const d of dots) {
        let ax = (d.hx - d.x) * 0.08;
        let ay = (d.hy - d.y) * 0.08;
        if (m.active) {
          const dx = m.x - d.x, dy = m.y - d.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < R && dist > 0.001) {
            const f = (1 - dist / R) * PULL;
            ax += (dx / dist) * f; ay += (dy / dist) * f;
          }
        }
        d.vx = (d.vx + ax) * 0.82;
        d.vy = (d.vy + ay) * 0.82;
        d.x += d.vx; d.y += d.vy;
      }

      for (let c = 0; c < cols.length; c++) {
        for (let rIdx = 0; rIdx < cols[c].length; rIdx++) {
          const d = cols[c][rIdx];
          const right = cols[c + 1]?.[rIdx];
          const down = cols[c]?.[rIdx + 1];
          const prox = m.active ? Math.max(0, 1 - Math.sqrt((m.x - d.x) ** 2 + (m.y - d.y) ** 2) / R) : 0;
          if (right) {
            ctx.globalAlpha = 0.05 + prox * 0.6; ctx.strokeStyle = lineColor; ctx.lineWidth = 0.5 + prox * 1.5;
            ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(right.x, right.y); ctx.stroke();
          }
          if (down) {
            ctx.globalAlpha = 0.05 + prox * 0.6; ctx.strokeStyle = lineColor; ctx.lineWidth = 0.5 + prox * 1.5;
            ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(down.x, down.y); ctx.stroke();
          }
        }
      }

      for (const d of dots) {
        const prox = m.active ? Math.max(0, 1 - Math.sqrt((m.x - d.x) ** 2 + (m.y - d.y) ** 2) / R) : 0;
        ctx.globalAlpha = 0.18 + prox * 0.7;
        ctx.fillStyle = dotColor;
        ctx.beginPath(); ctx.arc(d.x, d.y, 0.8 + prox * 2.2, 0, 2 * Math.PI); ctx.fill();
      }

      const now = performance.now();
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      for (let i = 1; i < trail.length; i++) {
        const a = trail[i - 1], b = trail[i];
        const age = now - b.t;
        if (age > 260) continue;
        ctx.globalAlpha = Math.max(0, 1 - age / 260) * 0.8;
        ctx.strokeStyle = trailColor; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }

      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      host.removeEventListener("mousemove", onMove);
      host.removeEventListener("mouseleave", onLeave);
      host.removeEventListener("touchmove", onTouch);
      host.removeEventListener("touchend", onLeave);
    };
  }, [dotColor, lineColor, trailColor, spacing, radius, strength]);

  return (
    <div
      ref={hostRef}
      aria-hidden
      className="absolute inset-0"
      style={{ pointerEvents: "auto" }}
    >
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} />
    </div>
  );
}
