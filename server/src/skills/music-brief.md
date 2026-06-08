---
name: music-brief
description: Translate a mood/brand brief into a precise music prompt and generate a track with media.music — jingles, theme music, background beds, stingers.
applies_to: [draft-other]
---

# Skill: Music brief + generation

## When to use this

The user asks to "compose / make / generate" a "jingle", "theme", "track",
"soundtrack", "background music", or "hold music". This is the music-producer's
craft: turn a vibe into a concrete prompt, then render with `media.music`.

## Process

1. **Turn the brief into a precise music prompt.** Name five things:
   - **Genre** (corporate, lo-fi, cinematic, EDM, acoustic…)
   - **Tempo** in bpm (or slow/mid/up-tempo)
   - **Key / mood** (bright major, tense minor, warm, melancholic)
   - **Instruments** (piano + light percussion, synth pads, strings…)
   - **Feel / use-case** (optimistic intro, calm focus bed, triumphant outro)
2. **Lyrics only when asked.** If the brief wants singing, write SHORT, singable
   lines and pass them to `media.music`; otherwise keep it instrumental.
3. **Match length + energy to the placement** — a 5-second stinger, a loopable
   background bed, a 30-second ad jingle. Say which you're making.
4. **Render with `media.music`** — returns `{ path, bytes, model }`.
5. **Return** the prompt (and lyrics, if any) AND the audio path, and suggest one
   variation worth re-spinning.

## Prompt shape

```
<genre>, <tempo>bpm, <key/mood>, <instruments>, <feel/use-case>.
e.g. "Upbeat corporate intro, 120bpm, bright C major, piano + claps + light
synth, optimistic and clean — for a product launch sting."
```

## Rules

- **Concrete beats adjectives.** "Happy music" renders mush; the five elements
  render a track.
- **Background beds stay out of the way** — simple, loopable, no big melodic
  hooks competing with a voiceover sitting on top.
- **Keep lyrics short and singable.** Long paragraphs don't sing.
- **Confirm from the result.** Report the real `path`; never claim a track
  exists off an `{ error }` result.

## Pitfalls

- `media.music` returns `{ error: "MiniMax not configured" }` → deliver the
  prompt + lyrics and note the render is pending the `MINIMAX_API_KEY`.
- A dense, melodic "bed" that fights the narration → for voice-over backing,
  specify "minimal, unobtrusive, no lead melody".
- Mismatched energy (a frantic EDM track behind a calm explainer) → always tie
  the feel to the placement.
