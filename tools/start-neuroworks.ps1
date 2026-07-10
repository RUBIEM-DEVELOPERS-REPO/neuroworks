# NeuroWorks single-instance launcher - run by the "NeuroWorks Server" logon
# Scheduled Task. Ends the recurring "127.0.0.1 refused to connect":
#   - IDEMPOTENT: if the API already answers on :7471, exit (no duplicate
#     instance fighting for the port - the root cause of the crashes was 2+
#     `pnpm dev` colliding).
#   - SELF-CLEANING: kill any half-dead clawbot node procs before starting.
#   - RESTART-ON-CRASH: when `pnpm dev` exits, this script exits and the
#     Scheduled Task restart policy relaunches it. No internal spin-loop.
#
# NOTE: keep this file ASCII-only. Windows PowerShell 5.1 reads .ps1 as ANSI,
# so a stray Unicode dash/bullet breaks the parser (learned the hard way).
#
# Status -> .neuroworks\launcher.log ; server stdout -> .neuroworks\devstart.log

$ErrorActionPreference = "Continue"
$repo = "C:\Users\Arthur Magaya\Documents\GitHub\clawbot"
$statusLog = Join-Path $repo ".neuroworks\launcher.log"
$devLog    = Join-Path $repo ".neuroworks\devstart.log"
New-Item -ItemType Directory -Force -Path (Split-Path $statusLog) | Out-Null
function Log($m) { try { "$(Get-Date -Format s)  $m" | Out-File -Append -Encoding utf8 $statusLog } catch {} }
Set-Location $repo

function ApiUp {
  try { return (Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 "http://127.0.0.1:7471/api/status").StatusCode -eq 200 }
  catch { return $false }
}

# Resolve pnpm. The Scheduled Task user context has PATH, but pin a fallback.
$pnpm = (Get-Command pnpm.cmd -ErrorAction SilentlyContinue).Source
if (-not $pnpm) { $pnpm = Join-Path $env:APPDATA "npm\pnpm.cmd" }

# Wait briefly for the vault drive (mapped by mount-vault.bat at logon).
for ($i = 0; $i -lt 30 -and -not (Test-Path "D:\Main brain"); $i++) { Start-Sleep -Seconds 2 }

if (ApiUp) { Log "already running on :7471 - exiting"; exit 0 }

# Clear any half-dead clawbot node processes so we do not collide on 7470/7471.
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*clawbot*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Log "starting 'pnpm dev' (pnpm: $pnpm)"
& $pnpm dev *>> $devLog
Log "pnpm dev exited (code $LASTEXITCODE) - Scheduled Task will relaunch"
