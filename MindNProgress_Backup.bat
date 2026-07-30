@echo off
setlocal EnableExtensions

set "SCRIPT=%~dp0scripts\backup-data.ps1"
if not exist "%SCRIPT%" (
  echo [MindNProgress] Backup script not found: %SCRIPT%
  exit /b 1
)

powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" %*
set "EXIT_CODE=%ERRORLEVEL%"

if not "%MNP_BACKUP_NO_PAUSE%"=="1" pause
exit /b %EXIT_CODE%
