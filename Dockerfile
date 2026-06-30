# NeuroWorks container.
#
# Based on the official Playwright image because the server's doc/OCR/browser
# pipeline (playwright, canvas, tesseract) needs the system libs + a real
# Chromium — the slim node image can't run those. Both the API (tsx) and the
# web SPA (Vite dev, which proxies /api → the API) run straight from source via
# the repo's `pnpm dev` — the exact stack the operator runs locally.
#
# STORAGE: all mutable state lives under two paths that docker-compose mounts as
# named volumes, so nothing the agent writes is trapped in the container layer:
#   /app/.neuroworks   → jobs journal, users/sessions, data sources, department
#                        data, hand-off runs, personas, schedules
#   /data/vault        → the Obsidian "second brain" (VAULT_PATH)
FROM mcr.microsoft.com/playwright:v1.59.1-jammy

ENV NODE_ENV=production \
    PNPM_HOME=/usr/local/share/pnpm \
    PATH=/usr/local/share/pnpm:$PATH \
    NEUROWORKS_PORT=7471 \
    WEB_PORT=7470 \
    VAULT_PATH=/data/vault

# pnpm via corepack (pinned in the lockfile's packageManager field if present).
RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

# Install dependencies first (layer cache friendly) using only the manifests.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN pnpm install --frozen-lockfile || pnpm install

# App source. (Both API and web run from source via tsx / vite — no build step.)
COPY . .

# State + vault mount points. Declared as volumes so an operator gets durable,
# separately-managed storage by default even without compose.
RUN mkdir -p /app/.neuroworks /data/vault
VOLUME ["/app/.neuroworks", "/data/vault"]

EXPOSE 7470 7471

# concurrently boots both the API (7471, loopback) and the web dev server
# (7470, bound to 0.0.0.0 so it's reachable on the published port).
CMD ["pnpm", "run", "dev:docker"]
