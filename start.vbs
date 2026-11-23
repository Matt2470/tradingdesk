' Starts the TradingDesk server without a console window and opens the dashboard.
' The server log is written to data\server.log.
Option Explicit
Dim sh, fso, dir, bun
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
If Not fso.FolderExists(dir & "\data") Then fso.CreateFolder(dir & "\data")
bun = sh.ExpandEnvironmentStrings("%USERPROFILE%") & "\.bun\bin\bun.exe"
If Not fso.FileExists(bun) Then bun = "bun"
On Error Resume Next
sh.Run "cmd /c """"" & bun & """ run src\server.ts --open > data\server.log 2>&1""", 0, False
If Err.Number <> 0 Then MsgBox "TradingDesk could not start. Run setup.bat in " & dir & " first.", 48, "TradingDesk"
