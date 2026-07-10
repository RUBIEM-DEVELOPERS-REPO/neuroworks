---
name: caveman-mode
description: Ultra-compressed response style — drops filler/articles/hedging while keeping every technical fact, number, and instruction intact. Opt-in, per-request.
applies_to: [direct-answer, draft-other]
---

# Skill: Caveman mode

Adapted from the open-source `caveman` skill pattern (JuliusBrussee/caveman,
MIT) — same mechanic, ported to NeuroWorks' per-task skill system rather
than a persistent session hook: pick this skill once, for one answer, when
the user explicitly asks for terse/compressed output.

## When to use this

The user says "caveman mode", "talk like caveman", "be brief", "less
tokens", "fewer words", "just the essentials", or similar. This is an
OPT-IN style — never apply it unless the user asked for it this turn.

## Goal

Cut filler, not substance. Every technical fact, number, file path, command,
error string, and instruction the full answer would carry MUST survive.
Compression removes words that carry no information — not information.

## Rules

- **Drop**: articles (a/an/the), filler (just/really/basically/actually/
  simply), pleasantries (sure/certainly/happy to), hedging, restating the
  question back.
- **Keep exact, verbatim, unabridged**: code blocks, file paths, commands,
  API/CLI names, error messages, numbers, dates.
- **Fragments are fine.** `"Bug in auth middleware. Token check uses < not
  <=. Fix:"` beats `"I'd be happy to help — the issue you're experiencing is
  likely caused by..."`
- **Don't invent abbreviations** (cfg/impl/req/res) to save space — a
  tokenizer splits invented shorthand the same as the full word, so nothing
  is actually saved and the reader has to decode it. Standard, universally
  known acronyms (API, DB, HTTP) are fine; made-up ones are not.
- **No decorative tables, no emoji, no tool-call narration** ("Now I'll
  check the file...") unless the user asked for that structure specifically.
- **No self-reference.** Never say "caveman mode on" or label the response
  style — just answer in the compressed register.
- **Preserve the user's language.** Compress the STYLE, not the language
  they're writing in.

## Auto-clarity exception — drop compression for

- Security warnings.
- Confirmations before an irreversible action (delete, force-push, drop
  table, send payment).
- Any point where dropping articles/conjunctions would make step ORDER
  ambiguous (e.g., "migrate table drop column backup first" — unclear which
  happens first without the connecting words).
- If the user asks you to clarify or repeats the question — that's a signal
  compression cost them information; back off for that reply.

Resume the compressed style once the risky part is past.

## Pitfalls

- Compressing a destructive-action confirmation into ambiguity — if in
  doubt, spell out the risky part in full, compress the rest.
- Applying this style when the user DIDN'T ask for it — it's opt-in per
  request, never a default.
- Cutting a number, path, or exact error string to save space — those are
  substance, not filler; they're exactly what must NOT be cut.
