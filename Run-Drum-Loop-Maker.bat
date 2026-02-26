@echo off
setlocal
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Install Node.js first, then run this file again.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 goto :error
)

echo Generating sample manifest...
call npm run gen:samples
if errorlevel 1 goto :error

echo Starting app and opening browser...
call npm run dev -- --open
if errorlevel 1 goto :error

exit /b 0

:error
echo.
echo Failed to launch Drum Loop Maker.
pause
exit /b 1
