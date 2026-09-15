@echo off
rem AI MAINTENANCE: This BAT owns shared startup settings for both BAT and VBS.
rem No arguments: console output and pause. --hidden: hidden execution without pause.
rem MindNProgress_Start.vbs only invokes this BAT with --hidden and reports failure.
rem Edit controller options here; keep lifecycle logic in MindNProgress\scripts\mnp-runtime.ps1.
rem When changing the hidden option or exit-code contract, update BOTH BAT and VBS.
rem Keep BOTH installation-root files synchronized with their respective repository templates
rem under scripts/runtime/entrypoints/ (same filenames).
setlocal EnableExtensions DisableDelayedExpansion
set "MNP_EXIT_CODE=1"
set "MNP_HIDDEN="
set "MNP_WINDOW_OPTION="
if "%~1"=="" goto run
if /i not "%~1"=="--hidden" goto usage
set "MNP_HIDDEN=1"
set "MNP_WINDOW_OPTION=-WindowStyle Hidden"
if not "%~2"=="" goto usage

:run
pushd "%~dp0"
if errorlevel 1 goto directory_error
set "MNP_CONTROLLER=%~dp0MindNProgress\scripts\mnp-runtime.ps1"
if not exist "%MNP_CONTROLLER%" goto missing_controller

echo [MindNProgress] Restarting. The browser opens when the server is ready.
echo.
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive %MNP_WINDOW_OPTION% -ExecutionPolicy Bypass -File "%MNP_CONTROLLER%" -Action restart -AllowLegacyStop -OpenBrowser
set "MNP_EXIT_CODE=%errorlevel%"
echo.
if "%MNP_EXIT_CODE%"=="0" (
  echo [MindNProgress] Restart complete.
) else (
  echo [MindNProgress] Restart failed. Exit code: %MNP_EXIT_CODE%
  echo [MindNProgress] Check "%~dp0.mindnprogress\runtime-operations.jsonl" and "%~dp0.mindnprogress\dev.err.log".
)
goto finish

:missing_controller
echo [MindNProgress] Runtime controller is missing: "%MNP_CONTROLLER%"

:finish
popd
goto done

:directory_error
echo [MindNProgress] Cannot access installation directory: "%~dp0"
goto done

:usage
echo [MindNProgress] Usage: MindNProgress_Start.bat [--hidden]

:done
if not defined MNP_HIDDEN (
  echo.
  echo Press any key to close this window.
  pause >nul
)
exit /b %MNP_EXIT_CODE%
