@echo off
cd /d "%~dp0"
echo Restarting TradingDesk...
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"name='bun.exe'\" | Where-Object { $_.CommandLine -like '*server.ts*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
timeout /t 2 /nobreak >nul
wscript.exe "%~dp0start.vbs"
