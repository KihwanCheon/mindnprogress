@echo off
setlocal
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0MindNProgress\scripts\mnp-runtime.ps1" -Action stop -AllowLegacyStop
exit /b %errorlevel%
