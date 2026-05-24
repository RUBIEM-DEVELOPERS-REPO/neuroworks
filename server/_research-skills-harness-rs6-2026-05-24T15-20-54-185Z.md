# Research/analysis skills harness — PARALLEL :: rs6 :: 2026-05-24T15:17:54.584Z
Server: http://127.0.0.1:7471
Probes: 6 (each REQUIRES external sources). Targets the new analysis skills (benchmark-lookup, source-triangulation, primary-source-check, landscape-scan) + upgraded research-deep / fact-check / competitive-analysis.

Initial pool: primary inflight=0; peers=secondary@7473 inflight=0; pool=3/3

  ── dispatched 6 probes in 36.4s; awaiting completions in parallel
✓ fiona-saas-ndr-benchmark-table             85.0s :: shape B · evidence 3/5 [attribution,dated,real-entities] · skill 2/4 [distribution-words,caveats] → B+ → B+  len=1583
✗ researcher-llm-cost-triangulation          72.9s :: shape C+ · evidence 1/5 [attribution] · skill 0/4 [] → C+ → C+  len=597
✓ logan-stripe-pricing-primary-source        76.0s :: shape A · evidence 3/5 [URLs,attribution,real-entities] · skill 2/4 [direct-quote,primary-named] → A+ → A+  len=1650
✓ priya-ai-agent-landscape-scan              97.2s :: shape C+ · evidence 1/5 [attribution] · skill 2/4 [segmentation,recent-moves] → B- → B-  len=1577
✓ maya-notion-launch-competitive-research    106.6s :: shape A · evidence 2/5 [attribution,real-entities] · skill 1/4 [sources-block] → A → A  len=3169
✓ fiona-mfn-clause-fact-check                149.0s :: shape B+ · evidence 2/5 [cites[N],attribution] · skill 2/4 [for-against,flip-line] → A- → A-  len=2187

## Parallelism

- Wall clock: 179.2s (vs ~1530s sequential target sum)
- Speedup: 8.54× over sequential
- Peak concurrent inflight (primary + peers): 11
- Peak managed worker pool size: 3/3
- Samples where primary AND a peer both had ≥1 inflight: 72 (both-clawbots-working)
- Distinct peer ports loaded: {7473}

## Scorecard

| Probe | Persona | Skill | Target | Elapsed | Shape | Evidence | Skill disc. | Combined | FINAL |
|---|---|---|---|---|---|---|---|---|---|
| fiona-saas-ndr-benchmark-table | financial-analyst | benchmark-lookup | 240s | 85.0s | B | 3/5 | 2/4 | B+ | **B+** |
| researcher-llm-cost-triangulation | researcher | source-triangulation | 360s | 72.9s | C+ | 1/5 | 0/4 | C+ | **C+** |
| logan-stripe-pricing-primary-source | contracts-reviewer | primary-source-check | 210s | 76.0s | A | 3/5 | 2/4 | A+ | **A+** |
| priya-ai-agent-landscape-scan | product-manager | landscape-scan | 240s | 97.2s | C+ | 1/5 | 2/4 | B- | **B-** |
| maya-notion-launch-competitive-research | marketing-manager | research-deep | 240s | 106.6s | A | 2/5 | 1/4 | A | **A** |
| fiona-mfn-clause-fact-check | contracts-reviewer | fact-check | 240s | 149.0s | B+ | 2/5 | 2/4 | A- | **A-** |

## Summary

- 5/6 above B-
- 2/6 well-grounded (≥3 evidence markers)
- 4/6 show skill discipline (≥2 playbook markers)
- Average evidence count: 2.0/5
- Average skill discipline: 1.5/4

Brain update: submitted.