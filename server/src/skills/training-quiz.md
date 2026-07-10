---
name: training-quiz
description: Generate a quiz from a policy / training doc — multiple-choice + short-answer questions with answer key + scoring guide.
applies_to: [draft-other, plan, summarize]
---

# Skill: Training quiz from a policy doc

## Goal

The trainee takes the quiz, scores 80%+, and HR knows they understood the policy (not just clicked through). Quiz is reusable and grades itself.

## Process

1. **Identify the LEARNING OBJECTIVES** from the policy — usually 5-8 specific things the trainee must know or be able to do. Skip the preamble; focus on the rules / procedures.
2. **For each objective: write ONE question that tests it.** Mix question types:
   - **Multiple-choice (MCQ)** — 4 options, ONE correct, distractors that test common misunderstandings.
   - **Scenario-based** — describe a situation, ask what to do.
   - **Short-answer** — for things that can't be MCQ'd (e.g. "name the 3 escalation paths").
3. **Avoid trick questions.** A good distractor is a *plausible* wrong answer; a "gotcha" tests reading comprehension, not policy understanding.
4. **Provide an answer key with REASONING.** "Why this is right" + "why each wrong answer is wrong" — that's how trainees learn from mistakes.
5. **Include a scoring guide** with a pass threshold and what to do for below-threshold scores (re-read section X, retake, escalate to manager).

## Output shape

```
# Training quiz: <Policy / training name>

**Source:** <Doc title + version + date>
**Estimated time:** <N minutes>
**Pass score:** <e.g. 80%>
**Format:** <Open-book / closed-book>

## Learning objectives

By passing this quiz, the trainee demonstrates they can:
1. <Objective 1 — verb + observable>
2. <Objective 2>
3. <Objective 3>
4. <...>

## Quiz

### Q1 (MCQ) — <topic>

<Question phrased clearly>

- A. <Option A>
- B. <Option B>
- C. <Option C>
- D. <Option D>

### Q2 (Scenario) — <topic>

> Scenario: <One-paragraph scenario from a realistic situation in the trainee's role>
>
> What should you do?
- A. <Action A>
- B. <Action B>
- C. <Action C>
- D. <Action D>

### Q3 (Short answer) — <topic>

<Question>

(2-3 sentence answer expected.)

### Q4 (MCQ) — <topic>
<...>

### Q5 (Scenario) — <topic>
<...>

(Continue for 8-12 questions total)

---

## Answer key (do not share with trainee)

### Q1 — Correct: **<letter>**
- Why correct: <One sentence + citation to source section>
- Why wrong (A/B/C/D as applicable): <One line per distractor>

### Q2 — Correct: **<letter>**
- Why correct: <reasoning>
- Why wrong: <per-option>

### Q3 — Acceptable answers
- Full credit (2 pts): <model answer>
- Partial credit (1 pt): <what gets half credit>
- No credit (0 pts): <what's wrong / missing>

### Q4 — Correct: **<letter>**
<...>

---

## Scoring guide

- **80-100%** — Pass. Trainee acknowledged in system; HR notified.
- **60-79%** — Partial. Re-read sections <X, Y, Z> and retake within 7 days.
- **Below 60%** — Did not pass. 1:1 with manager / trainer before retake.

## What to update next iteration

- Question(s) where >30% of trainees got it wrong → policy ambiguity, not trainee knowledge. Rewrite the policy section first.
- Question(s) where everyone gets it right → too easy; replace with a harder one next cycle.
```

## Rules

- **Test understanding, not memory of phrasing.** "Which word is used in section 4?" is not a learning question.
- **One concept per question.** Multi-part questions hide which part the trainee missed.
- **Distractors are PLAUSIBLE.** Obviously-wrong options test reading speed, not knowledge.
- **Reasoning in the answer key.** The pedagogical value is in WHY, not just the letter.
- **Scenario questions for judgment calls.** Yes/no rule recall is MCQ; "what would you do" is scenario.

## Pitfalls

- Quiz that grades reading speed instead of understanding.
- Trick questions that punish careful readers (negative-phrased options, double negatives).
- All MCQ → trainees can guess; mix in short-answer and scenario.
- Forgetting the iteration loop — quiz quality improves as you see which questions everyone misses (= policy ambiguity).
- Answer key without "why wrong" — trainees retake without understanding what they missed.
