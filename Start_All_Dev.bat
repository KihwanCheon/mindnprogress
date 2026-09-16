@echo off
setlocal EnableExtensions

set "HERE=%~dp0"

if not exist "%HERE%MindNProgress_Start.bat" (
  echo [MnP Suite] MindNProgress_Start.bat not found in %HERE%
  pause
  exit /b 1
)
if not exist "%HERE%AionUi_Start.bat" (
  echo [MnP Suite] AionUi_Start.bat not found in %HERE%
  pause
  exit /b 1
)

start "MindNProgress Dev" cmd.exe /d /k ""%HERE%MindNProgress_Start.bat""
start "AionUi Dev" cmd.exe /d /k ""%HERE%AionUi_Start.bat""

echo [MnP Suite] MindNProgress and AionUi development windows were started.
echo [MnP Suite] MnP: http://127.0.0.1:4175/
exit /b 0
