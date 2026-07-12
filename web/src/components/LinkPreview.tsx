import { useRef, useState, type CSSProperties, type ReactNode } from "react";

// Drop-in replacement for a plain <a target="_blank">: same href/className/
// children contract, plus a floating preview image on hover that leans
// toward the cursor. Adapted from a Framer-marketplace component (Link
// Preview) — dropped framer-motion (not a dependency here, and a hover
// fade doesn't need a spring physics library) in favor of a plain CSS
// transition, and dropped the custom-image prop path since every caller in
// this app links to a real external URL, never an uploaded asset.
//
// Image comes from api.microlink.io's og:image proxy — a public, keyless
// metadata-scraping API; only the target URL is sent, nothing app-specific.
// If a site has no og:image (or microlink can't reach it), the <img> just
// fails to load and onError hides the frame — never a broken-image icon.

type Props = {
  href: string;
  children: ReactNode;
  className?: string;
  previewWidth?: number;
  previewHeight?: number;
};

export function LinkPreview({ href, children, className, previewWidth = 280, previewHeight = 160 }: Props) {
  const [hovered, setHovered] = useState(false);
  const [broken, setBroken] = useState(false);
  const [lean, setLean] = useState(0); // -1..1, cursor position across the link
  const containerRef = useRef<HTMLSpanElement>(null);

  const onMove = (e: React.MouseEvent) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / Math.max(1, rect.width);
    setLean(Math.max(-1, Math.min(1, ratio * 2 - 1)));
  };

  const show = hovered && !broken;
  const imgSrc = `https://api.microlink.io/?url=${encodeURIComponent(href)}&embed=image.url`;

  const previewStyle: CSSProperties = {
    position: "absolute",
    left: "50%",
    bottom: "calc(100% + 10px)",
    transform: `translateX(calc(-50% + ${lean * 24}px)) translateY(${show ? 0 : 8}px) scale(${show ? 1 : 0.96})`,
    marginLeft: 0,
    width: previewWidth,
    height: previewHeight,
    borderRadius: 10,
    overflow: "hidden",
    background: "var(--c-ink-850, #171d2c)",
    border: "1px solid rgba(255,255,255,0.08)",
    boxShadow: "0 18px 40px rgba(0,0,0,0.35), 0 2px 8px rgba(0,0,0,0.25)",
    opacity: show ? 1 : 0,
    pointerEvents: "none",
    zIndex: 30,
    transition: "opacity 160ms ease, transform 160ms ease",
  };

  return (
    <span
      ref={containerRef}
      style={{ position: "relative", display: "inline-block" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onMouseMove={onMove}
    >
      <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
        {children}
      </a>
      <div style={previewStyle}>
        {!broken && (
          <img
            src={imgSrc}
            alt=""
            draggable={false}
            onError={() => setBroken(true)}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        )}
      </div>
    </span>
  );
}
