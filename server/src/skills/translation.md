---
name: translation
description: Translate a message + draft a culturally-appropriate response in the target language, with tone preserved and a back-translation for the original requester.
applies_to: [draft-other, draft-email, summarize]
---

# Skill: Translation + response draft

## Goal

Original requester reads the back-translation, sees their intent preserved, and approves; recipient gets a fluent message that doesn't sound machine-translated.

## Process

1. **Identify source and target languages explicitly.** If the customer didn't specify the target, surface what you inferred and ask if uncertain.
2. **Translate the INPUT** (what they sent us). Preserve tone — formal stays formal, casual stays casual, frustrated stays frustrated (don't soften without permission).
3. **Note cultural / regional considerations** that affect how the message lands — honorifics, indirectness norms, formality level, common phrasings.
4. **Draft the RESPONSE in the target language.** Match the appropriate register; address them as they addressed you (formal vs informal "you").
5. **Provide a BACK-TRANSLATION** of the drafted response — short, faithful, so the original requester can sanity-check the meaning before sending.
6. **Flag anything you weren't sure about** — idioms that don't transfer, names of organisations / products that should stay in source language, technical terms.

## Output shape

```
## Translation + response

**Source language:** <e.g. "Japanese (formal business register)">
**Target language:** <e.g. "English (US, business casual)">
**Tone preserved:** <e.g. "Polite-formal, slight frustration about delivery delay">

## 1. Original message (translated to English)

> "<Faithful translation of the inbound message. Preserves tone and intent. Bracketed notes for culturally-loaded phrases — e.g. "[Japanese sumimasen — apology that also opens politely]".>"

**What they're actually asking:** <One-sentence summary of intent for context.>

## 2. Suggested response (in target language)

```
<Response drafted in the recipient's language, appropriate register>
```

## 3. Back-translation (to English, for your review)

> "<Faithful back-translation of the response above. Bracketed notes for register choices — e.g. "[used keigo / sonkeigo for elevated respect]".>"

## 4. Cultural / register notes

- **Greeting choice:** <Why this opener — e.g. "Used 'Cher M. Dupont' formal direct address rather than 'Bonjour' because business context and first contact">
- **Closing choice:** <Why this close — e.g. "Used 'Cordialement' not 'Bien à vous' to keep professional distance">
- **What I softened / sharpened:** <Any deliberate tone adjustment, with reason>

## 5. Untranslated / left-in-source

- **<Term or name>** — <Why kept — e.g. "Product name; do not localise">
- **<Term>** — <Why — e.g. "Industry term widely used in English even in <language> contexts">

## 6. Uncertain — please verify before sending

- **<Phrase>:** <What I'm uncertain about and the alternatives>
- **<Phrase>:** <Possible regional variant — e.g. "Spain Spanish vs Latin American Spanish — confirm audience">
```

## Rules

- **Tone matches input.** A frustrated customer translated as cheerful is wrong — that's a re-write, not a translation.
- **Back-translation is mandatory.** Without it the requester can't verify intent before sending.
- **Names, products, technical terms** — leave in source language unless localised version exists.
- **Register matches the relationship.** First contact = formal; established relationship = match their last register.
- **Surface uncertainty.** A confident-sounding wrong translation is worse than a flagged "verify this phrase".

## Pitfalls

- Soft-pedaling escalation — if the customer is firm, the translation should be firm.
- Over-localising product / brand names ("Stripe" stays "Stripe", not "Strisha" in Cyrillic).
- Using direct-translation idioms that don't exist in target ("piece of cake" → 不太可能 in some Mandarin idioms — not the same meaning).
- Picking the wrong regional variant (Brazilian vs European Portuguese, Continental vs Latin American Spanish).
- Forgetting honorifics in languages that require them (Japanese, Korean, German Sie/du).
