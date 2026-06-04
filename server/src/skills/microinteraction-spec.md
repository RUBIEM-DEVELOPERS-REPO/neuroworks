---
name: microinteraction-spec
description: Design a single small UI moment end-to-end — trigger, feedback, state, completion, accessibility. The unit for button presses, copy flashes, hover lifts, toast slides.
applies_to: [draft-memo, draft-other]
---

# Skill: Microinteraction spec

## What's a microinteraction

A single-purpose UI moment with one trigger and one outcome:
- Click a button → press-and-release feedback
- Click "copy" → flash + toast
- Hover a card → lift + glow
- Save a doc → spinner → check → toast
- Status changes from running → succeeded → dot pops

If it has multiple triggers or multiple outcomes, it's a flow, not a
microinteraction. Spec the moments individually.

## The 5-part spec

Every microinteraction has the same structure. If any part is missing,
the implementation will guess and probably guess wrong.

1. **Trigger** — exactly what starts it (click, hover, focus, state
   change, mount, network response). Be specific: "mousedown" vs "click"
   matters.
2. **Feedback** — what the user sees in the first 100ms. The "I felt
   that" layer.
3. **State** — what changes during the animation (color, position,
   shadow). Include start + end values.
4. **Completion** — when does it end? Does it auto-reset? Does the user
   need to act?
5. **A11y** — keyboard equivalent, screen-reader announcement, reduced-
   motion fallback.

## Timing budget

| Phase | Budget |
|---|---|
| Trigger → first pixel of feedback | <16ms (1 frame) |
| Microinteraction total duration | 80-360ms |
| Reset / cleanup | 200-400ms |

If the user has to wait >100ms after the trigger for *any* feedback,
they think the click didn't register.

## Output shape

```
# Microinteraction: <name>

## Spec
- Trigger: <event>
- Feedback (0-100ms): <what shows up immediately>
- State change: <prop> from <start> to <end>
- Duration: <ms>
- Easing: <name>
- Completion: <how it ends>
- Reset: <auto / manual>

## Accessibility
- Keyboard: <Enter/Space binding, focus ring behaviour>
- Screen reader: <aria-live region content if any>
- Reduced motion: <how it collapses>

## States table
| State | Look | Class |
|---|---|---|
| idle | <…> | `<class>` |
| triggered | <…> | `<class>` |
| settled | <…> | `<class>` |

## Implementation
```css
.<name> {
  /* base */
}
.<name>:active:not(:disabled) {
  transform: scale(0.97);
  transition: transform 80ms ease;
}
```

## Test
- [ ] Mouse trigger feels instant
- [ ] Keyboard trigger feels instant (same path as mouse)
- [ ] Focus ring visible when keyboard-triggered
- [ ] Reduced motion ON: animation skipped, end state shown immediately
- [ ] Disabled state: no feedback (avoid teasing)
```

## Rules

- **One purpose per microinteraction.** "Click button" doesn't also
  navigate AND submit AND show a toast. Break it down.
- **Reset is part of the spec.** A toast that never disappears is a
  modal. A press-state that never resets is a bug.
- **Disabled-state silence.** Don't animate a disabled control —
  encourages re-clicking.
- **Keyboard parity.** If the mouse version animates, the keyboard
  version animates. Same delay, same end state.

## Pitfalls

- Listing "fade in" with no duration / easing / start state.
- Forgetting the disabled state entirely.
- Animating focus rings — they need to be instant for keyboard users.
- Spec'ing motion in pixels — use transforms / percentages so it scales.
