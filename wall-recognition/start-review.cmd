@echo off
setlocal
set "WALL_REVIEW_PYTHON=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
if not exist "%WALL_REVIEW_PYTHON%" set "WALL_REVIEW_PYTHON=python"
"%WALL_REVIEW_PYTHON%" -c "import PIL, numpy" >nul 2>&1
if errorlevel 1 (
  echo Python with Pillow and NumPy is required. See README.md.
  pause
  exit /b 1
)
"%WALL_REVIEW_PYTHON%" -u "%~dp0web_server.py" --open-browser
if errorlevel 1 pause
