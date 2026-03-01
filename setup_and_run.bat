@echo off
cd /d "%~dp0"
echo Portugal Trip Planner - setup and run
echo.

:: Try conda first
where conda >nul 2>&1
if %errorlevel% equ 0 (
  echo Using Conda...
  call conda env create -f environment.yml
  if %errorlevel% neq 0 (
    echo Conda env already exists or failed. Trying to activate...
  )
  call conda activate portugal-trip-planner
  goto run
)

:: Fallback: venv + pip
echo Conda not found. Using Python venv...
where python >nul 2>&1
if %errorlevel% neq 0 (
  where py >nul 2>&1
  if %errorlevel% equ 0 (
    set PY=py -3
  ) else (
    echo ERROR: No Python or Conda found. Install Python or open "Anaconda Prompt" and run this script again.
    pause
    exit /b 1
  )
) else (
  set PY=python
)
if not exist ".venv" (
  %PY% -m venv .venv
)
call .venv\Scripts\activate.bat
pip install -r requirements.txt -q

:run
echo.
echo Starting app at http://127.0.0.1:5000
echo Press Ctrl+C to stop.
echo.
python app.py
pause
