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
| 1 | GitHub PAT | `GITHUB_TOKEN` | vault push, repo digest, publish-folder | GitHub → Settings → Developer settings → Fine-grained tokens → revoke the old, mint new (Contents R/W on `main-brain`, Metadata R). Update `.env` + **add a repo secret named `NEUROWORKS_PAT`** with the new token (the workflow was renamed off `CLAWBOT_PAT` — add the new secret before the next 06:30 UTC cron run, then delete the old `CLAWBOT_PAT` secret once confirmed working). |
| 2 | OpenRouter API key | `OPENROUTER_API_KEY` | cloud LLM synthesis/large tier | openrouter.ai → Keys → revoke + create. Update `.env`. |
| 3 | OpenAI API key (`sk-…`) | `OPENAI_API_KEY` / model-provider | BYO provider path | platform.openai.com → API keys → revoke + create. Update the provider in the Models UI (re-encrypted) or `.env`. |
| 4 | Slack bot token (`xoxb-…`) | integrations store | `slack.post` (chat.postMessage) | api.slack.com/apps → your app → OAuth & Permissions → **Reinstall** to rotate the bot token (or regenerate). Re-enter it in the Connectors/Integrations UI (stored AES-256-GCM encrypted). |
| 5 | Stripe secret key (`sk_live_…` / `sk_test_…`) | `STRIPE_SECRET_KEY` | payments gateway | dashboard.stripe.com → Developers → API keys → roll. Update `.env`. Also re-check `STRIPE_WEBHOOK_SECRET`. |

## Set these fresh for production (currently blank/dev)

| Secret | Env var | Why |
|--------|---------|-----|
| Webhook signing secret | `NW_WEBHOOK_SIGNING_SECRET` | Signs dispatch completion webhooks (`X-NeuroWorks-Signature`). Set a long random value: `openssl rand -hex 32`. |
| Finance push token | `FINANCE_SYNC_TOKEN` | Shared secret the Finance System sends to POST `/api/public/dashboard`. Leave blank only on a fully trusted network. |
| Allowed hosts | `NEUROWORKS_ALLOWED_HOSTS` | Your production hostname(s) so the origin-guard (DNS-rebind defense) accepts the deployed SPA's API calls. |
| Admin password | (Users UI) | Change the seeded admin (`admin@rubiem.com`) password from the dev default on first login. |

## Network exposure — enterprise mode

Off by default. The local trust model (`lib/access.ts`) explicitly lets
token-less requests through as "operator/machine context", and `origin-guard`
(the DNS-rebinding / cross-origin-POST defense) explicitly exempts requests
with no `Origin` header — both correct for "runs on one trusted machine,
never network-exposed," neither is authentication. The moment this instance
is reachable from a wider network (cloud VM, shared server, a proxy that
isn't strictly loopback-only), those two facts combine into: no auth at all
on most routes, including `/api/terminal` (shell), `/api/connectors`
(credentials), `/api/models` (API keys), `/api/cost` (money).

**Before exposing this beyond one trusted machine:**

1. Set `NEUROWORKS_ENTERPRISE_MODE=1`. This requires every request that
   isn't same-machine (checked via the OS socket `remoteAddress`, not a
   spoofable header) to carry either a human session token or a
   `machine:full`-scoped API key. `validateConfig()` already warns at boot
   if bound wide with this unset.
2. For any peer/worker on a **different host** than this instance (same-host
   peers/workers are exempt automatically via the loopback check): mint a
   key with `POST /api/dispatch-keys {"label":"peer-x","scopes":["machine:full"]}`
   and configure that peer to send `Authorization: Bearer nw_...`. This is
   NOT wired automatically across every internal caller — `lib/peers.ts` has
   7+ independent `fetch()` call sites with no shared HTTP client to patch
   centrally; done for same-host peers via the loopback exemption, not yet
   done for cross-host peers.
3. Put a real reverse proxy in front (TLS termination, this app has no
   built-in HTTPS) and set `NEUROWORKS_ALLOWED_HOSTS` / `NEUROWORKS_WEB_ORIGIN` to
   match your real hostname.

Toggling `NEUROWORKS_ENTERPRISE_MODE` back to unset/0 returns to the local
trust model immediately — it's one env var, not a structural redeploy, so
"disconnect from the net, reconnect later" is a config flip either direction.

## Verify after rotating

```bash
# 1. No secret values in either repo (should print nothing):
git -C <clawbot> grep -iE "ghp_[A-Za-z0-9]{30}|github_pat_|sk-[A-Za-z0-9]{30}|xoxb-[0-9]" -- . ':(exclude).env.example'
git -C "D:/Main brain" grep -iE "ghp_[A-Za-z0-9]{30}|sk-[A-Za-z0-9]{30}|xoxb-[0-9]"

# 2. .env still ignored:
git -C <clawbot> check-ignore .env    # → .env

# 3. Boot in strict mode — refuses to start if a required secret is missing:
NODE_ENV=production SERVE_WEB=1 pnpm -F neuroworks-server start
```

## Standing rules

- `email.send` (Mailjet) is the ONLY sanctioned outbound email path.
- Container/compose: pass secrets via `env_file: .env` (gitignored) or the
  orchestrator's secret store — never bake them into the image or compose YAML.
- On the "last day till deployment" trigger, the de-personalized main-branch
  build carries NONE of the operator's personal data or keys (see the vault
  progress log + memory).
