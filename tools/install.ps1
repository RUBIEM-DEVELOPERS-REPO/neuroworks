# NeuroWorks installer (Windows). Gets NeuroWorks running on a fresh PC with
# the free local core - no personal keys required.
#
#   Usage:  powershell -ExecutionPolicy Bypass -File tools\install.ps1
#           powershell -ExecutionPolicy Bypass -File tools\install.ps1 -Start
#
# What it does: checks Node, ensures pnpm (via corepack), installs deps,
# scaffolds .env from .env.example, checks for Ollama (the local model
# runtime), and prints how to start. With -Start it launches right away.
#
# NOTE: keep this file ASCII-only. Windows PowerShell 5.1 reads .ps1 as ANSI,
# so a stray Unicode dash/bullet breaks the parser.

param([switch]$Start)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
function Say($m) { Write-Host "[neuroworks] $m" }
function Warn($m) { Write-Host "[neuroworks] WARNING: $m" -ForegroundColor Yellow }

# 1. Node >= 20
$node = (Get-Command node -ErrorAction SilentlyContinue)
if (-not $node) {
  Warn "Node.js not found. Install Node 20+ from https://nodejs.org then re-run."
  exit 1
}
$nodeVer = (& node --version) -replace "v",""
$nodeMajor = [int]($nodeVer.Split(".")[0])
if ($nodeMajor -lt 20) {
  Warn "Node $nodeVer found, but NeuroWorks needs 20+. Upgrade from https://nodejs.org then re-run."
  exit 1
}
Say "Node $nodeVer OK"

# 2. pnpm (ship-with-Node corepack activates it if missing)
$pnpm = (Get-Command pnpm -ErrorAction SilentlyContinue)
if (-not $pnpm) {
  Say "pnpm not found - enabling via corepack"
  try { & corepack enable | Out-Null; & corepack prepare pnpm@latest --activate | Out-Null }
  catch { Warn "corepack failed. Install pnpm manually: npm i -g pnpm"; exit 1 }
}
Say "pnpm $(& pnpm --version) OK"

# 3. Install dependencies
Say "installing dependencies (this can take a few minutes the first time)"
& pnpm install
if ($LASTEXITCODE -ne 0) { Warn "pnpm install failed"; exit 1 }

# 4. Scaffold .env from .env.example
$envPath = Join-Path $repo ".env"
$envExample = Join-Path $repo ".env.example"
if (-not (Test-Path $envPath)) {
  if (Test-Path $envExample) {
    Copy-Item $envExample $envPath
    Say "created .env from .env.example - it boots with the free local core; edit it to add cloud keys/vault later"
  } else {
    Warn ".env.example missing - starting with built-in defaults"
  }
} else {
  Say ".env already present - left as-is"
}

# 5. Ollama (the local model runtime - the free core). Optional but recommended.
$ollama = (Get-Command ollama -ErrorAction SilentlyContinue)
if (-not $ollama) {
  Warn "Ollama not found. For fully-local AI install it from https://ollama.com then run: ollama pull qwen2.5:3b"
} else {
  Say "Ollama found - if you have not yet, run: ollama pull qwen2.5:3b"
}

Say "Setup complete."
Say "Start NeuroWorks with:  pnpm dev"
Say "Then open:              http://127.0.0.1:7470"

if ($Start) {
  Say "Launching (Ctrl+C to stop)..."
  & pnpm dev
}
