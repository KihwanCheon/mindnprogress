@echo off
setlocal EnableExtensions
chcp 65001 >nul

set "SCRIPT_DIR=%~dp0"
set "INSTALLER=%SCRIPT_DIR%Install-MnPSuite.ps1"

if not exist "%INSTALLER%" (
  echo [ERROR] Installer was not found:
  echo         %INSTALLER%
  pause
  exit /b 1
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%INSTALLER%" %*
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo [ERROR] MnP Suite installation failed. Exit code: %EXIT_CODE%
  echo         Review the error and install log shown above.
  pause
)

exit /b %EXIT_CODE%
