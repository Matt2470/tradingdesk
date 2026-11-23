@echo off
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\TradingDesk.lnk" 2>nul
echo TradingDesk will no longer open when Windows starts.
pause
