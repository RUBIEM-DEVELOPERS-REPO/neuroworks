# clawbot + NeuroWorks

Local AI workforce console paired with an Obsidian second-brain.

Two surfaces in one repo:

- **clawbot** — cloud cron worker (GitHub Actions) that feeds repo activity into the `main-brain` Obsidian vault.
- **NeuroWorks** — local web console for chatting with clawbot, browsing the vault, running templated tasks, and reviewing daily reflections. Multi-clawbot capable (primary + secondary worker).

## What clawbot does

Three entrypoints:

1. **`pnpm digest`** — runs in GitHub Actions on a daily cron (also `workflow_dispatch`). Scans every repo the user owns/collaborates on, summarizes recent commits, open PRs, and open issues, and writes:
   - `_clawbot/YYYY-MM-DD.md` — daily digest
   - `_clawbot/latest.md` — copy of today's digest
   - `_clawbot/repos/<owner>-<name>.md` — per-repo snapshot
   - `_clawbot/_meta/last-run.json` — run metadata

2. **`pnpm publish-folder <path>`** — local utility that takes a local folder, ensures it's a git repo, creates a matching private repo on GitHub, and pushes.

3. **`pnpm dev`** (alias **`pnpm neuroworks`**) — launches the NeuroWorks local console (server + web) at http://127.0.0.1:7470. See below.

## NeuroWorks — local console

