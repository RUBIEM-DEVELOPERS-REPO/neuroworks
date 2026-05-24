# Research/analysis skills harness — PARALLEL :: rs7 :: 2026-05-24T15:41:07.800Z
Server: http://127.0.0.1:7471
Probes: 6 (each REQUIRES external sources). Targets the new analysis skills (benchmark-lookup, source-triangulation, primary-source-check, landscape-scan) + upgraded research-deep / fact-check / competitive-analysis.

Initial pool: primary inflight=0; peers=secondary@7473 inflight=0; pool=3/3

  ── dispatched 6 probes in 36.3s; awaiting completions in parallel
✓ fiona-saas-ndr-benchmark-table             91.8s :: shape B · evidence 2/5 [attribution,real-entities] · skill 2/4 [distribution-words,caveats] → B+ → B+  len=1029
✓ researcher-llm-cost-triangulation          100.8s :: shape B · evidence 2/5 [attribution,real-entities] · skill 2/4 [agree-line,diverge-line] → B+ → B+  len=1307
✓ logan-stripe-pricing-primary-source        116.7s :: shape B+ · evidence 3/5 [URLs,attribution,real-entities] · skill 2/4 [direct-quote,primary-named] → A- → A-  len=760
✓ priya-ai-agent-landscape-scan              168.0s :: shape C+ · evidence 2/5 [attribution,real-entities] · skill 2/4 [segmentation,recent-moves] → B+ → B+  len=910
✓ maya-notion-launch-competitive-research    77.5s :: shape B · evidence 2/5 [attribution,real-entities] · skill 0/4 [] → B+ → B+  len=1004
✓ fiona-mfn-clause-fact-check                92.6s :: shape B+ · evidence 1/5 [attribution] · skill 3/4 [verdict-shape,for-against,flip-line] → A- → A-  len=1734

## Parallelism

- Wall clock: 186.2s (vs ~1530s sequential target sum)
- Speedup: 8.22× over sequential
- Peak concurrent inflight (primary + peers): 11
- Peak managed worker pool size: 3/3
- Samples where primary AND a peer both had ≥1 inflight: 84 (both-clawbots-working)
- Distinct peer ports loaded: {7473}

## Scorecard

| Probe | Persona | Skill | Target | Elapsed | Shape | Evidence | Skill disc. | Combined | FINAL |
|---|---|---|---|---|---|---|---|---|---|
| fiona-saas-ndr-benchmark-table | financial-analyst | benchmark-lookup | 240s | 91.8s | B | 2/5 | 2/4 | B+ | **B+** |
| researcher-llm-cost-triangulation | researcher | source-triangulation | 360s | 100.8s | B | 2/5 | 2/4 | B+ | **B+** |
| logan-stripe-pricing-primary-source | contracts-reviewer | primary-source-check | 210s | 116.7s | B+ | 3/5 | 2/4 | A- | **A-** |
| priya-ai-agent-landscape-scan | product-manager | landscape-scan | 240s | 168.0s | C+ | 2/5 | 2/4 | B+ | **B+** |
| maya-notion-launch-competitive-research | marketing-manager | research-deep | 240s | 77.5s | B | 2/5 | 0/4 | B+ | **B+** |
| fiona-mfn-clause-fact-check | contracts-reviewer | fact-check | 240s | 92.6s | B+ | 1/5 | 3/4 | A- | **A-** |

## Summary

- 6/6 above B-
- 1/6 well-grounded (≥3 evidence markers)
- 5/6 show skill discipline (≥2 playbook markers)
- Average evidence count: 2.0/5
- Average skill discipline: 1.8/4

Brain update: submitted.