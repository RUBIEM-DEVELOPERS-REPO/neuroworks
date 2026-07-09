# Native-Speaker Review Process — Shona & Ndebele Output

_Written 2026-07-09._

NeuroWorks agents can be pinned to chiShona or isiNdebele — org-wide (Settings → Language), per department (Departments → apply → set a department's default), or per individual agent (Personas page → language selector on any hire). This document defines how flagged local-language output gets reviewed by a native speaker and corrected.

## Why this exists

An LLM's Shona/Ndebele output can be grammatically parseable but still read as stiff, textbook, or subtly wrong to a native speaker — a failure mode an English-only operator won't reliably catch. The Quality flag mechanism (below) is how that gap gets surfaced; this process is what happens after it's flagged.

## 1. How an output gets flagged

Any operator viewing a completed task's result (Tasks / Results page) sees a **🚩 Flag for review** control next to the answer. Flagging a local-language output:

1. Rating: **needs work** (the common case) or **good example** (worth keeping as a reference).
2. Category: pick **localization** for language-quality issues specifically (tone/grammar/naturalness), or another category (accuracy, tone, completeness, etc.) if the language is fine but something else is wrong.
3. Language observed: **chiShona** / **isiNdebele** / English — what the output was actually in, as seen by the person flagging it. This isn't inferred automatically (an agent's language pin can change after the job ran), so pick what you actually read.
4. Optional note: what's wrong, in as much or as little detail as you have. Even "felt like a direct translation, not natural Shona" is useful signal.

This writes a record to `_neuroworks/quality.jsonl` via `POST /api/quality/flag` (`server/src/routes/quality.ts`).

## 2. Where reviewers find flagged items

**Quality Dashboard** (`/quality`) — "Recent Feedback" list, filterable by language via the dropdown at the top of that panel. Filter to chiShona or isiNdebele to see only local-language flags. Each entry shows the persona, the note, and the category.

**Mission Control** (Dashboard home) — the "Flag an output →" link in the Mission Control panel jumps straight to the Quality Dashboard, so a reviewer doing a routine pass doesn't need to remember the URL.

There's no separate review queue yet — the Quality Dashboard's filtered list **is** the queue. A reviewer works through it top-to-bottom (most recent first) periodically (see cadence below).

## 3. Review steps

For each flagged local-language item:

1. Open the linked job (via the flag's `jobId` — cross-reference in Results/Activity) and read the actual output text.
2. Judge: is this a **language quality** issue (wrong word choice, unnatural phrasing, wrong register — e.g. using `imi`/`nkosi` respectful forms where informal would fit, or vice versa) or a **content** issue (the underlying answer is wrong, language aside)?
3. For a genuine language issue, write down the correction — what a natural Zimbabwean Shona/Ndebele speaker would actually say instead of what the agent produced. Note the specific phrase, not just "this is wrong."
4. Decide whether the fix belongs in:
   - **`server/src/lib/shona-glossary.ts`** — if it's a missing or wrong vocabulary/phrase mapping (e.g. a financial term, a greeting) that the conversational glossary should carry.
   - **`server/src/lib/language-prompts.ts`** (`LANGUAGE_PROMPTS.sn` / `.nd`) — if it's a systemic instruction-following issue (wrong register consistently, ignoring the "explain technical terms: local term first, English in parentheses" rule, etc.) that a clearer instruction would fix.
   - Neither — sometimes it's a one-off model slip, not a pattern. Note it and move on; only change the prompt/glossary when the same class of error shows up more than once.
5. If a prompt/glossary change is made, re-run a similar task afterward to confirm the fix actually changes the output (don't just edit and assume).

## 4. Who reviews

A native chiShona or isiNdebele speaker, ideally someone with some familiarity with the domain the flagged task came from (financial phrasing needs different judgment than a customer-service reply). This is **not** the same person who flagged the item in most cases — flagging just needs "this doesn't read right," review needs "here's specifically what's wrong and why."

Until a dedicated reviewer role exists in the system, this is a manual assignment: whoever owns the department the flagged agent belongs to (Communications, Customer Service, Grant Writing, or any other department with a local-language agent) is responsible for either reviewing it themselves or routing it to someone who can.

## 5. Cadence

No fixed SLA yet — treat flagged local-language items like any other backlog: review at least weekly, sooner if a department is actively running local-language agents for real customer- or donor-facing work (a live Customer Service desk in chiShona needs faster turnaround than an occasional Grant Writing draft).

## 6. What "done" looks like

- The flag's underlying issue is understood (language quality vs. content vs. one-off).
- If it's a pattern, `shona-glossary.ts` or `language-prompts.ts` has been updated and spot-checked.
- The reviewer's correction is written down somewhere durable — a vault note under `_governance/` or a comment in the relevant PR — so the same mistake doesn't need re-diagnosing next time it's flagged.

There's currently no "mark flag as reviewed" status field — flags accumulate in `quality.jsonl` and the Quality Dashboard shows everything. If a reviewed-status field becomes worth building (a real review queue with pending/reviewed states), that's a natural next step once this manual process has been run enough times to know what a reviewer actually needs from the tooling.
