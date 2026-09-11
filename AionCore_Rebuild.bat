@echo off
setlocal EnableExtensions

set "SCRIPT=%~dp0scripts\rebuild-aioncore.ps1"
if not exist "%SCRIPT%" (
  echo [MnP Suite] Rebuild script not found: %SCRIPT%
  pause
  exit /b 1
)

set "PS=pwsh"
where pwsh >nul 2>nul || set "PS=powershell"

%PS% -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
pause
