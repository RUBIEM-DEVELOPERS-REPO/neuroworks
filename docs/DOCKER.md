# Running NeuroWorks in Docker (storage control)

NeuroWorks is local-first, but you can run it in a container to get **explicit,
durable storage control** — every byte the platform writes goes to a named
volume you manage independently of the container, so an OCR/scrape burst can't
quietly fill your C: drive (the disk-full crash we hit before) and your data
survives rebuilds.

## What's where

| Path in container | Volume | Holds |
|---|---|---|
| `/app/.neuroworks` | `clawbot_neuroworks_state` | jobs journal, users/sessions, data sources, **department data**, **hand-off runs**, personas, schedules |
| `/data/vault` | `clawbot_neuroworks_vault` | the Obsidian "second brain" (`VAULT_PATH`) |

Nothing durable lives in the container layer — `docker compose down` keeps your
data; only `docker compose down -v` deletes the volumes.

## Quick start

```bash
docker compose up --build      # build + run; web → http://localhost:7470
docker compose down            # stop (volumes persist)
```

Put real secrets (GitHub PAT, OpenRouter/Mailjet/Stripe keys) in `.env` at the
repo root — compose loads it automatically (and it's never copied into the
image; see `.dockerignore`).

## Inspecting / controlling storage

```bash
docker volume ls | grep neuroworks                                   # list
docker run --rm -v clawbot_neuroworks_vault:/v alpine du -sh /v       # vault size
docker run --rm -v clawbot_neuroworks_state:/s alpine du -sh /s       # state size
docker run --rm -v clawbot_neuroworks_state:/s alpine ls -la /s       # peek
```

### Point storage at a specific host disk

To keep the vault on, say, your `D:` drive instead of a Docker-managed volume,
swap the named volumes for bind mounts in `docker-compose.yml`:

```yaml
    volumes:
      - "D:/Main brain:/data/vault"
      - "./.neuroworks:/app/.neuroworks"
```

### Cap how much disk the container can use

`storage_opt.size` only works on the xfs/pquota storage driver, so it's left out
of the default compose. If your host supports it (or you use a sized volume /
dedicated partition for the bind mount) you can hard-cap usage there. Otherwise
the named-volume separation already keeps platform writes off your system drive.

## Horizontal scale (multi-host)

`docker-compose.scale.yml` overlays an API-only clawbot **peer** onto the base
stack and wires the primary to it via `NEUROWORKS_PEERS` + the server's built-in
lightest-idle load balancer:

```
docker compose -f docker-compose.yml -f docker-compose.scale.yml up --build
# or N peers:
docker compose -f docker-compose.yml -f docker-compose.scale.yml up --scale neuroworks-peer=2
```

**Where the throughput actually comes from — read before scaling:**

1. **Fix inference first (the real bottleneck).** Extra replicas pointing at the
   *same* model just serialise behind it. Raise `OLLAMA_NUM_PARALLEL` on the
   Ollama host, or use a shared paid OpenRouter tier, or give each host its own
   Ollama. Pool/replica count is downstream of this.
2. **Scale across HOSTS, not just replicas.** Replicas on one machine share its
   CPU/RAM/GPU. The win is one clawbot per host. Across hosts:
   - drop the shared `neuroworks_vault` volume — let each host keep its own and
     sync through the GitHub vault repo (`VAULT_REPO`);
   - keep a per-host state volume (the overlay already gives the peer its own
     `neuroworks_peer_state` so they don't fight over the jobs journal).
3. Containers reach the host's Ollama via `host.docker.internal` (wired in the
   overlay). Override `OLLAMA_HOST` in `.env` to point at a shared/remote LLM.

The single-host overlay mainly proves the **peer wiring**; it is not where the
speedup lives.

## Notes

- The image is based on `mcr.microsoft.com/playwright` so the doc/OCR/browser
  pipeline (playwright, canvas, tesseract) has its system libs + Chromium.
- The API binds to loopback inside the container; the web dev server binds to
  `0.0.0.0` (via `pnpm dev:docker`) and proxies `/api` to it, so only the web
  port needs publishing.
