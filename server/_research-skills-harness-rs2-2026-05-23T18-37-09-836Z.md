# Research/analysis skills harness — PARALLEL :: rs2 :: 2026-05-23T18:34:04.129Z
Server: http://127.0.0.1:7471
Probes: 6 (each REQUIRES external sources). Targets the new analysis skills (benchmark-lookup, source-triangulation, primary-source-check, landscape-scan) + upgraded research-deep / fact-check / competitive-analysis.

Initial pool: primary inflight=0; peers=secondary@7473 inflight=0; pool=1/3

  ── dispatched 6 probes in 36.7s; awaiting completions in parallel
✗ fiona-saas-ndr-benchmark-table             140.0s :: shape C · evidence 2/5 [attribution,real-entities] · skill 2/4 [distribution-words,caveats] → C → C  len=803
✗ researcher-llm-cost-triangulation          152.1s :: shape C · evidence 3/5 [attribution,dated,real-entities] · skill 2/4 [agree-line,diverge-line] → C+ → C+  len=2066
✓ logan-stripe-pricing-primary-source        161.4s :: shape B+ · evidence 3/5 [URLs,attribution,real-entities] · skill 1/4 [primary-named] → B+ → B+  len=1459
✗ priya-ai-agent-landscape-scan              167.3s :: shape C · evidence 3/5 [cites[N],attribution,real-entities] · skill 3/4 [segmentation,recent-moves,white-space] → C+ → C+  len=2452
✓ maya-notion-launch-competitive-research    98.0s :: shape B- · evidence 1/5 [real-entities] · skill 0/4 [] → B- → B-  len=853
✓ fiona-mfn-clause-fact-check                149.1s :: shape B+ · evidence 2/5 [URLs,attribution] · skill 3/4 [verdict-shape,for-against,flip-line] → A- → A-  len=1677

## Parallelism

- Wall clock: 185.6s (vs ~1530s sequential target sum)
- Speedup: 8.25× over sequential
- Peak concurrent inflight (primary + peers): 11
- Peak managed worker pool size: 3/3
- Samples where primary AND a peer both had ≥1 inflight: 82 (both-clawbots-working)
- Distinct peer ports loaded: {7473}

## Scorecard

| Probe | Persona | Skill | Target | Elapsed | Shape | Evidence | Skill disc. | Combined | FINAL |
|---|---|---|---|---|---|---|---|---|---|
| fiona-saas-ndr-benchmark-table | financial-analyst | benchmark-lookup | 240s | 140.0s | C | 2/5 | 2/4 | C | **C** |
| researcher-llm-cost-triangulation | researcher | source-triangulation | 360s | 152.1s | C | 3/5 | 2/4 | C+ | **C+** |
| logan-stripe-pricing-primary-source | contracts-reviewer | primary-source-check | 210s | 161.4s | B+ | 3/5 | 1/4 | B+ | **B+** |
| priya-ai-agent-landscape-scan | product-manager | landscape-scan | 240s | 167.3s | C | 3/5 | 3/4 | C+ | **C+** |
| maya-notion-launch-competitive-research | marketing-manager | research-deep | 240s | 98.0s | B- | 1/5 | 0/4 | B- | **B-** |
| fiona-mfn-clause-fact-check | contracts-reviewer | fact-check | 240s | 149.1s | B+ | 2/5 | 3/4 | A- | **A-** |

## Summary

- 3/6 above B-
- 3/6 well-grounded (≥3 evidence markers)
- 4/6 show skill discipline (≥2 playbook markers)
- Average evidence count: 2.3/5
- Average skill discipline: 1.8/4

Brain update: submitted.