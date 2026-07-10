---
name: voiceover-script
description: Write a script meant to be HEARD, then synthesise it to audio with media.tts — voiceovers, narrated briefings, accessibility audio, IVR/phone prompts.
applies_to: [draft-other]
---

# Skill: Voiceover script + narration

## When to use this

The user asks for a "voiceover", "narration", "read this aloud", "audio
version", "spoken briefing", "podcast intro", or an "IVR / phone prompt". This
is the voice-producer's craft: write for the ear, then render with `media.tts`.

## Process

1. **Write a SPOKEN script first.** Short sentences, one idea each. Contractions.
   No markdown, bullets, or punctuation a listener can't hear.
2. **Disambiguate for the ear.** Spell out anything that would be misread: "API"
   → "A-P-I", "$1.4M" → "one point four million dollars", "Q3" → "quarter three".
3. **Pick a voice + emotion** that fits the content and say your choice in one
   line (neutral for briefings, warm for welcomes, upbeat for promos).
4. **Render with `media.tts`** — pass the script, a `voice_id`, and an optional
   `emotion`. It returns `{ path, bytes, model }`.
5. **Return BOTH** the script (so the user can edit and re-render) and the audio
   file path. Quote the path exactly as the tool returned it.

## Writing for the ear

```
Good (spoken):  "Here's where things stand. Revenue's up — about twelve percent
                 over last quarter. Two deals are still open."
Bad  (written): "**Status:** Revenue +12% QoQ. 2 deals open (see table)."
```

## Rules

- **Never read punctuation or formatting.** If the draft has bullets or bold,
  rewrite it into flowing speech before calling `media.tts`.
- **Narrate the tightened version of long content.** A listener won't sit
  through a wall of text — cut to the essentials and say what you trimmed.
- **One voice per piece** unless the script is a dialogue; switching voices
  mid-narration is jarring.
- **Confirm from the tool result.** Report the real `path`; never claim audio
  was produced off an `{ error }` result.

## Pitfalls

- `media.tts` returns `{ error: "MiniMax not configured" }` (no `MINIMAX_API_KEY`)
  → deliver the finished script and say the audio render is pending the key.
  Don't fabricate a path.
- Feeding raw markdown to `media.tts` → the listener hears "asterisk asterisk".
  Strip formatting first.
- A 1,500-word article narrated verbatim → unlistenable. Summarise to a
  60–90 second script and narrate that.
