# MindNProgress dev 서버 종료 스크립트
$ErrorActionPreference = 'SilentlyContinue'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path.TrimEnd('\')
$escapedRoot = [Management.Automation.WildcardPattern]::Escape($root)

$targets = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -and $_.CommandLine -like "*$escapedRoot*" }

if (-not $targets) {
  Write-Output "[MindNProgress] 실행 중인 dev 서버 프로세스를 찾지 못했습니다."
  exit 0
}

foreach ($proc in $targets) {
  Write-Output "[MindNProgress] PID $($proc.ProcessId) 종료: $($proc.CommandLine)"
  Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
}

Write-Output "[MindNProgress] 종료 완료."