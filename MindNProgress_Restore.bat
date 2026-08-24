@echo off
setlocal EnableExtensions

if "%~1"=="" (
  echo Usage: %~nx0 "%~dp0..\MindNProgress_Backup\YYYY-MM-DD\MindNProgress_YYYY-MM-DD_HHmmss.zip"
  exit /b 1
)

set "SCRIPT=%~dp0scripts\restore-data.ps1"
if not exist "%SCRIPT%" (
  echo [MindNProgress] Restore script not found: %SCRIPT%
  exit /b 1
)

powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" -ArchivePath "%~1" -ProjectPath "%~dp0"
set "EXIT_CODE=%ERRORLEVEL%"

if not "%MNP_BACKUP_NO_PAUSE%"=="1" pause
exit /b %EXIT_CODE%
