@echo off
setlocal
cd /d "%~dp0"
set "PATH=C:\Program Files\nodejs;%APPDATA%\npm;%PATH%"

echo ============================================
echo   SentiArch - local launcher
echo ============================================
echo.

where pnpm >nul 2>nul
if errorlevel 1 (
  echo ERROR: pnpm was not found.
  echo Install Node.js from https://nodejs.org then run:  npm install -g pnpm
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo First run - installing dependencies. This can take a minute or two...
  call pnpm install
  if errorlevel 1 goto err
)

if not exist "dist\public\index.html" (
  echo Building the app...
  call pnpm build
  if errorlevel 1 goto err
)

echo.
echo A browser tab will open at http://localhost:3000 shortly.
echo Keep this window open while you use SentiArch.
echo To stop: close this window or press Ctrl+C.
echo.

rem Open the browser a few seconds after the server has had time to start.
start "" /min cmd /c "timeout /t 3 >nul && start http://localhost:3000"

call pnpm start
goto :eof

:err
echo.
echo Something went wrong - see the messages above.
pause
exit /b 1
