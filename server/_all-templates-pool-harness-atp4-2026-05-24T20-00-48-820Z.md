# All-templates harness w/ pool scaling :: atp4 :: 2026-05-24T19:38:55.313Z
Server: http://127.0.0.1:7471 · model=qwen2.5:3b · OR=enabled
Templates: 186 total (Engineering=3, Knowledge=4, Insights=1, Custom=178)
Initial pool: pool=1/3; peers=secondary@7473 inflight=0

## Phase A — invocation safety (ALL 186 templates)

Phase A: 186/186 A · 0 F · 0 other

  ── draining 186 Phase A jobs (max 5 min)…
  ── Phase A drain done in 302.3s

## Phase B — content-graded sample

Sample: 8 built-in + 15 custom = 23 probes

Phase B: 22/23 at B+ or higher

## Phase C — overload burst (persona-shifter scaling 1→2→3)

  ── stopped all managed workers (pool count: 0)
  ── started base worker (pool count: 1 on http://127.0.0.1:7473)
Pre-burst pool: count=1/3; primary inflight=0; peers=
  ── preload dispatched (jobId=a55ede9c, kind=task, routed to primary) — keeps primary busy during burst
  ── 6 burst tasks dispatched in 6.1s
     dispatch routing: peer@7473, peer@7473, peer@7473, peer@7473, peer@7473, peer@7473
  ── pool growth during 30s burst window:
     t+0.2s: pool=1 peers=1 primaryInflight=7
  ── final pool: count=1/3 (started at 1)
  ── draining 7 burst+preload jobs…
  ── drain done in 125.1s; 4/7 succeeded

## Pool scaling

| Phase | Peak pool | Peak concurrent | Both-busy samples | Scale events |
|---|---|---|---|---|
| Phase A | 1/3 | 50 | 0 | (none) |
| Phase B | 1/3 | 6 | 74 | (none) |
| Phase C | 1/3 | 13 | 141 | 0→1, 1→0 |
| OVERALL | 1/3 | 50 | 215 | 1→0, 0→1, 1→0 |

## Phase B scorecard

| template | role | target | elapsed | content | time | FINAL |
|---|---|---|---|---|---|---|
| summarize-repo | Engineering | 120s | 15.2s | A | 0 | **A** |
| run-digest | Engineering | 60s | 3.1s | F | 0 | **F** |
| publish-folder | Engineering | 150s | 0s | A | 0 | **A** |
| search-brain | Knowledge | 15s | 0s | A | 0 | **A** |
| add-note | Knowledge | 25s | 0s | A | 0 | **A** |
| browse-vault | Knowledge | 5s | 0s | A | 0 | **A** |
| general-task | Insights | 90s | 87.4s | A | 0 | **A** |
| sync-downloads | Knowledge | 120s | 0s | A | 0 | **A** |
| custom-give-me-a-report-on-the-r-d-ai-research-project-in-my | Custom | 150s | 12.1s | A- | 0 | **A-** |
| custom-what-is-in-the-readme-of-the-clawbot-repo-on-github | Custom | 150s | 9.1s | A- | 0 | **A-** |
| custom-compare-what-my-vault-says-about-neuroworks-to-the-cl | Custom | 150s | 18.1s | A- | 0 | **A-** |
| custom-give-me-a-summary-on-neuroworks | Custom | 150s | 48.2s | A- | 0 | **A-** |
| custom-head-of-ai-define-and-lead-the-company-s-overall-ai | Custom | 150s | 96.4s | A- | 0 | **A-** |
| custom-clawbot-quick-web-look-up | Custom | 150s | 78.3s | A- | 0 | **A-** |
| custom-researcher-latest-news-scan-web-only | Custom | 150s | 144.6s | A- | 0 | **A-** |
| custom-emp-meeting-to-actions | Custom | 150s | 78.3s | A- | 0 | **A-** |
| custom-emp-cv-screening | Custom | 150s | 81.3s | A- | 0 | **A-** |
| custom-emp-vendor-comparison | Custom | 150s | 144.5s | A- | 0 | **A-** |
| custom-emp-compliance-check | Custom | 150s | 72.3s | A- | 0 | **A-** |
| custom-emp-support-ticket-themes | Custom | 150s | 90.4s | A- | 0 | **A-** |
| custom-emp-kb-article-from-ticket | Custom | 150s | 117.5s | A- | 0 | **A-** |
| custom-emp-slide-outline | Custom | 150s | 262s | A- | -1 | **B+** |
| custom-emp-tomorrow-work-plan | Custom | 150s | 120.4s | A- | 0 | **A-** |

## Phase A summary (per-grade counts)

| Grade | Count |
|---|---|
| A | 186 |

## Combined summary

- 208/209 rows at B+ or higher (Phase A invocation + Phase B content-graded)
- Phase A: 186/186 A (all templates addressable & dispatch-safe)
- Phase B: 22/23 content-graded at B+ or higher
- Phase C overload burst: pool scaled to 1/3 ✗ no scaling
- Both-clawbots-working: 215 samples across all phases
