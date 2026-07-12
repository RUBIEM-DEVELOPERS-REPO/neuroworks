import { useEffect, useRef } from "react";

// Text rendered as a field of colored particles that assemble on load and
// get pushed outward from the cursor like a small void carving through a
// star field. Adapted from a Framer-marketplace component (Pixel Drift);
// kept the sampling/formation/cursor-repulsion algorithm close to the
// original (canvas-sampled glyph mask -> particle field, rate-based
// formation so an interrupted appear/dissolve continues from its current
// state instead of snapping), stripped Framer's property-control plumbing
// (RenderTarget/static-export branching never applies outside Framer's own
// canvas — always runs the live interactive path here).
//
// Two things changed for this app specifically, not just trimmed:
//   - Font: the original hardcoded a system-ui stack for the sampled glyphs,
//     which would render the wordmark in a different typeface than the rest
//     of the app's headings (Plus Jakarta Sans, set app-wide in the
//     2026-07-12 type pass). Takes a fontFamily prop, defaulting to that
//     same display stack, so the particle text matches everywhere else.
//   - Sizing: the original's outer div force-set `minWidth: 800, minHeight:
//     300` as a floor for Framer's preview harness when no size was passed.
//     That would blow out a 240px sidebar. Dropped — this component is
//     always given a real, explicitly-sized container by its caller.
//
// Also added a prefers-reduced-motion check (paints the settled text
// immediately, no formation animation, no ongoing cursor interaction) and a
// document-visibility pause on the post-formation idle loop, matching the
// same conventions as GlitterBackground.

type TransitionValue = { duration?: number; ease?: string | number[] };

function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  return (x: number): number => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0, hi = 1, t = x;
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      const sx = sampleX(mid);
      if (Math.abs(sx - x) < 1e-6) { t = mid; break; }
      if (sx < x) lo = mid; else hi = mid;
      t = mid;
    }
    return sampleY(t);
  };
}

function resolveEasingFn(trans: TransitionValue | undefined): (t: number) => number {
  const linear = (t: number) => t;
  if (!trans) return linear;
  const ease = trans.ease;
  if (Array.isArray(ease) && ease.length === 4) {
    const [x1, y1, x2, y2] = ease as [number, number, number, number];
    return cubicBezier(x1, y1, x2, y2);
  }
  if (typeof ease === "string") {
    switch (ease) {
      case "easeIn": return t => t * t;
      case "easeOut": return t => 1 - (1 - t) * (1 - t);
      case "easeInOut": return t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
      default: return linear;
    }
  }
  return linear;
}

type PixelDriftTextProps = {
  text: string;
  colors?: string[];
  fontFamily?: string;
  fontSize?: number;
  particleSize?: number;
  particleCount?: number;
  mouseEnabled?: boolean;
  mouseRadius?: number;
  mouseForce?: number;
  transition?: TransitionValue;
  className?: string;
};

