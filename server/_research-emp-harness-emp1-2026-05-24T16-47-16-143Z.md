# Research-aware employee harness — SECOND surface :: emp1 :: 2026-05-24T16:26:08.794Z
Server: http://127.0.0.1:7471
Probes: 8 (each REQUIRES external sources). Verifies Playwright search fallback (browserSearch tier) when HTTP engines fail.

Initial pool: primary inflight=0; peers=secondary@7473 inflight=0; pool=0/0

  ── dispatched 8 probes in 79.1s; awaiting completions in parallel
✗ drew-saas-close-rate-meddic              91.4s :: shape B+ · evidence 1/5 [real-entities] · skill 1/4 [cohort-named] → B → B ↻  len=418
✗ devon-k8s-autoscaling-runbook            637.0s :: shape C+ · evidence 2/5 [attribution,real-entities] · skill 1/4 [numbered] → B+ → C+ ↻  len=783
✓ sam-vector-db-comparison                 122.8s :: shape B+ · evidence 2/5 [attribution,real-entities] · skill 3/4 [comparison-matrix,differentiator,recommendation] → A → A  len=1909
✗ quinn-ai-agent-testing-strategy          324.7s :: shape C · evidence 0/5 [] · skill 0/4 [] → C → C ↻  len=0
✓ tao-api-docs-comparison                  111.1s :: shape A · evidence 2/5 [attribution,real-entities] · skill 1/4 [recommendation] → A → A  len=765
✗ riley-senior-swe-comp-benchmark          312.2s :: shape C · evidence 0/5 [] · skill 0/4 [] → C → C ↻  len=0
✗ dale-product-analytics-stack             313.4s :: shape C · evidence 0/5 [] · skill 0/4 [] → C → C ↻  len=0
✗ logan-eu-ai-act-timeline                 104.1s :: shape C · evidence 0/5 [] · skill 0/4 [] → C → C ↻  len=48

## Parallelism

- Wall clock: 1266.4s (vs ~1890s sequential target sum)
- Speedup: 1.49× over sequential
- Peak concurrent inflight (primary + peers): 8
- Peak managed worker pool size: 1/0
- Samples where primary AND a peer both had ≥1 inflight: 0 (both-clawbots-working)
- Distinct peer ports loaded: {none}

## Scorecard

| Probe | Persona | Skill | Target | Elapsed | Shape | Evidence | Skill disc. | Combined | FINAL |
|---|---|---|---|---|---|---|---|---|---|
| drew-saas-close-rate-meddic | account-executive | benchmark-lookup | 240s | 91.4s | B+ | 1/5 | 1/4 | B | **B** |
| devon-k8s-autoscaling-runbook | devops-sre | runbook-writing | 240s | 637.0s | C+ | 2/5 | 1/4 | B+ | **C+** |
| sam-vector-db-comparison | software-engineer | competitive-analysis | 240s | 122.8s | B+ | 2/5 | 3/4 | A | **A** |
| quinn-ai-agent-testing-strategy | qa-engineer | research-deep | 240s | 324.7s | C | 0/5 | 0/4 | C | **C** |
| tao-api-docs-comparison | technical-writer | competitive-analysis | 210s | 111.1s | A | 2/5 | 1/4 | A | **A** |
| riley-senior-swe-comp-benchmark | recruiter | benchmark-lookup | 240s | 312.2s | C | 0/5 | 0/4 | C | **C** |
| dale-product-analytics-stack | data-analyst | competitive-analysis | 240s | 313.4s | C | 0/5 | 0/4 | C | **C** |
| logan-eu-ai-act-timeline | contracts-reviewer | research-deep | 240s | 104.1s | C | 0/5 | 0/4 | C | **C** |

## Summary

- 2/8 at B+ or higher (PASS bar)
- 0/8 well-grounded (≥3 evidence markers)
- 1/8 show skill discipline (≥2 playbook markers)
- Average evidence count: 0.9/5
- Average skill discipline: 0.8/4
- Retries used: 6/8

Brain update: submitted.