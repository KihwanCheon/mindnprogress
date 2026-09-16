@echo off
setlocal EnableExtensions

set "SCRIPT=%~dp0scripts\start-server.ps1"
if not exist "%SCRIPT%" (
  echo [MindNProgress] Start script not found: %SCRIPT%
  pause
  exit /b 1
)

powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
pause
