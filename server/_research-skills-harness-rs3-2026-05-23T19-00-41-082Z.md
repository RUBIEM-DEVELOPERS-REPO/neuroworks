# Research/analysis skills harness — PARALLEL :: rs3 :: 2026-05-23T18:56:27.816Z
Server: http://127.0.0.1:7471
Probes: 6 (each REQUIRES external sources). Targets the new analysis skills (benchmark-lookup, source-triangulation, primary-source-check, landscape-scan) + upgraded research-deep / fact-check / competitive-analysis.

Initial pool: primary inflight=0; peers=secondary@7473 inflight=0; pool=1/3

  ── dispatched 6 probes in 39.8s; awaiting completions in parallel
✓ fiona-saas-ndr-benchmark-table             73.4s :: shape B- · evidence 2/5 [attribution,real-entities] · skill 0/4 [] → B- → B-  len=378
✗ researcher-llm-cost-triangulation          186.0s :: shape C · evidence 1/5 [attribution] · skill 0/4 [] → C → C  len=473
✓ logan-stripe-pricing-primary-source        88.7s :: shape B+ · evidence 2/5 [attribution,real-entities] · skill 4/4 [tier-tagged,direct-quote,primary-named,dated] → A → A  len=1434
✓ priya-ai-agent-landscape-scan              232.0s :: shape B- · evidence 3/5 [attribution,dated,real-entities] · skill 3/4 [segmentation,recent-moves,white-space] → A- → A-  len=2390
✗ maya-notion-launch-competitive-research    116.6s :: shape C+ · evidence 2/5 [attribution,real-entities] · skill 0/4 [] → C+ → C+  len=339
✓ fiona-mfn-clause-fact-check                144.0s :: shape B+ · evidence 1/5 [attribution] · skill 3/4 [verdict-shape,for-against,flip-line] → A- → A-  len=1468

## Parallelism

- Wall clock: 253.1s (vs ~1530s sequential target sum)
- Speedup: 6.05× over sequential
- Peak concurrent inflight (primary + peers): 11
- Peak managed worker pool size: 3/3
- Samples where primary AND a peer both had ≥1 inflight: 103 (both-clawbots-working)
- Distinct peer ports loaded: {7473}

## Scorecard

| Probe | Persona | Skill | Target | Elapsed | Shape | Evidence | Skill disc. | Combined | FINAL |
|---|---|---|---|---|---|---|---|---|---|
| fiona-saas-ndr-benchmark-table | financial-analyst | benchmark-lookup | 240s | 73.4s | B- | 2/5 | 0/4 | B- | **B-** |
| researcher-llm-cost-triangulation | researcher | source-triangulation | 360s | 186.0s | C | 1/5 | 0/4 | C | **C** |
| logan-stripe-pricing-primary-source | contracts-reviewer | primary-source-check | 210s | 88.7s | B+ | 2/5 | 4/4 | A | **A** |
| priya-ai-agent-landscape-scan | product-manager | landscape-scan | 240s | 232.0s | B- | 3/5 | 3/4 | A- | **A-** |
| maya-notion-launch-competitive-research | marketing-manager | research-deep | 240s | 116.6s | C+ | 2/5 | 0/4 | C+ | **C+** |
| fiona-mfn-clause-fact-check | contracts-reviewer | fact-check | 240s | 144.0s | B+ | 1/5 | 3/4 | A- | **A-** |

## Summary

- 4/6 above B-
- 1/6 well-grounded (≥3 evidence markers)
- 3/6 show skill discipline (≥2 playbook markers)
- Average evidence count: 1.8/5
- Average skill discipline: 1.7/4

Brain update: submitted.