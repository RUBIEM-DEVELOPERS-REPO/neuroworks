---
name: video-prompt
description: Write tight, shootable video prompts (and storyboards) and generate short clips with media.video — social clips, teasers, explainers, image-to-video.
applies_to: [draft-other]
---

# Skill: Video prompt + generation

# When to use this

The user asks to "make a video", "generate a clip", "produce a teaser/ad/reel",
"storyboard" something, or "animate this image". This is the video-producer's
craft: write a prompt a generator can actually use, then render with
`media.video`.

## Process

1. **Write a concrete visual prompt.** Name five things, in plain language:
   - **Subject** — who/what is on screen
   - **Action** — what they do
   - **Setting** — where, time of day
   - **Camera** — shot type + movement (e.g. "slow push-in", "static wide")
   - **Mood / lighting** — the feel (e.g. "warm golden hour", "cool neon")
2. **State the channel + aspect** and the first-second hook. Default 9:16 for
   Reels/TikTok/Shorts, 16:9 for YouTube/web.
3. **Storyboard anything longer than one shot** — a numbered shot list, each with
   its own prompt — then render the single most important shot with `media.video`.
4. **Image-to-video:** when the user supplies an image, pass it as
   `first_frame_image`. If they ask to "animate this" but gave no image, ask.
5. **Return** the exact prompt you rendered AND the `downloadUrl` the tool
   returned. `media.video` is async (minutes) — it already waited; just surface
   the URL.

## Prompt shape

```
Subject + action, setting. Camera: <shot + move>. Mood: <lighting/feel>.
e.g. "A barista latte-arts a heart, sunlit café counter. Camera: slow push-in
on the cup. Mood: warm, soft morning light, shallow depth of field."
```

## Rules

- **Specific beats poetic.** "Cinematic and beautiful" renders nothing; the five
  concrete elements render a shot.
- **One clear action per shot.** Generators lose coherence when a prompt asks for
  three things at once — split them into storyboard shots.
- **Hook in the first second.** Lead the prompt with the most arresting visual,
  especially for vertical social.
- **Confirm from the result.** Report the real `downloadUrl`; never invent one.

## Pitfalls

- `media.video` returns `{ error: "MiniMax not configured" }` → deliver the
  storyboard + prompts and note the render is pending the `MINIMAX_API_KEY`.
- Over-stuffed prompts ("a dog AND a sunset AND a city AND text overlay") →
  muddy output. Storyboard them as separate shots.
- Forgetting aspect/channel → a 16:9 clip cropped ugly into a 9:16 feed.
