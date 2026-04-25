# clawbot

Cloud-side worker that feeds GitHub activity into the `main-brain` Obsidian vault.

## What it does

Two entrypoints:

1. **`pnpm digest`** — runs in GitHub Actions on a daily cron (also `workflow_dispatch`). Scans every repo the user owns/collaborates on, summarizes recent commits, open PRs, and open issues, and writes:
   - `_clawbot/YYYY-MM-DD.md` — daily digest
   - `_clawbot/latest.md` — copy of today's digest
   - `_clawbot/repos/<owner>-<name>.md` — per-repo snapshot
   - `_clawbot/_meta/last-run.json` — run metadata
   Then commits and pushes to `main-brain`.

2. **`pnpm publish-folder <path>`** — local utility you run on your machine. Takes a local folder, ensures it's a git repo, creates a matching private repo on GitHub, and pushes. Use it to publish folders the cloud bot can't see (company docs, notes, ad-hoc projects).

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
