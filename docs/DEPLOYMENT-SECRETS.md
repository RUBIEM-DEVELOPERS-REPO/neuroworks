# Deployment secrets — rotation runbook

Pre-deploy checklist for the NeuroWorks / clawbot production cut. Every secret
below was, at some point, pasted into a chat or a working file and MUST be
rotated before or at go-live. None of them are committed to git (verified:
`.env` is gitignored, no tracked `.env*`, no secret values in tracked files) —
but a value that has left the machine once is compromised and gets rotated.

> The vault (`D:\Main brain`) syncs to GitHub (`RUBIEM-DEVELOPERS-REPO/main-brain`).
> NEVER put a live secret in a vault note, a committed file, or a chat. Secrets
> live only in `.env` (gitignored) or the container environment / secret store.

## Rotate these (compromised — assume exposed)

| # | Secret | Env var | Where used | How to rotate |
|---|--------|---------|------------|---------------|
| 1 | GitHub PAT | `GITHUB_TOKEN` | vault push, repo digest, publish-folder | GitHub → Settings → Developer settings → Fine-grained tokens → revoke the old, mint new (Contents R/W on `main-brain`, Metadata R). Update `.env` + the digest workflow secret. |
| 2 | OpenRouter API key | `OPENROUTER_API_KEY` | cloud LLM synthesis/large tier | openrouter.ai → Keys → revoke + create. Update `.env`. |
| 3 | OpenAI API key (`sk-…`) | `OPENAI_API_KEY` / model-provider | BYO provider path | platform.openai.com → API keys → revoke + create. Update the provider in the Models UI (re-encrypted) or `.env`. |
| 4 | Slack bot token (`xoxb-…`) | integrations store | `slack.post` (chat.postMessage) | api.slack.com/apps → your app → OAuth & Permissions → **Reinstall** to rotate the bot token (or regenerate). Re-enter it in the Connectors/Integrations UI (stored AES-256-GCM encrypted). |
| 5 | Stripe secret key (`sk_live_…` / `sk_test_…`) | `STRIPE_SECRET_KEY` | payments gateway | dashboard.stripe.com → Developers → API keys → roll. Update `.env`. Also re-check `STRIPE_WEBHOOK_SECRET`. |

## Set these fresh for production (currently blank/dev)

| Secret | Env var | Why |
|--------|---------|-----|
| Webhook signing secret | `NW_WEBHOOK_SIGNING_SECRET` | Signs dispatch completion webhooks (`X-NeuroWorks-Signature`). Set a long random value: `openssl rand -hex 32`. |
| Finance push token | `FINANCE_SYNC_TOKEN` | Shared secret the Finance System sends to POST `/api/public/dashboard`. Leave blank only on a fully trusted network. |
| Allowed hosts | `CLAWBOT_ALLOWED_HOSTS` | Your production hostname(s) so the origin-guard (DNS-rebind defense) accepts the deployed SPA's API calls. |
| Admin password | (Users UI) | Change the seeded admin (`admin@rubiem.com`) password from the dev default on first login. |

## Verify after rotating

```bash
# 1. No secret values in either repo (should print nothing):
git -C <clawbot> grep -iE "ghp_[A-Za-z0-9]{30}|github_pat_|sk-[A-Za-z0-9]{30}|xoxb-[0-9]" -- . ':(exclude).env.example'
git -C "D:/Main brain" grep -iE "ghp_[A-Za-z0-9]{30}|sk-[A-Za-z0-9]{30}|xoxb-[0-9]"

# 2. .env still ignored:
git -C <clawbot> check-ignore .env    # → .env

# 3. Boot in strict mode — refuses to start if a required secret is missing:
NODE_ENV=production SERVE_WEB=1 pnpm -F clawbot-server start
```

## Standing rules

- `email.send` (Mailjet) is the ONLY sanctioned outbound email path.
- Container/compose: pass secrets via `env_file: .env` (gitignored) or the
  orchestrator's secret store — never bake them into the image or compose YAML.
- On the "last day till deployment" trigger, the de-personalized main-branch
  build carries NONE of the operator's personal data or keys (see the vault
  progress log + memory).
