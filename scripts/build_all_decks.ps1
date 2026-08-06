# Build both presentation decks from the latest solver outputs.
# Usage (from repo root):
#   .\scripts\build_all_decks.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$Python = $env:PYTHON_PATH
if (-not $Python) {
  $candidate = Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\python.exe"
  if (Test-Path $candidate) { $Python = $candidate }
  else { $Python = "python" }
}

if (-not (Test-Path (Join-Path $Root "outputs\run_result.json"))) {
  Write-Host "==> No run_result.json — running Problem 1 solve first" -ForegroundColor Yellow
  & $Python -m bss_dispatch
  if ($LASTEXITCODE -ne 0) { throw "bss_dispatch failed" }
}

Write-Host "==> Building Problem 1 judge deck" -ForegroundColor Cyan
& $Python (Join-Path $Root "scripts\build_ps1_deck.py")
if ($LASTEXITCODE -ne 0) { throw "build_ps1_deck failed" }

if (-not (Test-Path (Join-Path $Root "outputs\rt\rt_results.json"))) {
  Write-Host "==> No RT results — running Tier-S study (this can take ~1–2 min)" -ForegroundColor Yellow
  & $Python -m bss_dispatch.rt --replications 5
  if ($LASTEXITCODE -ne 0) { throw "bss_dispatch.rt failed" }
}

Write-Host "==> Building Tier-S RT deck" -ForegroundColor Cyan
& $Python (Join-Path $Root "scripts\build_deck.py")
if ($LASTEXITCODE -ne 0) { throw "build_deck failed" }

Write-Host "==> Done" -ForegroundColor Green
Get-ChildItem (Join-Path $Root "outputs\*.pptx") | Format-Table Name, Length, LastWriteTime
