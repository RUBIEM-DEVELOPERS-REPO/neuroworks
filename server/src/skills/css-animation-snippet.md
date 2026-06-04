---
name: css-animation-snippet
description: Generate ready-to-paste Tailwind / CSS keyframe code for a named effect (shimmer, slide-up, scale-in, breathing glow, etc.). Includes prefers-reduced-motion fallback every time.
applies_to: [code-writing, draft-other]
---

# Skill: CSS animation snippet

## Goal

The user names an effect; you output the keyframes + utility class + the
reduced-motion guard, ready to drop into a stylesheet. No prose-wrapping
the code in five paragraphs of explanation — the user asked for code.

## Standard catalogue

For these named effects, output the canonical snippet. Variations on
duration / easing are fine; the SHAPE is fixed.

### shimmer (for skeletons)

```css
@keyframes nw-skeleton-shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
.skeleton {
  background:
    linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.04) 50%, rgba(255,255,255,0) 100%),
    var(--surface, #222);
  background-size: 200% 100%, 100% 100%;
  background-repeat: no-repeat;
  border-radius: 6px;
  animation: nw-skeleton-shimmer 1.4s ease-in-out infinite;
}
```

### fade-up (page / list entrance)

```css
@keyframes nw-fade-up {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
.nw-fade-up { animation: nw-fade-up 280ms ease-out both; }
```

### scale-in (modal, popover, toast pop)

```css
@keyframes nw-scale-in {
  from { opacity: 0; transform: scale(0.96); }
  to   { opacity: 1; transform: scale(1); }
}
.nw-scale-in { animation: nw-scale-in 220ms ease-out both; }
```

### pop-check (success state)

```css
@keyframes nw-pop-check {
  0%   { opacity: 0; transform: scale(0.4); }
  60%  { opacity: 1; transform: scale(1.15); }
  100% { opacity: 1; transform: scale(1); }
}
.nw-pop-check { animation: nw-pop-check 360ms cubic-bezier(0.34, 1.56, 0.64, 1) both; }
```

### thinking-dots (loading indicator)

```css
@keyframes nw-thinking-dot {
  0%, 80%, 100% { opacity: 0.25; transform: translateY(0); }
  40%           { opacity: 1;    transform: translateY(-2px); }
}
.nw-thinking-dots > span {
  display: inline-block;
  width: 4px; height: 4px;
  background: currentColor;
  border-radius: 50%;
  margin: 0 1px;
  animation: nw-thinking-dot 1.2s infinite ease-in-out both;
}
.nw-thinking-dots > span:nth-child(1) { animation-delay: -0.32s; }
.nw-thinking-dots > span:nth-child(2) { animation-delay: -0.16s; }
```

Usage: `<span class="nw-thinking-dots"><span/><span/><span/></span>`

### breathing-glow (active state, e.g. running agent)

```css
@keyframes nw-breath {
  0%, 100% { box-shadow: 0 0 0 0 rgba(126, 78, 239, 0.45); }
  50%      { box-shadow: 0 0 0 6px rgba(126, 78, 239, 0); }
}
.nw-active { animation: nw-breath 2.2s ease-in-out infinite; border-radius: 9999px; }
```

### slide-up (toast)

```css
@keyframes nw-toast-slide {
  from { opacity: 0; transform: translateY(12px) scale(0.96); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
.nw-toast { animation: nw-toast-slide 260ms cubic-bezier(0.34, 1.56, 0.64, 1) both; }
```

## The reduced-motion block

ALWAYS include this once at the end of the stylesheet. Group every
class you've defined into one media query.

```css
@media (prefers-reduced-motion: reduce) {
  .skeleton,
  .nw-fade-up, .nw-scale-in, .nw-pop-check,
  .nw-thinking-dots > span, .nw-active, .nw-toast {
    animation: none !important;
    transition: none !important;
  }
  .nw-fade-up, .nw-scale-in { opacity: 1 !important; transform: none !important; }
}
```

## Tailwind alternative

If the project uses Tailwind, prefer Tailwind classes for SIMPLE cases:

| Effect | Tailwind |
|---|---|
| fade | `transition-opacity opacity-0 → opacity-100` |
| scale on hover | `transition-transform hover:scale-105` |
| pulse loop | `animate-pulse` |
| spin | `animate-spin` |
| ping | `animate-ping` |

Use custom keyframes when Tailwind's built-ins are wrong shape — e.g.
shimmer, thinking-dots, breathing-glow.

## Process

1. **Name the effect.** If the user says "make it loading", ask which:
   skeleton? thinking dots? spinner?
2. **Match to the catalogue.** If it's a standard effect, output the
   canonical snippet. Don't reinvent.
3. **Add the reduced-motion block.** Non-negotiable.
4. **Sample usage.** One line of HTML/JSX showing how to apply the class.
5. **Note the cost** if it's not Composite-cheap.

## Rules

- **No `width/height/top/left` in keyframes** — they reflow. Use
  `transform` (translate/scale).
- **Default to `both` for fill-mode** on entrance animations so the
  start state is set before the keyframe runs.
- **Default to `ease-out` for entrances**, `ease-in` for exits, `ease-in-out`
  for loops.
- **No animation longer than 600ms** in a daily-use UI.

## Pitfalls

- Animating `box-shadow` instead of using `transform: scale()` — paint cost.
- Missing the reduced-motion fallback — accessibility audit failure.
- `animation: fadeIn` without `both` — element flashes before keyframe
  starts because the start state isn't applied.
- Using `@keyframes` without a unique prefix — collisions with library
  CSS. Use `nw-` (or app-specific) prefix.
