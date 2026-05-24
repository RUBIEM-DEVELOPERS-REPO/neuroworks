# Research/analysis skills harness — PARALLEL :: rs4 :: 2026-05-23T19:02:51.030Z
Server: http://127.0.0.1:7471
Probes: 6 (each REQUIRES external sources). Targets the new analysis skills (benchmark-lookup, source-triangulation, primary-source-check, landscape-scan) + upgraded research-deep / fact-check / competitive-analysis.

Initial pool: primary inflight=0; peers=secondary@7473 inflight=0; pool=3/3

  ── dispatched 6 probes in 36.4s; awaiting completions in parallel
✓ fiona-saas-ndr-benchmark-table             139.7s :: shape B- · evidence 2/5 [attribution,real-entities] · skill 0/4 [] → B+ → B+  len=561
✓ researcher-llm-cost-triangulation          121.6s :: shape B- · evidence 3/5 [attribution,dated,real-entities] · skill 2/4 [agree-line,diverge-line] → B+ → B+  len=1626
✓ logan-stripe-pricing-primary-source        130.9s :: shape B+ · evidence 3/5 [cites[N],attribution,real-entities] · skill 2/4 [direct-quote,primary-named] → A- → A-  len=1024
✓ priya-ai-agent-landscape-scan              143.1s :: shape B- · evidence 2/5 [attribution,real-entities] · skill 3/4 [segmentation,recent-moves,white-space] → B+ → B+  len=1160
✗ maya-notion-launch-competitive-research    149.1s :: shape C+ · evidence 2/5 [attribution,real-entities] · skill 0/4 [] → C+ → C+  len=307
✓ fiona-mfn-clause-fact-check                158.2s :: shape B+ · evidence 2/5 [cites[N],attribution] · skill 2/4 [for-against,flip-line] → A- → A-  len=1382

## Parallelism

- Wall clock: 188.6s (vs ~1530s sequential target sum)
- Speedup: 8.11× over sequential
- Peak concurrent inflight (primary + peers): 11
- Peak managed worker pool size: 3/3
- Samples where primary AND a peer both had ≥1 inflight: 78 (both-clawbots-working)
- Distinct peer ports loaded: {7473}

## Scorecard

| Probe | Persona | Skill | Target | Elapsed | Shape | Evidence | Skill disc. | Combined | FINAL |
|---|---|---|---|---|---|---|---|---|---|
| fiona-saas-ndr-benchmark-table | financial-analyst | benchmark-lookup | 240s | 139.7s | B- | 2/5 | 0/4 | B+ | **B+** |
| researcher-llm-cost-triangulation | researcher | source-triangulation | 360s | 121.6s | B- | 3/5 | 2/4 | B+ | **B+** |
| logan-stripe-pricing-primary-source | contracts-reviewer | primary-source-check | 210s | 130.9s | B+ | 3/5 | 2/4 | A- | **A-** |
| priya-ai-agent-landscape-scan | product-manager | landscape-scan | 240s | 143.1s | B- | 2/5 | 3/4 | B+ | **B+** |
| maya-notion-launch-competitive-research | marketing-manager | research-deep | 240s | 149.1s | C+ | 2/5 | 0/4 | C+ | **C+** |
| fiona-mfn-clause-fact-check | contracts-reviewer | fact-check | 240s | 158.2s | B+ | 2/5 | 2/4 | A- | **A-** |

## Summary

- 5/6 above B-
- 2/6 well-grounded (≥3 evidence markers)
- 4/6 show skill discipline (≥2 playbook markers)
- Average evidence count: 2.3/5
- Average skill discipline: 1.5/4

Brain update: submitted.