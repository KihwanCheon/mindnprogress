# MindNProgress dev 서버 시작 스크립트 (API 4176 / Web 4175)
$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $root

# AionUi 백엔드 주소는 고정하지 않습니다. AionUi가 임시 폴더에 쓰는
# aionui-backend.json으로 서버가 가변 포트를 자동 탐색합니다.

Write-Output "[MindNProgress] $root 에서 dev 서버를 시작합니다 (API 4176 / Web 4175)."
Write-Output "[MindNProgress] 창을 닫거나 Ctrl+C를 누르면 서버가 종료됩니다."
npm run dev