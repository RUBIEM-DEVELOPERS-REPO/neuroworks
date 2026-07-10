---
name: multimedia-package
description: Assemble a complete content package from one brief — script + voiceover (media.tts) + video (media.video) + music (media.music) — kept cohesive, with an assembly note.
applies_to: [draft-other]
---

# Skill: Multimedia package

## When to use this

The user wants a whole piece, not one element: a "content package", a "social ad
with voiceover and music", an "explainer with narration", or "script + video +
music". This is the multimedia-producer's craft — direct all three media tools
toward one cohesive result.

## Process

1. **Content plan first.** One short block: the **hook**, the **core message**,
   the **call-to-action**, and the **format + length**. Everything else serves it.
2. **Write the script once, reuse it.** The same script drives the voiceover, the
   video prompts, and the music mood — that's what keeps the piece cohesive.
3. **Name the unifying tone** in one line (e.g. "warm, confident, optimistic") so
   voice, visuals, and music all match it.
4. **Produce in order:**
   - **Voiceover** → `media.tts` (see the voiceover-script skill — write for the ear).
   - **Video** → `media.video` (see the video-prompt skill — concrete shots, aspect).
   - **Music** → `media.music` (see the music-brief skill — a bed that sits UNDER
     the voice: minimal, unobtrusive).
5. **Assembly note.** End with how it stitches together: what plays when, where
   the music **ducks** under the voice, and where the CTA lands.
6. **Return every prompt AND every asset path/URL** the `media.*` tools produced.

## Output shape

```
## Plan        — hook / message / CTA / format + length
## Script      — the spoken script
## Voiceover   — voice choice + audio path
## Video       — shot prompt(s) + video URL
## Music       — music prompt + track path
## Assembly    — 0:00 logo + music in · 0:02 VO starts, music ducks · 0:14 CTA
```

## Rules

- **Cohesion is the job.** A great clip + a mismatched track reads worse than
  three merely-good assets that share one tone. State the tone and hold it.
- **Music serves the voice.** When there's narration, the bed is minimal and
  ducked — never a melodic track fighting the words.
- **Sequence it.** Don't hand back four loose files; give the editor the timeline.
- **Confirm from results.** Report the real paths/URLs each tool returned.

## Pitfalls

- A `media.*` tool returns `{ error: "MiniMax not configured" }` → still deliver
  the full plan: script + every prompt, and flag which renders are pending the
  `MINIMAX_API_KEY`. The user gets a complete, runnable package either way.
- Producing assets that don't share a tone → looks like three vendors, not one
  piece. Decide the tone in step 3 and apply it everywhere.
- For a single-medium ask (voice only, video only), hand off to Vera / Vince /
  Melody instead of over-producing.
