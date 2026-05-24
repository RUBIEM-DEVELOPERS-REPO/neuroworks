# All-templates harness w/ pool scaling :: atp3 :: 2026-05-24T18:59:33.468Z
Server: http://127.0.0.1:7471 · model=qwen2.5:3b · OR=enabled
Templates: 156 total (Engineering=3, Knowledge=4, Insights=1, Custom=148)
Initial pool: pool=1/3; peers=secondary@7473 inflight=0

## Phase A — invocation safety (ALL 156 templates)

Phase A: 156/156 A · 0 F · 0 other

  ── draining 156 Phase A jobs (max 5 min)…
  ── Phase A drain done in 223.4s

## Phase B — content-graded sample

Sample: 8 built-in + 9 custom = 17 probes

Phase B: 17/17 at B+ or higher

## Phase C — overload burst (persona-shifter scaling 1→2→3)

  ── stopped all managed workers (pool count: 0)
  ── started base worker (pool count: 1 on http://127.0.0.1:7473)
Pre-burst pool: count=1/3; primary inflight=0; peers=
  ── preload dispatched (jobId=eff472dd, kind=task, routed to primary) — keeps primary busy during burst
  ── 6 burst tasks dispatched in 6.2s
     dispatch routing: peer@7473, peer@7473, primary, primary, peer@7473, peer@7473
  ── pool growth during 30s burst window:
     t+0.1s: pool=3 peers=3 primaryInflight=7
  ── final pool: count=3/3 (started at 1)
  ── draining 7 burst+preload jobs…
  ── drain done in 199.9s; 7/7 succeeded

## Pool scaling

| Phase | Peak pool | Peak concurrent | Both-busy samples | Scale events |
|---|---|---|---|---|
| Phase A | 1/3 | 50 | 0 | (none) |
| Phase B | 1/3 | 3 | 80 | (none) |
| Phase C | 3/3 | 11 | 175 | 0→1, 1→3 |
| OVERALL | 3/3 | 50 | 255 | 1→0, 0→1, 1→3 |

## Phase B scorecard

| template | role | target | elapsed | content | time | FINAL |
|---|---|---|---|---|---|---|
| summarize-repo | Engineering | 120s | 48.3s | A | 0 | **A** |
| run-digest | Engineering | 60s | 3s | A | 0 | **A** |
| publish-folder | Engineering | 150s | 0s | A | 0 | **A** |
| search-brain | Knowledge | 15s | 0s | A | 0 | **A** |
| add-note | Knowledge | 25s | 0s | A | 0 | **A** |
| browse-vault | Knowledge | 5s | 0s | A | 0 | **A** |
| general-task | Insights | 90s | 93.4s | A | 0 | **A** |
| sync-downloads | Knowledge | 120s | 0s | A | 0 | **A** |
| custom-give-me-a-report-on-the-r-d-ai-research-project-in-my | Custom | 150s | 21.1s | A- | 0 | **A-** |
| custom-what-is-in-the-readme-of-the-clawbot-repo-on-github | Custom | 150s | 18.1s | A- | 0 | **A-** |
| custom-compare-what-my-vault-says-about-neuroworks-to-the-cl | Custom | 150s | 36.1s | A- | 0 | **A-** |
| custom-give-me-a-summary-on-neuroworks | Custom | 150s | 15.1s | A- | 0 | **A-** |
| custom-insurance-sales-agent-sell-auto-home-life-health-or-c | Custom | 150s | 108.5s | B+ | 0 | **B+** |
| custom-head-of-ai-define-and-lead-the-company-s-overall-ai | Custom | 150s | 111.5s | A- | 0 | **A-** |
| custom-clawbot-daily-focus | Custom | 150s | 102.4s | A- | 0 | **A-** |
| custom-clawbot-quick-web-look-up | Custom | 150s | 42.2s | A- | 0 | **A-** |
| custom-researcher-latest-news-scan-web-only | Custom | 150s | 111.5s | A- | 0 | **A-** |

## Phase A summary (per-grade counts)

| Grade | Count |
|---|---|
| A | 156 |

## Combined summary

- 173/173 rows at B+ or higher (Phase A invocation + Phase B content-graded)
- Phase A: 156/156 A (all templates addressable & dispatch-safe)
- Phase B: 17/17 content-graded at B+ or higher
- Phase C overload burst: pool scaled to 3/3 ✓ scaling observed
- Both-clawbots-working: 255 samples across all phases
