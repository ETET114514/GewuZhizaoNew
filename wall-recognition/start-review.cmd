@echo off
setlocal
set "WALL_REVIEW_PYTHON=python"
if exist "%~dp0.venv\Scripts\python.exe" set "WALL_REVIEW_PYTHON=%~dp0.venv\Scripts\python.exe"
"%WALL_REVIEW_PYTHON%" -c "import PIL, numpy, cv2, onnxruntime, shapely" >nul 2>&1
if errorlevel 1 set "WALL_REVIEW_PYTHON=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
"%WALL_REVIEW_PYTHON%" -c "import PIL, numpy, cv2, onnxruntime, shapely" >nul 2>&1
if errorlevel 1 (
  echo Python with Pillow, NumPy, OpenCV, ONNX Runtime and Shapely is required. See README.md.
  echo Run: "%WALL_REVIEW_PYTHON%" -m pip install -r "%~dp0requirements.txt"
  pause
  exit /b 1
)
"%WALL_REVIEW_PYTHON%" -u "%~dp0web_server.py" --open-browser
if errorlevel 1 pause
