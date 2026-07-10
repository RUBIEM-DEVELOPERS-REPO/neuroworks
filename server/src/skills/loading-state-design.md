---
name: loading-state-design
description: Design the not-loaded states for a UI — skeletons, shimmer, optimistic UI, progress affordances. The 'perceived speed' playbook.
applies_to: [draft-memo, draft-other]
---

# Skill: Loading-state design

## Why this matters

Loading states are the single biggest perceived-speed lever in a web UI.
A "Loading…" spinner makes a 400ms wait feel like 2 seconds. A skeleton
that matches the layout makes it feel like 150ms. Same latency, very
different felt experience.

## The four loading states

1. **First-load skeleton** — no data yet, page just opened. Use shimmering
   blocks that match the eventual layout shape (rows, cards, columns).
2. **Background refresh** — data is showing, you're re-fetching. Don't
   destroy what's there. Use a thin progress bar at the top, or a subtle
   dot pulse next to the section title.
3. **Optimistic write** — user submitted, you're awaiting confirmation.
   Show the new row IMMEDIATELY in muted state; on success, brighten it;
   on failure, fade-out with a toast.
4. **Stalled / slow** — request taking >2 seconds. Add a "Still working —
   <plain English describing what's slow>" line so the user knows it's
   alive.

## Skeleton shape rules

- **Match the layout.** A skeleton for a card list must be card-shaped.
  Don't skeleton a square when the eventual content is a row of text.
- **Vary widths.** Two rows of equal-width skeletons feel mechanical.
  Mix 100% / 75% / 50% to hint at real content.
- **One animation per page.** Skeletons all shimmer in unison (same
  keyframe, same duration). Don't stagger them — feels broken.
- **Surface contrast.** The skeleton should sit one step lighter than
  the surface beneath, not full white. Full-white skeletons feel cheap.

## Optimistic UI checklist

- [ ] New row appears immediately at the right position
- [ ] Muted styling distinguishes it from confirmed rows
- [ ] On success, smooth transition to confirmed style (200ms)
- [ ] On failure, slide out + toast with retry
- [ ] Reverted state is identical to pre-submit (no orphan UI)

## When NOT to use skeletons

- Sub-second loads on warm cache — skeleton flashes, looks broken
- One-shot popovers / menus — opaque-then-content is fine
- Critical errors — show the error, not a skeleton, on a 500
- Empty states — design the empty state separately; a skeleton that
  resolves to "no data" is uncomfortable

## Output shape

```
# Loading states — <surface name>

## States designed
| State | Trigger | Look | Notes |
|---|---|---|---|
| First load | route entry, no data | skeleton (N rows) | shimmer 1.4s |
| Refresh | poll interval | dot pulse in title | no row replacement |
| Optimistic add | user submitted | muted row appears at top | 200ms confirm |
| Slow | >2s since request | "Still working — <reason>" line | red after 30s |
| Error | 4xx/5xx | toast + inline error block | retry CTA |

## Implementation notes
- Skeleton component: <props it takes>
- Stalled-detection: <how you start the timer>
- Toast: <where it mounts, what tone>
```

## Rules

- **Never combine spinner + skeleton.** Pick one. Spinner = "small/atomic
  thing loading". Skeleton = "structured content coming".
- **The skeleton matches the empty state shape, not the populated one.**
  Filling 50 row skeletons when most users have 3 rows is wrong.
- **Time the skeleton.** If the response usually returns in <100ms, the
  skeleton is a flash; delay rendering it by 80-120ms so it only appears
  for genuinely slow loads.

## Pitfalls

- Skeleton that doesn't match the loaded layout — content jumps.
- Skeleton with no shimmer — looks like a real broken state.
- Hiding the skeleton 200ms before data arrives — visible gap.
- Skeleton on a page that loads in 30ms — pointless flash.
