@echo off
setlocal
cd /d "%~dp0"
echo.
echo  TradingDesk setup
echo  -----------------
set "BUN=bun"
where bun >nul 2>nul
if not errorlevel 1 goto havebun
set "BUN=%USERPROFILE%\.bun\bin\bun.exe"
if exist "%BUN%" goto havebun
echo.
echo  TradingDesk needs Bun, a small free program that runs it.
echo  It was not found on this PC. Press a key to install it from bun.sh,
echo  or close this window to cancel.
pause >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm bun.sh/install.ps1 | iex"
if not exist "%BUN%" goto nobun
:havebun
echo.
"%BUN%" run scripts\doctor.ts
if errorlevel 1 goto failed
echo.
echo  Adding TradingDesk to Windows startup...
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path ([Environment]::GetFolderPath(\"Startup\")) \"TradingDesk.lnk\")); $s.TargetPath=\"wscript.exe\"; $s.Arguments=[char]34+(Join-Path (Get-Location) \"start.vbs\")+[char]34; $s.WorkingDirectory=(Get-Location).Path; $s.Save()"
if errorlevel 1 echo  Could not create the startup shortcut. You can still open TradingDesk with start.vbs.
echo  Opening TradingDesk...
wscript.exe "%~dp0start.vbs"
echo.
echo  Done. TradingDesk will open by itself each time you start this PC.
echo  To stop that, run remove-from-startup.bat.
pause
exit /b 0
:nobun
echo  Bun could not be installed. Install it from https://bun.sh and run setup.bat again.
pause
exit /b 1
:failed
echo  Setup stopped because the check above reported a FAIL line.
pause
exit /b 1
