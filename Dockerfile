# NeuroWorks container.
#
# Based on the official Playwright image because the server's doc/OCR/browser
# pipeline (playwright, canvas, tesseract) needs the system libs + a real
# Chromium — the slim node image can't run those.
#
# PRODUCTION SHAPE (single port): the web SPA is BUILT once (vite build →
# web/dist) and the API server serves those minified, fingerprinted assets
# itself. No Vite dev server runs in production. Everything is on ONE port
# (7471), bound to 0.0.0.0 so the published port is reachable. The API runs via
# tsx (no watch) — the same runtime the operator uses locally, minus the churn.
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
    NEUROWORKS_BIND_HOST=0.0.0.0 \
    SERVE_WEB=1 \
    VAULT_PATH=/data/vault

# pnpm via corepack (pinned in the lockfile's packageManager field if present).
RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

# Install dependencies first (layer cache friendly) using only the manifests.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN pnpm install --frozen-lockfile || pnpm install

# App source.
COPY . .

# Build the web SPA to web/dist (minified, fingerprinted). The API serves it.
RUN pnpm -F clawbot-web build

# State + vault mount points. Declared as volumes so an operator gets durable,
# separately-managed storage by default even without compose.
RUN mkdir -p /app/.neuroworks /data/vault
VOLUME ["/app/.neuroworks", "/data/vault"]

EXPOSE 7471

# Container-level liveness/readiness: hit /api/health (exempt from auth) and
# fail the check on a non-2xx so the orchestrator can restart a wedged process.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.NEUROWORKS_PORT||7471)+'/api/health',r=>process.exit(r.statusCode<400?0:1)).on('error',()=>process.exit(1))"

# Single production process: the API server, which also serves the built SPA.
CMD ["pnpm", "-F", "clawbot-server", "start"]
