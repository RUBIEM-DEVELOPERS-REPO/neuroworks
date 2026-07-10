# Research/analysis skills harness — PARALLEL :: rs5 :: 2026-05-24T14:56:59.706Z
Server: http://127.0.0.1:7471
Probes: 6 (each REQUIRES external sources). Targets the new analysis skills (benchmark-lookup, source-triangulation, primary-source-check, landscape-scan) + upgraded research-deep / fact-check / competitive-analysis.

Initial pool: primary inflight=0; peers=secondary@7473 inflight=0; pool=3/3

  ── dispatched 6 probes in 38.8s; awaiting completions in parallel
✓ fiona-saas-ndr-benchmark-table             105.5s :: shape B · evidence 2/5 [attribution,real-entities] · skill 1/4 [distribution-words] → B+ → B+  len=1473
✓ researcher-llm-cost-triangulation          102.4s :: shape B · evidence 2/5 [attribution,real-entities] · skill 2/4 [agree-line,diverge-line] → B+ → B+  len=1432
✓ logan-stripe-pricing-primary-source        72.5s :: shape B+ · evidence 3/5 [URLs,attribution,real-entities] · skill 2/4 [tier-tagged,primary-named] → A- → A-  len=2003
✓ priya-ai-agent-landscape-scan              248.6s :: shape B · evidence 2/5 [attribution,real-entities] · skill 3/4 [segmentation,recent-moves,white-space] → A- → A-  len=3600
✗ maya-notion-launch-competitive-research    103.7s :: shape C · evidence 0/5 [] · skill 0/4 [] → C → C  len=205
✓ fiona-mfn-clause-fact-check                109.7s :: shape B+ · evidence 2/5 [cites[N],attribution] · skill 2/4 [for-against,flip-line] → A- → A-  len=1551

## Parallelism

- Wall clock: 269.2s (vs ~1530s sequential target sum)
- Speedup: 5.68× over sequential
- Peak concurrent inflight (primary + peers): 11
- Peak managed worker pool size: 3/3
- Samples where primary AND a peer both had ≥1 inflight: 122 (both-clawbots-working)
- Distinct peer ports loaded: {7473}

## Scorecard

| Probe | Persona | Skill | Target | Elapsed | Shape | Evidence | Skill disc. | Combined | FINAL |
|---|---|---|---|---|---|---|---|---|---|
| fiona-saas-ndr-benchmark-table | financial-analyst | benchmark-lookup | 240s | 105.5s | B | 2/5 | 1/4 | B+ | **B+** |
| researcher-llm-cost-triangulation | researcher | source-triangulation | 360s | 102.4s | B | 2/5 | 2/4 | B+ | **B+** |
| logan-stripe-pricing-primary-source | contracts-reviewer | primary-source-check | 210s | 72.5s | B+ | 3/5 | 2/4 | A- | **A-** |
| priya-ai-agent-landscape-scan | product-manager | landscape-scan | 240s | 248.6s | B | 2/5 | 3/4 | A- | **A-** |
| maya-notion-launch-competitive-research | marketing-manager | research-deep | 240s | 103.7s | C | 0/5 | 0/4 | C | **C** |
| fiona-mfn-clause-fact-check | contracts-reviewer | fact-check | 240s | 109.7s | B+ | 2/5 | 2/4 | A- | **A-** |

## Summary

- 5/6 above B-
- 1/6 well-grounded (≥3 evidence markers)
- 4/6 show skill discipline (≥2 playbook markers)
- Average evidence count: 1.8/5
- Average skill discipline: 1.7/4

Brain update: submitted.