Local-only browser app. Bind: `127.0.0.1:7470` (web) and `127.0.0.1:7471` (server). Loopback-only and additionally protected by a Host + Origin allow-list against DNS-rebinding / cross-origin POST attacks (see [Security](#security)).

### Pages

- **Dashboard** — vault path, Ollama health, last workflow run, latest digest preview, one-click "Run digest" trigger.
- **Chat** — free-form chat that runs through the agent loop. Plans, executes, synthesizes, streams the answer back live.
- **Templates** — curated and persona-tuned task templates.
- **Tasks** — kick off `daily-digest.yml` via `workflow_dispatch`, see latest run state.
- **Activity** — recent jobs with live status.
- **Results** — outcome card for any completed job (duration + top-source previews).
- **Approvals** — gate for templates marked `requiresApproval`.
- **Knowledge** — Obsidian vault browser at `D:\Main brain` with markdown rendering and full-text search.
- **Personas** — manage AI employees (role, tone, responsibilities, system prompt overrides).
- **Settings** — model selection, OpenRouter pins, persona-template defaults.
- **Admin** — vault stats, peer registry, worker status, security gates.

### First run

```sh
cp .env.example .env       # fill in GITHUB_TOKEN at minimum
pnpm install               # installs root + server + web workspaces
ollama serve &             # start Ollama if not already running
pnpm dev                   # starts server + web concurrently
```

Open http://127.0.0.1:7470.

### Configuration

`.env` keys (see `.env.example`):
- `GITHUB_TOKEN` — fine-grained PAT (same one used for `CLAWBOT_PAT`).
- `GITHUB_OWNER` — `RUBIEM-DEVELOPERS-REPO`.
- `VAULT_REPO` — `RUBIEM-DEVELOPERS-REPO/main-brain`.
- `VAULT_PATH` — local path to vault (`D:\Main brain`).
- `OLLAMA_HOST` — defaults to `http://127.0.0.1:11434`.
- `OLLAMA_MODEL` — defaults to `qwen2.5:3b`. Pull a stronger model for better summaries: `ollama pull llama3.1:8b`.
- `OPENROUTER_API_KEY` — optional cloud LLM acceleration for planning/synthesis when local Ollama can't keep up.
- `NEUROWORKS_PORT` — server bind port (default `7471`).

## Skills

The agent ships with 40+ skill `.md` playbooks at [server/src/skills/](server/src/skills/) covering doc shapes from memo-writing to incident-post-mortem. When the synth picker matches a task to a skill, the playbook gets attached to the LLM prompt as guidance.

Browse the catalog at `GET /api/skills` (JSON) — `name`, `description`, `source`, `applies_to`, `bodyChars`. Full body at `GET /api/skills/:name`.

User playbooks dropped under [server/src/skills/_user/](server/src/skills/_user/) (gitignored) override built-ins with the same name. Remote skill fetching is gated behind `CLAWBOT_REMOTE_SKILLS=1` — see `.env.example`.

The reflection loop reports per-skill success rate + avg picker score in the daily reflection, so weak playbooks surface for revision.

## Security

NeuroWorks binds loopback-only, but loopback alone doesn't defeat two real browser-side attacks:

- **DNS rebinding** — a malicious page resolves `evil.com:7471` to `127.0.0.1`. The Host header (`evil.com:7471`) is the giveaway.
- **Cross-origin POST** — `text/plain` JSON skips the CORS preflight. The Origin header reveals the source page.

The server enforces:

- **Host header allow-list**: `127.0.0.1:<port>` and `localhost:<port>` only.
- **Origin header allow-list**: when set, must match `http://127.0.0.1:7470` (override with `CLAWBOT_WEB_ORIGIN`).
- `/api/health` and `/api/peers/self` exempt for handshake.
- `OPTIONS` preflight passes through.
- Lift entirely with `CLAWBOT_ORIGIN_GUARD=0` (e.g., when fronted by a reverse proxy that rewrites Host — logged).

Path + URL gates on agent primitives:
- `CLAWBOT_FS_UNRESTRICTED=1` — lifts the sensitive-path guard for `fs.read_external` / `fs.list_external`.
- `CLAWBOT_WEB_ALLOW_PRIVATE=1` — lifts the SSRF guard against private/loopback IPs.
- `CLAWBOT_VAULT_EDIT=1` — enables `vault.edit` (off by default).
- Vault writes scanned for high-severity secrets — refused outright (set `CLAWBOT_VAULT_SCAN=0` to disable, not recommended).

## How summaries work

`POST /api/repos/:owner/:name/summarize`:
1. Fetches README + last 90 days of commits + open PRs + open issues from GitHub.
2. Sends a tight system-prompted Ollama generation (Purpose / Stack / State / Recent direction / Notable open work).
3. Writes `_clawbot/summaries/<owner>-<name>.md` into the vault.
4. `git commit && git push` to keep the vault repo in sync.

The Knowledge page lists committed summaries; click "Refresh summary" to regenerate.

## Persistence + reflection

- Job history persists as append-only JSONL at `.neuroworks/jobs/<YYYY-MM-DD>.jsonl` (gitignored). Survives restarts and the in-memory `RECENT=50` cap.
- Daily reflection at 2 AM local (configurable via `CLAWBOT_REFLECTION_HOUR`) aggregates the last 24h across the local store, in-memory state, and every peer's `/api/peers/jobs` endpoint — so delegations to the secondary are visible.
- Output lands at `<vault>/_neuroworks/reflections/<YYYY-MM-DD>.md` with sections "What went well / What went wrong / What I notice / What to try next" plus a raw stats snapshot.

## Multi-clawbot (primary + secondary)

```sh
pnpm dev          # primary on :7471, web on :7470
pnpm secondary    # secondary on :7473 — auto-registers with primary
```

The secondary acts as a parallel worker for sub-agent fan-out + the curation/review gate. Auto-discovery scans localhost every 60s.

## Tests

```sh
pnpm -F clawbot-server test         # vitest suite (one-shot)
pnpm -F clawbot-server test:watch   # vitest watch mode
```

Tests cover the cascade contract: heuristic planning, skill picker scoring, direct-answer triage, and the origin guard. Don't refactor `agent.ts` without running the suite — the regexes are easy to drift.

## Required configuration (GitHub Actions side)

- **Secret `CLAWBOT_PAT`** — fine-grained personal access token with: Contents read+write on the vault repo, Contents read across all owned repos, Metadata read, Pull requests read, Issues read, Administration read+write (for `publish-folder` to create new repos).
- **Variable `VAULT_REPO`** — `<owner>/main-brain`.

## Local use

```sh
pnpm install
GITHUB_TOKEN=ghp_... GITHUB_OWNER=arthurmagaya pnpm publish-folder "D:\some\folder"
```

## Why this isn't an openclaw plugin

Openclaw is local-first by design — it expects a long-running gateway, channel sockets, and `~/.openclaw/` credentials state. None of that fits a cron job in GitHub Actions. The clawbot is intentionally slim (~200 LOC on the cron side) and joined to the rest of the system via the vault git repo. Openclaw, running locally, will read that vault as memory and surface clawbot output through whatever channel (Telegram/Slack/etc.) you configure it for.
