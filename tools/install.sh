#!/bin/sh
# NeuroWorks installer (macOS / Linux). Gets NeuroWorks running on a fresh
# machine with the free local core - no personal keys required.
#
#   Usage:  sh tools/install.sh          # set up
#           sh tools/install.sh --start  # set up then launch
#
# Checks Node, ensures pnpm (via corepack), installs deps, scaffolds .env
# from .env.example, checks for Ollama, and prints how to start.
set -e

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"
say()  { echo "[neuroworks] $1"; }
warn() { echo "[neuroworks] WARNING: $1" >&2; }

# 1. Node >= 20
if ! command -v node >/dev/null 2>&1; then
  warn "Node.js not found. Install Node 20+ from https://nodejs.org then re-run."
  exit 1
fi
NODE_VER="$(node --version | sed 's/^v//')"
NODE_MAJOR="$(echo "$NODE_VER" | cut -d. -f1)"
if [ "$NODE_MAJOR" -lt 20 ]; then
  warn "Node $NODE_VER found, but NeuroWorks needs 20+. Upgrade then re-run."
  exit 1
fi
say "Node $NODE_VER OK"

# 2. pnpm (via corepack, which ships with Node)
if ! command -v pnpm >/dev/null 2>&1; then
  say "pnpm not found - enabling via corepack"
  corepack enable >/dev/null 2>&1 || true
  corepack prepare pnpm@latest --activate >/dev/null 2>&1 || {
    warn "corepack failed. Install pnpm manually: npm i -g pnpm"; exit 1;
  }
fi
say "pnpm $(pnpm --version) OK"

# 3. Install dependencies
say "installing dependencies (this can take a few minutes the first time)"
pnpm install

# 4. Scaffold .env from .env.example
if [ ! -f "$REPO/.env" ]; then
  if [ -f "$REPO/.env.example" ]; then
    cp "$REPO/.env.example" "$REPO/.env"
    say "created .env from .env.example - boots with the free local core; edit it to add cloud keys/vault later"
  else
    warn ".env.example missing - starting with built-in defaults"
  fi
else
  say ".env already present - left as-is"
fi

# 5. Ollama (the local model runtime - the free core). Optional but recommended.
if ! command -v ollama >/dev/null 2>&1; then
  warn "Ollama not found. For fully-local AI install it from https://ollama.com then run: ollama pull qwen2.5:3b"
else
  say "Ollama found - if you have not yet, run: ollama pull qwen2.5:3b"
fi

say "Setup complete."
say "Start NeuroWorks with:  pnpm dev"
say "Then open:              http://127.0.0.1:7470"

if [ "$1" = "--start" ]; then
  say "Launching (Ctrl+C to stop)..."
  exec pnpm dev
fi
