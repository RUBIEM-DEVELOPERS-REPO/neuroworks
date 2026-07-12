import { useId, useMemo } from "react";

// Words that blur-morph into each other on an infinite loop, with an SVG
// "gooey" threshold filter so the crossfade reads as one word melting into
// the next rather than two overlapping ghosts. Adapted from a
// Framer-marketplace component (Text Morph) — dropped the Framer property
// controls/Tag plumbing and the fixed-frame sizing (this is an inline label
// replacement that sizes to its content, not an 800x240 hero frame), kept
// the keyframe math (per-word slot = morph + hold, each word animates the
// full cycle offset by its slot so word i's morph-out overlaps word i+1's
// morph-in) and the feColorMatrix gooey filter verbatim.
//
// prefers-reduced-motion: renders the first word statically, no animation,
// no filter — same convention as the other adapted animation components.

type Props = {
  words: string[];
  /** Seconds one word takes to morph into the next. */
  morphSeconds?: number;
  /** Seconds a word stays fully visible between morphs. */
  holdSeconds?: number;
  className?: string;
};

export function TextMorph({ words, morphSeconds = 1, holdSeconds = 2.5, className }: Props) {
  const rawId = useId();
  const safeId = rawId.replace(/[:]/g, "");
  const filterId = `tm-thr-${safeId}`;
  const animName = `tm-rot-${safeId}`;

  const wordList = useMemo(() => words.map(w => w.trim()).filter(Boolean), [words]);
  const reducedMotion =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (wordList.length === 0) return null;
  if (reducedMotion || wordList.length === 1) {
    return <span className={className}>{wordList[0]}</span>;
  }

  const morph = Math.max(0.1, morphSeconds);
  const hold = Math.max(0, holdSeconds);
  const count = wordList.length;
  const slot = morph + hold;
  const cycle = slot * count;
  const pct = (s: number) => Math.min(100, (s / cycle) * 100).toFixed(4);
  const mIn = pct(morph);
  const mHold = pct(morph + hold);
  const mOut = pct(2 * morph + hold);

  const keyframes = `
@keyframes ${animName} {
  0% { opacity: 0; filter: blur(8px); transform: translate(-50%, -50%) scale(0.85); }
  ${mIn}% { opacity: 1; filter: blur(0px); transform: translate(-50%, -50%) scale(1); }
  ${mHold}% { opacity: 1; filter: blur(0px); transform: translate(-50%, -50%) scale(1); }
  ${mOut}%, 100% { opacity: 0; filter: blur(8px); transform: translate(-50%, -50%) scale(1.15); }
}
`;

  const longest = wordList.reduce((acc, w) => (w.length > acc.length ? w : acc), "");

  return (
    <span className={className} style={{ position: "relative", display: "inline-block" }}>
      <style>{keyframes}</style>
      <svg style={{ position: "absolute", width: 0, height: 0, pointerEvents: "none" }} aria-hidden>
        <defs>
          <filter id={filterId}>
            <feColorMatrix
              in="SourceGraphic"
              type="matrix"
              values="1 0 0 0 0
                      0 1 0 0 0
                      0 0 1 0 0
                      0 0 0 25 -9"
              result="goo"
            />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
        </defs>
      </svg>
      <span style={{ position: "relative", display: "inline-block", filter: `url(#${filterId})` }}>
        {/* Width anchor: longest word reserves space so layout never shifts. */}
        <span style={{ visibility: "hidden", whiteSpace: "nowrap", display: "inline-block" }}>{longest}</span>
        {wordList.map((word, i) => (
          <span
            key={`${word}-${i}`}
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              opacity: 0,
              whiteSpace: "nowrap",
              animation: `${animName} ${cycle}s ${(slot * i).toFixed(3)}s infinite ease-in-out`,
              willChange: "opacity, filter, transform",
            }}
          >
            {word}
          </span>
        ))}
      </span>
    </span>
  );
}
