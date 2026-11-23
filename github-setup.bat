@echo off
cd /d "%~dp0"
echo.
echo   TradingDesk to GitHub: the four bots will trade there every 15 minutes, even with this PC off.
echo   Only the app itself is published. data\ (your trade exports) and scout-to-alert\ never leave this PC.
echo.
set "BUN=%USERPROFILE%\.bun\bin\bun.exe"
if not exist "%BUN%" set "BUN=bun"
set /p REPO=Paste your repository address (like https://github.com/your-name/tradingdesk) and press Enter: 
"%BUN%" run scripts\github-setup.ts %REPO%
echo.
pause
