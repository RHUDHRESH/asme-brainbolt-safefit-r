# Runs the Python BSS solver, then starts the Next.js judge dashboard.
# Usage (from repo root):
#   .\scripts\run_demo.ps1
#
# Note: The UI starts empty/locked even if this script already wrote outputs/.
# Cold load ignores stale outputs — click "Run on uploads" with both CSVs,
# or open http://localhost:3000/?resume=1 to reload the last run.
# Decks: .\scripts\build_all_decks.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$Python = $env:PYTHON_PATH
if (-not $Python) {
  $candidate = Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\python.exe"
  if (Test-Path $candidate) { $Python = $candidate }
  else { $Python = "python" }
}

$PnpmDir = Join-Path $env:LOCALAPPDATA "pnpm-global\node_modules\.bin"
$env:Path = "$PnpmDir;" + [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

Write-Host "==> Running BSS simulation ($Python -m bss_dispatch)" -ForegroundColor Cyan
& $Python -m bss_dispatch
if ($LASTEXITCODE -ne 0) {
  throw "bss_dispatch failed with exit code $LASTEXITCODE"
}

Write-Host "==> Building presentation decks" -ForegroundColor Cyan
& $Python (Join-Path $Root "scripts\build_ps1_deck.py")
if (Test-Path (Join-Path $Root "outputs\rt\rt_results.json")) {
  & $Python (Join-Path $Root "scripts\build_deck.py")
} else {
  Write-Host "    (skip Tier-S deck - no outputs/rt/rt_results.json yet)" -ForegroundColor DarkYellow
}

# Free stale Next.js lock on port 3000 if present
$lockDir = Join-Path $Root "web\.next\dev\lock"
if (Test-Path (Join-Path $Root "web\.next\dev")) {
  Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue |
    ForEach-Object {
      try { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } catch {}
    }
}

Write-Host "==> Starting judge dashboard at http://localhost:3000  (lab: /lab)" -ForegroundColor Cyan
Set-Location (Join-Path $Root "web")
pnpm dev --port 3000
