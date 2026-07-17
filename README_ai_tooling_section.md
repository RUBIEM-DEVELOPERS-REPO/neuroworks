## AI Development Tooling Disclosure

In line with the AI4I Track 3 evidence requirements, this section discloses the AI coding/reasoning tools used to build NeuroWorks, and where in the codebase their output can be checked.

| Tool | Role in this build | Where to verify |
| --- | --- | --- |
| **OpenAI Codex** | Debugging and code review on the existing codebase — not used to generate net-new features from scratch. Used to trace failing test cases, review PRs for logic errors, and flag unhandled edge cases in `server/src/lib/` before merge. | Git commit messages tagged `codex-review`; PR review comments in repo history. |
| **GPT-5.6** | Reasoning support on the governance engine's policy/constraint logic — specifically, converting uploaded policy documents (PDF/Word/plain text) into structured hard/soft constraint sets, and stress-testing edge cases in the HITL pre-execution gate (the 20 enforced categories). | `server/src/lib/governance/` — constraint-extraction prompts and test fixtures; the planted-policy-violation test referenced in the cover letter (Section 3.1). |

**Human oversight of AI-assisted output.** No AI-generated code or constraint logic ships without human review. Governance constraints extracted with GPT-5.6 assistance are surfaced to the operator for explicit confirmation before injection into agent system prompts (see Section 2.4 of the main proposal) — the same HITL principle applied internally to our own tooling that we apply to the product. Debugging suggestions from Codex are reviewed and tested (118 passing unit tests) before merge, not applied automatically.

**What this does *not* cover.** Core system architecture (3-layer design, HERMES governance layer, ~90 primitive allowlist), the multi-agent orchestration logic (LangGraph), and the business/dataset case were designed and written by the four-person NeuroWorks team. AI tools were used as coding/reasoning aids on specific, bounded tasks above — not as authors of the platform's architecture or product logic.
