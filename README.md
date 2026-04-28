# clawbot + NeuroWorks

Two surfaces in one repo:

- **clawbot** — cloud cron worker (GitHub Actions) that feeds repo activity into the `main-brain` Obsidian vault.
- **NeuroWorks** — local web console for interacting with clawbot, browsing the vault, and generating LLM-backed repo summaries via Ollama.

## What clawbot does

Three entrypoints:

1. **`pnpm digest`** — runs in GitHub Actions on a daily cron (also `workflow_dispatch`). Scans every repo the user owns/collaborates on, summarizes recent commits, open PRs, and open issues, and writes:
   - `_clawbot/YYYY-MM-DD.md` — daily digest
   - `_clawbot/latest.md` — copy of today's digest
   - `_clawbot/repos/<owner>-<name>.md` — per-repo snapshot
   - `_clawbot/_meta/last-run.json` — run metadata
   Then commits and pushes to `main-brain`.

2. **`pnpm publish-folder <path>`** — local utility you run on your machine. Takes a local folder, ensures it's a git repo, creates a matching private repo on GitHub, and pushes. Use it to publish folders the cloud bot can't see (company docs, notes, ad-hoc projects).

3. **`pnpm dev`** (alias **`pnpm neuroworks`**) — launches the NeuroWorks local console (server + web) at http://127.0.0.1:5173. See below.

## NeuroWorks — local console

Local-only browser app. Bind: `127.0.0.1:5173` (web) and `127.0.0.1:5174` (server). No auth — bound to loopback.

Pages:
- **Dashboard** — vault path, Ollama health, last workflow run, latest digest preview, one-click "Run digest" trigger.
- **Repos** — list every repo visible to clawbot. Click for per-repo detail with commits, PRs, issues, and an LLM-generated summary.
- **Brain** — file browser for `D:\Main brain` with markdown rendering and full-text search.
- **Tasks** — kick off `daily-digest.yml` via `workflow_dispatch`, see latest run state.

### First run

```sh
cp .env.example .env       # fill in GITHUB_TOKEN at minimum
pnpm install               # installs root + server + web workspaces
ollama serve &             # start Ollama if not already running
pnpm dev                   # starts server + web concurrently
```

Open http://127.0.0.1:5173.

### Configuration

`.env` keys (see `.env.example`):
- `GITHUB_TOKEN` — fine-grained PAT (same one used for `CLAWBOT_PAT`).
- `GITHUB_OWNER` — `RUBIEM-DEVELOPERS-REPO`.
- `VAULT_REPO` — `RUBIEM-DEVELOPERS-REPO/main-brain`.
- `VAULT_PATH` — local path to vault (`D:\Main brain`).
- `OLLAMA_HOST` — defaults to `http://127.0.0.1:11434`.
- `OLLAMA_MODEL` — defaults to `qwen3.5:0.8b`. Pull a stronger model for better summaries: `ollama pull llama3.1:8b`.
- `NEUROWORKS_PORT` — server bind port (default `5174`).

### How summaries work

`POST /api/repos/:owner/:name/summarize`:
1. Fetches README + last 90 days of commits + open PRs + open issues from GitHub.
2. Sends a tight system-prompted Ollama generation (Purpose / Stack / State / Recent direction / Notable open work).
3. Writes `_clawbot/summaries/<owner>-<name>.md` into the vault.
4. `git commit && git push` to keep the vault repo in sync.

The Brain page lists committed summaries; click "Refresh summary" to regenerate.

## Required configuration (GitHub Actions side)

- **Secret `CLAWBOT_PAT`** — fine-grained personal access token with: Contents read+write on the vault repo, Contents read across all owned repos, Metadata read, Pull requests read, Issues read, Administration read+write (for `publish-folder` to create new repos).
- **Variable `VAULT_REPO`** — `<owner>/main-brain`.

## Local use

```sh
pnpm install
GITHUB_TOKEN=ghp_... GITHUB_OWNER=arthurmagaya pnpm publish-folder "D:\some\folder"
```

## Why this isn't an openclaw plugin

Openclaw is local-first by design — it expects a long-running gateway, channel sockets, and `~/.openclaw/` credentials state. None of that fits a cron job in GitHub Actions. The clawbot is intentionally slim (~200 LOC) and joined to the rest of the system via the vault git repo. Openclaw, running locally, will read that vault as memory and surface clawbot output through whatever channel (Telegram/Slack/etc.) you configure it for.
