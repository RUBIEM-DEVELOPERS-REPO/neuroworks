---
name: motion-design-pass
description: Audit an existing UI for motion opportunities and propose a tight, principled set of additions. The "taste" skill — when to animate, when not to, what easing, what duration, accessibility guard rails.
applies_to: [draft-memo, draft-other]
---

# Skill: Motion design pass

## When to use this

The user has a working UI and wants it to feel "more alive". Your job is
to recommend the smallest set of motion that gives the biggest perceived
quality lift, NOT to animate everything.

## Process

1. **Catalogue the surfaces.** List the views, then for each one identify
   the moments where state changes (load → loaded, idle → busy, success,
   error, hover, focus).
2. **Rank by attention.** The operator's eyes spend more time on some
   surfaces than others. Motion on a never-visited admin page is wasted.
3. **Pick categories**, not individual animations:
   - **Status transitions** — the highest-value category in apps with
     async work (job state, save state).
   - **Skeletons** — replace text loading states; improves perceived speed.
   - **Page transitions** — cheap, applied once, lifts the whole app.
   - **Microinteractions** — buttons / cards / hover lifts. Adds tactility.
   - **Thematic moments** — one or two per app (e.g. an agent-thinking
     shimmer). More than two = noise.
4. **Specify each animation** with: trigger, property, duration, easing,
   reduced-motion fallback.
5. **Add the a11y guard rail.** Every animation goes through one
   `@media (prefers-reduced-motion: reduce)` block that disables or
   neutralises it. State this is non-negotiable.

## Duration cheat-sheet

| Purpose | Range | Easing |
|---|---|---|
| Microinteraction (button press, hover) | 80-200ms | `ease-out` or `cubic-bezier(0.34, 1.56, 0.64, 1)` for spring |
| Page / panel transition | 200-300ms | `ease-out` |
| Status feedback (success pop, toast) | 220-360ms | spring or `ease-out` |
| Loading / pending (loops) | 1.2-1.8s | `ease-in-out` |
| Marketing flourish (one-off entrance) | 400-600ms | `ease-out` with overshoot |

Anything over 600ms in a daily-use UI feels sluggish. Anything under
100ms is invisible and burns CPU for nothing.

## Property cheat-sheet

| Property | Cost | Use for |
|---|---|---|
| `transform`, `opacity` | GPU-cheap (Composite-only) | Almost everything |
| `filter` (blur, drop-shadow) | Moderate | Glow effects, sparingly |
| `width`, `height`, `top`, `left` | Layout reflow — expensive | Avoid in keyframes |
| `background-position` | Composite-only | Shimmer effects |

## Output shape

```
# Motion design pass — <App name> · <date>

## Surfaces (ranked)
| Surface | Attention | Current motion | Propose |
|---|---|---|---|
| Dashboard | High | none | skeletons, fade-up cards |
| ... | ... | ... | ... |

## Proposed animations (4-8 total)
### <Name> — <where>
- Trigger: <when does it run>
- Property: <transform | opacity | ...>
- Duration: <ms>
- Easing: <name>
- Reduced-motion: <how it collapses>
- Implementation note: <one-liner — CSS class, library, etc.>

## Accessibility
- All animations sit inside one `@media (prefers-reduced-motion: reduce)`
  block that disables them.
- No flashes faster than 3Hz (seizure safety).
- Focus states animate INSTANTLY (motion delays = perceived sluggishness
  for keyboard users).

## Not recommended (and why)
- <Thing the operator might ask for that hurts UX> — <reason>
```

## Rules

- **Less is more.** 4-8 animations across a whole app is plenty. 30 is
  too many.
- **Animate state, not decoration.** A page that scales-in on every
  render is a page that's annoying to use after the second visit.
- **Reduced-motion is a checkbox, not a feature.** Ship with it on day
  one or you owe an apology to a vestibular-sensitive user.
- **Don't ship animation that gates the user.** They click → animation
  plays → after 300ms they see the result is wrong. Optimise for the
  90% case (correct answer) and animate around it, not in front of it.

## Pitfalls

- Animating layout properties (width, top) instead of transforms — paint
  jank.
- Coupling animation to data — every list re-render triggers an entrance
  animation that flashes.
- Using a library (framer-motion, react-spring) when one CSS keyframe
  would do — bundle bloat for no win.
- Spec without timing — "fade in" with no duration is unimplementable.
