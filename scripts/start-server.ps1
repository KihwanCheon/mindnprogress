# MindNProgress dev 서버 시작 스크립트 (API 4176 / Web 4175)
$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $root

if (-not $env:MNP_AIONUI_URL) {
  $env:MNP_AIONUI_URL = 'http://127.0.0.1:25809'
}

Write-Output "[MindNProgress] $root 에서 dev 서버를 시작합니다 (API 4176 / Web 4175)."
Write-Output "[MindNProgress] 창을 닫거나 Ctrl+C를 누르면 서버가 종료됩니다."
npm run dev