export function PixelDriftText({
  text,
  // No explicit colors = follow the theme: particles take --c-cream-50 (the
  // heading color), which is near-white in dark mode and near-black in light
  // mode. A hardcoded white default made the wordmark INVISIBLE the moment
  // the operator flipped to light mode (found 2026-07-12 during the
  // bright-mode pass). Pass explicit colors to opt out of theme-following.
  colors,
  fontFamily = "'Plus Jakarta Sans', system-ui, sans-serif",
  fontSize = 22,
  particleSize = 4,
  // Maxed out (the sampling stride formula caps useful density at 50) — a
  // ~20px glyph has thin enough strokes that anything sparser under-samples
  // it into scattered dots instead of a readable word shape.
  particleCount = 50,
  mouseEnabled = true,
  mouseRadius = 34,
  mouseForce = 14,
  transition = { duration: 0.9, ease: "easeOut" },
  className,
}: PixelDriftTextProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const pointerRef = useRef({ x: -99999, y: -99999, active: false });
  const formValRef = useRef(0);
  const lastFrameRef = useRef<number | null>(null);
  const hiddenRef = useRef(true);
  const reverseRef = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const themeColor = () =>
      getComputedStyle(document.documentElement).getPropertyValue("--c-cream-50").trim() || "#ffffff";
    let palette = colors && colors.length > 0 ? colors : [themeColor()];
    // Follow live theme flips — the draw loop reads `palette` every frame,
    // so reassigning it recolors the settled particles on the next frame.
    // redrawSettled is bound after staticDraw is defined below; only the
    // reduced-motion path needs an explicit repaint (no running loop).
    let redrawSettled: (() => void) | null = null;
    const themeObserver = colors && colors.length > 0 ? null : new MutationObserver(() => {
      palette = [themeColor()];
      redrawSettled?.();
    });
    themeObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    let count = 0;
    let ox = new Float32Array(0), oy = new Float32Array(0);
    let sx = new Float32Array(0), sy = new Float32Array(0);
    let px = new Float32Array(0), py = new Float32Array(0);
    let repX = new Float32Array(0), repY = new Float32Array(0);
    let cIdx = new Uint8Array(0);

    let prevMx = -99999, prevMy = -99999, mouseSpeed = 0;
    let smoothX = -99999, smoothY = -99999;
    let cssW = 0, cssH = 0, dpr = 1;
    let visible = document.visibilityState !== "hidden";

    const sampleText = () => {
      const W = cssW, H = cssH;
      if (W <= 0 || H <= 0) return;

      const off = document.createElement("canvas");
      off.width = Math.max(1, Math.floor(W * dpr));
      off.height = Math.max(1, Math.floor(H * dpr));
      const offCtx = off.getContext("2d", { willReadFrequently: true });
      if (!offCtx) return;
      offCtx.scale(dpr, dpr);

      // Shrink-to-fit so the wordmark never spills past its container
      // (where it'd be clipped and sampled cut) — always on, not gated
      // behind an autoFit toggle, since this component always renders
      // inside a fixed-size slot in the sidebar.
      let effectiveSize = Math.max(8, fontSize);
      offCtx.font = `700 ${effectiveSize}px ${fontFamily}`;
      const maxW = W * 0.94, maxH = H * 0.9;
      const gm = offCtx.measureText(text || "");
      const gW = gm.width || 1;
      const gH = (gm.actualBoundingBoxAscent || effectiveSize * 0.8) + (gm.actualBoundingBoxDescent || effectiveSize * 0.2);
      const fitScale = Math.min(1, maxW / gW, maxH / gH);
      if (fitScale < 1) effectiveSize = Math.max(8, effectiveSize * fitScale);

      offCtx.clearRect(0, 0, W, H);
      offCtx.fillStyle = "#fff";
      offCtx.font = `700 ${effectiveSize}px ${fontFamily}`;
      offCtx.textAlign = "center";
      offCtx.textBaseline = "middle";
      offCtx.fillText(text || "", W / 2, H / 2);

      const img = offCtx.getImageData(0, 0, Math.floor(W * dpr), Math.floor(H * dpr));
      const data = img.data;

      const pCount = Math.max(1, Math.min(50, particleCount));
      // 150/count (Framer original) gave stride 3 at max density — too coarse
      // for a ~22px sidebar glyph once the dots shrank to 1px (letters read
      // as disconnected speckle). 100/count → stride 2 at count 50: ~2.25x
      // the particles on a tiny canvas, still trivial to animate.
      const stride = Math.max(2, Math.round(100 / pCount));

      let candidates = 0;
      for (let y = 0; y < H; y += stride) {
        for (let x = 0; x < W; x += stride) {
          const ix = Math.floor(x * dpr), iy = Math.floor(y * dpr);
          if (data[(iy * img.width + ix) * 4 + 3] > 128) candidates++;
        }
      }

      const downsample = candidates > 6000 ? Math.ceil(candidates / 6000) : 1;
      const allocCount = Math.min(candidates, 6000);
      const newOx = new Float32Array(allocCount), newOy = new Float32Array(allocCount);
      const newSx = new Float32Array(allocCount), newSy = new Float32Array(allocCount);
      const newPx = new Float32Array(allocCount), newPy = new Float32Array(allocCount);
      const newC = new Uint8Array(allocCount);

      let i = 0, seen = 0;
      for (let y = 0; y < H && i < allocCount; y += stride) {
        for (let x = 0; x < W && i < allocCount; x += stride) {
          const ix = Math.floor(x * dpr), iy = Math.floor(y * dpr);
          if (data[(iy * img.width + ix) * 4 + 3] > 128) {
            if (seen % downsample === 0) {
              newOx[i] = x; newOy[i] = y;
              const ang = Math.random() * Math.PI * 2;
              const rad = Math.max(W, H) * (0.6 + Math.random() * 0.5);
              const rx = W / 2 + Math.cos(ang) * rad;
              const ry = H / 2 + Math.sin(ang) * rad;
              newSx[i] = rx; newSy[i] = ry;
              newPx[i] = rx; newPy[i] = ry;
              newC[i] = Math.floor(Math.random() * palette.length);
              i++;
            }
            seen++;
          }
        }
      }

      count = i;
      ox = newOx; oy = newOy; sx = newSx; sy = newSy; px = newPx; py = newPy;
      repX = new Float32Array(allocCount); repY = new Float32Array(allocCount);
      cIdx = newC;
      formValRef.current = 0;
      lastFrameRef.current = null;
    };

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const w = Math.floor(rect.width), h = Math.floor(rect.height);
      if (w <= 0 || h <= 0) return;
      dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      cssW = w; cssH = h;
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sampleText();
    };

    resize();

    // Canvas text doesn't participate in web-font loading the way DOM text
    // does — a fillText() call before the font's actually loaded silently
    // measures/draws against the fallback font instead (no error, no event).
    // Google Fonts' `display=swap` means that race is real here. Re-sample
    // once the real font is confirmed loaded so the glyph mask is sampled
    // against actual Plus Jakarta Sans metrics, not system-ui's — handled
    // per render mode below (reducedMotion has no ongoing loop to pick up
    // a fresh sample on its own, so it re-settles + redraws explicitly).
    let cancelled = false;
    document.fonts.ready.then(() => {
      if (cancelled) return;
      resize();
      if (reducedMotion) {
        hiddenRef.current = false;
        reverseRef.current = false;
        for (let i = 0; i < count; i++) { px[i] = ox[i]; py[i] = oy[i]; }
        drawFrame();
      }
    }).catch(() => {});

    reverseRef.current = false;
    hiddenRef.current = true;
    formValRef.current = 0;

    const ro = new ResizeObserver(() => resize());
    ro.observe(container);

    const onVisibility = () => { visible = document.visibilityState !== "hidden"; };
    document.addEventListener("visibilitychange", onVisibility);

    const onMove = (e: PointerEvent) => {
      if (!mouseEnabled) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = rect.width > 0 ? cssW / rect.width : 1;
      const scaleY = rect.height > 0 ? cssH / rect.height : 1;
      const mx = (e.clientX - rect.left) * scaleX;
      const my = (e.clientY - rect.top) * scaleY;
      if (prevMx > -9000) {
        const ddx = mx - prevMx, ddy = my - prevMy;
        mouseSpeed = Math.sqrt(ddx * ddx + ddy * ddy);
      }
      prevMx = mx; prevMy = my;
      pointerRef.current.x = mx; pointerRef.current.y = my; pointerRef.current.active = true;
    };
    const onLeave = () => {
      pointerRef.current.x = -99999; pointerRef.current.y = -99999; pointerRef.current.active = false;
      prevMx = -99999; prevMy = -99999;
    };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("pointercancel", onLeave);

    // Forms once on mount (this is a persistent sidebar element, always in
    // view — there's no scroll-triggered "onEnter" case worth wiring here).
    reverseRef.current = false;
    hiddenRef.current = false;

    const easeFn = resolveEasingFn(transition);
    const formMs = reducedMotion ? 0 : Math.max(0, (transition.duration ?? 1) * 1000);

    const drawFrame = () => {
      ctx.clearRect(0, 0, cssW, cssH);
      const pr = pointerRef.current;
      const drawSize = Math.max(1, particleSize / 4);
      const half = drawSize / 2;

      const now = performance.now();
      const last = lastFrameRef.current ?? now;
      const dt = Math.min(64, Math.max(0, now - last));
      lastFrameRef.current = now;
      const reverse = reverseRef.current;
      const target = reverse ? 0 : 1;
      let v = formValRef.current;
      if (formMs <= 0) {
        v = target;
      } else {
        const stepv = dt / formMs;
        if (v < target) v = Math.min(target, v + stepv);
        else if (v > target) v = Math.max(target, v - stepv);
      }
      formValRef.current = v;
      if (reverse && v <= 0) hiddenRef.current = true;
      if (hiddenRef.current) return;
      const forming = v < 1;
      const factor = easeFn(v);

      const hitSpeed = mouseSpeed;
      mouseSpeed *= 0.88;
      const active = !forming && mouseEnabled && pr.active;
      if (active) {
        const lerpFactor = Math.max(0.08, 0.3 - hitSpeed * 0.006);
        if (smoothX < -9000) { smoothX = pr.x; smoothY = pr.y; }
        else { smoothX += (pr.x - smoothX) * lerpFactor; smoothY += (pr.y - smoothY) * lerpFactor; }
      } else {
        smoothX = -99999; smoothY = -99999;
      }
      const mx = smoothX, my = smoothY;
      const repCutoff = Math.max(1, mouseRadius);
      const repCutoffSq = repCutoff * repCutoff;

      const buckets: number[][] = palette.map(() => []);

      for (let i = 0; i < count; i++) {
        const oxi = ox[i], oyi = oy[i];
        if (forming) {
          px[i] = sx[i] + (oxi - sx[i]) * factor;
          py[i] = sy[i] + (oyi - sy[i]) * factor;
          buckets[cIdx[i]].push(i);
          continue;
        }
        let inZone = false;
        if (active) {
          const dx = oxi - mx, dy = oyi - my;
          const distSq = dx * dx + dy * dy;
          if (distSq > 0 && distSq < repCutoffSq) {
            const dist = Math.sqrt(distSq);
            const nx = dx / dist, ny = dy / dist;
            const falloff = 1 - dist / repCutoff;
            const push = falloff * hitSpeed * mouseForce * 0.05;
            repX[i] += nx * push; repY[i] += ny * push;
            const targetRepX = nx * (repCutoff - dist), targetRepY = ny * (repCutoff - dist);
            repX[i] += (targetRepX - repX[i]) * 0.06;
            repY[i] += (targetRepY - repY[i]) * 0.06;
            inZone = true;
          }
        }
        if (!inZone) { repX[i] *= 0.97; repY[i] *= 0.97; }
        px[i] = oxi + repX[i]; py[i] = oyi + repY[i];
        buckets[cIdx[i]].push(i);
      }

      ctx.globalAlpha = forming ? Math.min(1, Math.max(0, factor)) : 1;
      for (let b = 0; b < buckets.length; b++) {
        const bucket = buckets[b];
        if (bucket.length === 0) continue;
        ctx.fillStyle = palette[b];
        for (let k = 0; k < bucket.length; k++) {
          const i = bucket[k];
          ctx.fillRect(px[i] - half, py[i] - half, drawSize, drawSize);
        }
      }
      ctx.globalAlpha = 1;
    };

    if (reducedMotion) {
      // Settle straight to the formed text, no animation, no cursor
      // interaction loop — draw once and stop.
      hiddenRef.current = false;
      reverseRef.current = false;
      for (let i = 0; i < count; i++) { px[i] = ox[i]; py[i] = oy[i]; }
      drawFrame();
      redrawSettled = () => drawFrame(); // theme flip repaints the settled frame
      return () => {
        cancelled = true;
        ro.disconnect();
        themeObserver?.disconnect();
        document.removeEventListener("visibilitychange", onVisibility);
        canvas.removeEventListener("pointermove", onMove);
        canvas.removeEventListener("pointerleave", onLeave);
        canvas.removeEventListener("pointercancel", onLeave);
      };
    }

    const loop = () => {
      if (visible) drawFrame();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      cancelled = true;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      themeObserver?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("pointercancel", onLeave);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, (colors ?? []).join("|"), fontFamily, fontSize, particleSize, particleCount, mouseEnabled, mouseRadius, mouseForce, transition.duration, transition.ease]);

  return (
    <div ref={containerRef} className={className} style={{ position: "relative", width: "100%", height: "100%", overflow: "visible" }}>
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} />
    </div>
  );
}
