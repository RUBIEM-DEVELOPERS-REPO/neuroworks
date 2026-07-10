# Download & run NeuroWorks on your PC

NeuroWorks runs locally with a **free local core** — no personal keys or cloud
accounts required to start. Cloud models, email, payments, and a synced vault
are optional add-ons you can configure later in `.env`.

## Prerequisites

- **Node.js 20+** — https://nodejs.org (the installer enables `pnpm` for you)
- **Ollama** (recommended, for fully-local AI) — https://ollama.com
  After installing: `ollama pull qwen2.5:3b`

> Without Ollama, NeuroWorks still boots; it just can't run the local model
> until you either install Ollama or add a cloud key (e.g. OpenRouter) in `.env`.

## 1. Get the code

```bash
git clone https://github.com/RUBIEM-DEVELOPERS-REPO/neuroworks.git
cd neuroworks
```

(Or download the ZIP from GitHub and unzip it.)

## 2. Install

**Windows (PowerShell):**
```powershell
powershell -ExecutionPolicy Bypass -File tools\install.ps1
```

**macOS / Linux:**
```bash
sh tools/install.sh
```

The installer checks Node, sets up `pnpm`, installs dependencies, and creates a
starter `.env` from `.env.example`.

## 3. Run

```bash
pnpm dev
```

Then open **http://127.0.0.1:7470** in your browser. The API runs on
`http://127.0.0.1:7471`.

> Tip: `tools\install.ps1 -Start` (or `sh tools/install.sh --start`) installs
> **and** launches in one step.

## What works out of the box (free core)

- The full NeuroWorks UI, agents, tasks, skills, and personas
- Local model inference via Ollama
- The Intellinexus **Data Pipeline** (publish datasets that agents learn from)
- Knowledge Packs and the local vault browser

## Optional add-ons (edit `.env`)

| Feature | Set in `.env` |
|---|---|
| Cloud models | `OPENROUTER_API_KEY` / `OPENAI_API_KEY` |
| GitHub-synced vault | `GITHUB_TOKEN`, `VAULT_REPO`, `VAULT_PATH` |
| Email send (Mailjet) | `MAILJET_*` |
| Payments (Stripe) | `STRIPE_*` |
| Calendar | `NEUROWORKS_CALENDAR_ICAL_URL` |

Every value in `.env.example` is a placeholder — fill in only what you need.

## Let other systems dispatch agents into NeuroWorks

NeuroWorks can act as an orchestration layer. Mint an API key (Settings, or
`POST /api/dispatch-keys`), then call:

```bash
curl -X POST http://127.0.0.1:7471/api/v1/dispatch \
  -H "Authorization: Bearer nw_..." \
  -H "Content-Type: application/json" \
  -d '{"task":"Summarise today’s sales", "callbackUrl":"https://your-app/webhook"}'
# -> { "jobId": "...", "status": "accepted" }
```

Poll `GET /api/v1/dispatch/:jobId` or receive an HMAC-signed webhook on
completion (set `NW_WEBHOOK_SIGNING_SECRET` in `.env` to enable signatures).
