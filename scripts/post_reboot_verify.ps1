Set-Location "C:\Users\SEC\ASME SIM"
$py = ".\.venv\Scripts\python.exe"
& $py -c "import pandas; print('pandas ok', pandas.__version__)"
if ($LASTEXITCODE -ne 0) { "PANDAS_STILL_BLOCKED"; exit 1 }
& $py -m bss_dispatch
if ($LASTEXITCODE -ne 0) { "BACKEND_FAIL"; exit 1 }
"BACKEND_OK"
Set-Location web
pnpm dev --port 3000
