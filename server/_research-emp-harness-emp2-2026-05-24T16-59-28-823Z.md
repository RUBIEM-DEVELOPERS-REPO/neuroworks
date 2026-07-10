# Research-aware employee harness — SECOND surface :: emp2 :: 2026-05-24T16:53:59.379Z
Server: http://127.0.0.1:7471
Probes: 8 (each REQUIRES external sources). Verifies Playwright search fallback (browserSearch tier) when HTTP engines fail.

Initial pool: primary inflight=0; peers=secondary@7473 inflight=0; pool=1/3

  ── wave 1/2 dispatched (4 probes); awaiting before next wave
  ── all 8 probes dispatched in 215.8s
✓ drew-saas-close-rate-meddic              216.1s :: shape C+ · evidence 2/5 [attribution,real-entities] · skill 1/4 [cohort-named] → B+ → B+  len=404
✓ devon-k8s-autoscaling-runbook            210.6s :: shape B · evidence 2/5 [attribution,real-entities] · skill 2/4 [numbered,verify] → B+ → B+  len=1127
✓ sam-vector-db-comparison                 204.8s :: shape B+ · evidence 2/5 [attribution,real-entities] · skill 2/4 [differentiator,recommendation] → A- → A-  len=1584
✓ quinn-ai-agent-testing-strategy          198.8s :: shape A · evidence 3/5 [cites[N],attribution,real-entities] · skill 1/4 [cites] → A → A  len=4192
✓ tao-api-docs-comparison                  74.8s :: shape A · evidence 3/5 [cites[N],attribution,real-entities] · skill 3/4 [comparison-matrix,differentiator,recommendation] → A+ → A+  len=2908
✓ riley-senior-swe-comp-benchmark          86.9s :: shape A · evidence 2/5 [attribution,real-entities] · skill 2/4 [cohort-named,distribution-words] → A+ → A+  len=1159
✓ dale-product-analytics-stack             126.4s :: shape A · evidence 2/5 [dated,real-entities] · skill 2/4 [differentiator,recommendation] → A+ → A+  len=1408
✓ logan-eu-ai-act-timeline                 72.0s :: shape A · evidence 3/5 [attribution,dated,real-entities] · skill 0/4 [] → A → A  len=1004

## Parallelism

- Wall clock: 329.3s (vs ~1890s sequential target sum)
- Speedup: 5.74× over sequential
- Peak concurrent inflight (primary + peers): 7
- Peak managed worker pool size: 3/3
- Samples where primary AND a peer both had ≥1 inflight: 133 (both-clawbots-working)
- Distinct peer ports loaded: {7473}

## Scorecard

| Probe | Persona | Skill | Target | Elapsed | Shape | Evidence | Skill disc. | Combined | FINAL |
|---|---|---|---|---|---|---|---|---|---|
| drew-saas-close-rate-meddic | account-executive | benchmark-lookup | 240s | 216.1s | C+ | 2/5 | 1/4 | B+ | **B+** |
| devon-k8s-autoscaling-runbook | devops-sre | runbook-writing | 240s | 210.6s | B | 2/5 | 2/4 | B+ | **B+** |
| sam-vector-db-comparison | software-engineer | competitive-analysis | 240s | 204.8s | B+ | 2/5 | 2/4 | A- | **A-** |
| quinn-ai-agent-testing-strategy | qa-engineer | research-deep | 240s | 198.8s | A | 3/5 | 1/4 | A | **A** |
| tao-api-docs-comparison | technical-writer | competitive-analysis | 210s | 74.8s | A | 3/5 | 3/4 | A+ | **A+** |
| riley-senior-swe-comp-benchmark | recruiter | benchmark-lookup | 240s | 86.9s | A | 2/5 | 2/4 | A+ | **A+** |
| dale-product-analytics-stack | data-analyst | competitive-analysis | 240s | 126.4s | A | 2/5 | 2/4 | A+ | **A+** |
| logan-eu-ai-act-timeline | contracts-reviewer | research-deep | 240s | 72.0s | A | 3/5 | 0/4 | A | **A** |

## Summary

- 8/8 at B+ or higher (PASS bar)
- 3/8 well-grounded (≥3 evidence markers)
- 5/8 show skill discipline (≥2 playbook markers)
- Average evidence count: 2.4/5
- Average skill discipline: 1.6/4
- Retries used: 0/8

Brain update: submitted.