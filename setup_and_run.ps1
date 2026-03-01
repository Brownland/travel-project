# Portugal Trip Planner - setup and run (PowerShell)
# Run from Anaconda PowerShell Prompt for conda, or any terminal with Python
Set-Location $PSScriptRoot
Write-Host "Portugal Trip Planner - setup and run`n" -ForegroundColor Cyan

$useConda = $false
$condaCmd = Get-Command conda -ErrorAction SilentlyContinue
if ($condaCmd) {
  Write-Host "Using Conda..."
  & conda env create -f environment.yml 2>$null
  if ($LASTEXITCODE -ne 0) { Write-Host "(Env may already exist)" }
  & conda activate portugal-trip-planner
  $useConda = $true
}

if (-not $useConda) {
  Write-Host "Conda not in PATH. Using Python venv..."
  $py = Get-Command python -ErrorAction SilentlyContinue
  if (-not $py) { $py = Get-Command py -ErrorAction SilentlyContinue; if ($py) { $pythonExe = "py -3" } }
  else { $pythonExe = "python" }
  if (-not $py) {
    Write-Host "ERROR: No Python or Conda found. Open 'Anaconda Prompt' or install Python, then run this script again." -ForegroundColor Red
    exit 1
  }
  if (-not (Test-Path ".venv")) { & $pythonExe -m venv .venv }
  & .\.venv\Scripts\Activate.ps1
  pip install -r requirements.txt -q
}

Write-Host "`nStarting app at http://127.0.0.1:5000`n" -ForegroundColor Green
python app.py
