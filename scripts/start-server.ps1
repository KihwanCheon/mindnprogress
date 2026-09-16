# MindNProgress dev 서버 시작 스크립트 (API 4176 / Web 4175)
$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $root

# AionUi 백엔드 주소는 고정하지 않습니다. AionUi가 임시 폴더에 쓰는
# aionui-backend.json으로 서버가 가변 포트를 자동 탐색합니다.

# 랜 카드가 여러 개면 자동 감지가 외부에서 닿지 않는 주소를 고를 수 있어
# 공개 주소로 쓸 인터페이스를 지정합니다. 이름이 다른 PC에서는 실행 전에
# 환경변수로 덮어쓰면 됩니다. 지정한 이름을 못 찾으면 서버가 경고를 남기고
# 기존 자동 감지로 돌아갑니다.
if (-not $env:MNP_PUBLIC_INTERFACE) {
  $env:MNP_PUBLIC_INTERFACE = '이더넷'
}

Write-Output "[MindNProgress] $root 에서 dev 서버를 시작합니다 (API 4176 / Web 4175)."
Write-Output "[MindNProgress] 창을 닫거나 Ctrl+C를 누르면 서버가 종료됩니다."
npm run dev
