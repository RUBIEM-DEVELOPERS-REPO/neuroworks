# Research/analysis skills harness — PARALLEL :: rs1 :: 2026-05-23T18:26:13.416Z
Server: http://127.0.0.1:7471
Probes: 6 (each REQUIRES external sources). Targets the new analysis skills (benchmark-lookup, source-triangulation, primary-source-check, landscape-scan) + upgraded research-deep / fact-check / competitive-analysis.

Initial pool: primary inflight=0; peers=secondary@7473 inflight=0; pool=1/3

  ── dispatched 6 probes in 36.8s; awaiting completions in parallel
✗ fiona-saas-ndr-benchmark-table             131.2s :: shape C · evidence 2/5 [attribution,real-entities] · skill 1/4 [distribution-words] → C → C  len=801
✗ researcher-llm-cost-triangulation          149.2s :: shape C- · evidence 1/5 [attribution] · skill 0/4 [] → C- → C-  len=275
✓ logan-stripe-pricing-primary-source        179.4s :: shape B+ · evidence 2/5 [attribution,real-entities] · skill 1/4 [primary-named] → B+ → B+  len=612
✗ priya-ai-agent-landscape-scan              176.4s :: shape D · evidence 1/5 [attribution] · skill 2/4 [segmentation,recent-moves] → D → D  len=1069
✗ maya-notion-launch-competitive-research    116.0s :: shape C · evidence 2/5 [attribution,real-entities] · skill 0/4 [] → C → C  len=425
✗ fiona-mfn-clause-fact-check                18.5s :: shape D+ · evidence 0/5 [] · skill 0/4 [] → D+ → D+  len=0

## Parallelism

- Wall clock: 194.7s (vs ~1530s sequential target sum)
- Speedup: 7.86× over sequential
- Peak concurrent inflight (primary + peers): 10
- Peak managed worker pool size: 3/3
- Samples where primary AND a peer both had ≥1 inflight: 74 (both-clawbots-working)
- Distinct peer ports loaded: {7473}

## Scorecard

| Probe | Persona | Skill | Target | Elapsed | Shape | Evidence | Skill disc. | Combined | FINAL |
|---|---|---|---|---|---|---|---|---|---|
| fiona-saas-ndr-benchmark-table | financial-analyst | benchmark-lookup | 240s | 131.2s | C | 2/5 | 1/4 | C | **C** |
| researcher-llm-cost-triangulation | researcher | source-triangulation | 360s | 149.2s | C- | 1/5 | 0/4 | C- | **C-** |
| logan-stripe-pricing-primary-source | contracts-reviewer | primary-source-check | 210s | 179.4s | B+ | 2/5 | 1/4 | B+ | **B+** |
| priya-ai-agent-landscape-scan | product-manager | landscape-scan | 240s | 176.4s | D | 1/5 | 2/4 | D | **D** |
| maya-notion-launch-competitive-research | marketing-manager | research-deep | 240s | 116.0s | C | 2/5 | 0/4 | C | **C** |
| fiona-mfn-clause-fact-check | contracts-reviewer | fact-check | 240s | 18.5s | D+ | 0/5 | 0/4 | D+ | **D+** |

## Summary

- 1/6 above B-
- 0/6 well-grounded (≥3 evidence markers)
- 1/6 show skill discipline (≥2 playbook markers)
- Average evidence count: 1.3/5
- Average skill discipline: 0.7/4

Brain update: submitted.