@echo off
cd /d "%~dp0"
echo Publishing TradingDesk code changes to GitHub (the same safety checks run first)...
set "BUN=%USERPROFILE%\.bun\bin\bun.exe"
if not exist "%BUN%" set "BUN=bun"
"%BUN%" run scripts\github-setup.ts --update
echo.
pause
