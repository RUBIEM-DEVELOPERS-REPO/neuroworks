# Research-aware employee harness — PARALLEL :: par1 :: 2026-05-22T21:27:08.796Z
Server: http://127.0.0.1:7471
Probes: 11. Each requires external context. PARALLEL dispatch (serial activate→POST→jobId, then poll all in parallel).

Initial pool: primary inflight=0; peers=secondary@7473 inflight=0; pool=1/3

  ── dispatched 11 probes in 74.9s; awaiting completions in parallel
✗ drew-anthropic-pricing-meddic          96.4s :: shape D · research 2/5 [attribution,real-entities] → D → D  len=361
✗ maya-notion-competitive-response       147.7s :: shape C- · research 2/5 [attribution,real-entities] → C- → C-  len=242
✓ riley-staff-engineer-jd                156.7s :: shape A · research 1/5 [real-entities] → A- → A-  len=2253
✓ fiona-ndr-benchmark-table              120.7s :: shape B · research 3/5 [attribution,dated,real-entities] → B → B  len=1932
✓ sam-vercel-ai-sdk-adoption             189.7s :: shape A · research 3/5 [cites[N],dated,real-entities] → A → A  len=4110
✓ logan-mfn-clause-research              141.4s :: shape A · research 1/5 [attribution] → A- → A-  len=1899
✗ researcher-small-llm-impact            140.3s :: shape C · research 3/5 [attribution,dated,real-entities] → C+ → C+  len=2680
✓ quinn-event-driven-testing             182.6s :: shape B · research 3/5 [cites[N],attribution,real-entities] → B → B  len=5259
✗ devon-kafka-lag-runbook                188.7s :: shape C · research 2/5 [URLs,real-entities] → C → C  len=6216
✗ priya-ai-agent-solo-founder-prd        82.6s :: shape D- · research 0/5 [] → D- → D-  len=0
✗ dale-saas-retention-curve              73.4s :: shape C · research 2/5 [attribution,dated] → C → C  len=535

## Parallelism

- Wall clock: 241.8s (vs ~2640s sequential target sum)
- Speedup: 10.92× over sequential
- Peak concurrent inflight (primary + peers): 21
- Peak managed worker pool size: 3/3
- Samples where primary AND a peer both had ≥1 inflight: 102 (both-clawbots-working)
- Distinct peer ports loaded: {7473}

## Scorecard

| Probe | Persona | Target | Elapsed | Shape | Research | Combined | FINAL | Notes |
|---|---|---|---|---|---|---|---|---|
| drew-anthropic-pricing-meddic | account-executive | 240s | 96.4s | D | 2/5 | D | **D** | MEDDIC, attribution, real-entities |
| maya-notion-competitive-response | marketing-manager | 210s | 147.7s | C- | 2/5 | C- | **C-** | attribution, real-entities |
| riley-staff-engineer-jd | recruiter | 210s | 156.7s | A | 1/5 | A- | **A-** | outcomes, must-haves, comp, real-entities |
| fiona-ndr-benchmark-table | financial-analyst | 240s | 120.7s | B | 3/5 | B | **B** | assumptions, benchmark, unit-econ, attribution, dated, real- |
| sam-vercel-ai-sdk-adoption | software-engineer | 240s | 189.7s | A | 3/5 | A | **A** | architecture, trade-offs, recommendation, specifics, cites[N |
| logan-mfn-clause-research | contracts-reviewer | 240s | 141.4s | A | 1/5 | A- | **A-** | caveat, risk, attribution |
| researcher-small-llm-impact | researcher | 360s | 140.3s | C | 3/5 | C+ | **C+** | perspectives, attribution, dated, real-entities |
| quinn-event-driven-testing | qa-engineer | 240s | 182.6s | B | 3/5 | B | **B** | strategy, patterns, tooling, cites[N], attribution, real-ent |
| devon-kafka-lag-runbook | devops-sre | 240s | 188.7s | C | 2/5 | C | **C** | symptom, diagnostic, URLs, real-entities |
| priya-ai-agent-solo-founder-prd | product-manager | 240s | 82.6s | D- | 0/5 | D- | **D-** |  |
| dale-saas-retention-curve | data-analyst | 180s | 73.4s | C | 2/5 | C | **C** | method, metric, attribution, dated |

## Summary

5/11 above B-.
8/11 grounded in external research (≥2 evidence markers).
Average research evidence count: 2.0/5.

Brain update: submitted.