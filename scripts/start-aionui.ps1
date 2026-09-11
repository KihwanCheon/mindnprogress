# AionUi dev 실행 스크립트 (로컬 빌드한 AionCore 사용)
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'aionui-common.ps1')

$aionUiDir = Get-AionUiDir
$backendBin = Get-AionCoreBinary

if (-not (Test-Path (Join-Path $aionUiDir 'package.json'))) {
    Write-Mnp "AionUi 저장소를 찾지 못했습니다: $aionUiDir"
    Write-Mnp "다른 위치에 있다면 AIONUI_DIR 환경변수로 지정하세요."
    exit 1
}

if (-not (Test-Path $backendBin)) {
    Write-Mnp "로컬 AionCore 바이너리가 없습니다: $backendBin"
    Write-Mnp "AionCore_Rebuild.bat 을 먼저 실행하세요."
    exit 1
}

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    Write-Mnp "bun 을 PATH 에서 찾지 못했습니다."
    exit 1
}

# 업스트림에서 받아온 번들 바이너리가 남아 있으면 AIONUI_BACKEND_BIN 보다 우선순위는
# 낮지만(env override 가 1순위) 혼란을 줄이기 위해 남아 있으면 알려줍니다.
$staleBundle = Join-Path $aionUiDir 'resources\bundled-aioncore'
if (Test-Path $staleBundle) {
    Write-Mnp "경고: 번들 aioncore 가 남아 있습니다($staleBundle). AIONUI_BACKEND_BIN 이 우선하지만 삭제를 권장합니다."
}

# 1순위 백엔드 지정. binaryResolver 탐색 순서는 이 환경변수 > 번들 > PATH 입니다.
$env:AIONUI_BACKEND_BIN = $backendBin

# 네이티브 모듈(node-pty/winpty)을 재빌드할 때 cmd 가 현재 디렉터리의 배치 파일을
# 실행하지 못해 GetCommitHash.bat 단계에서 실패합니다. 그래서 비워 둡니다.
Remove-Item Env:\NoDefaultCurrentDirectoryInExePath -ErrorAction SilentlyContinue

# 개발 실행에서는 오류 리포트를 보내지 않습니다.
$env:SENTRY_DSN = ''

$aionCoreVersion = (& $backendBin --version 2>$null | Select-Object -First 1)

Write-Output '============================================================'
Write-Mnp "AionUi development mode"
Write-Mnp "  AionUi   : $aionUiDir"
Write-Mnp "  AionCore : $backendBin"
if ($aionCoreVersion) { Write-Mnp "  버전     : $aionCoreVersion" }
Write-Mnp "  종료     : AionUi 창을 닫거나 이 창에서 Ctrl+C"
Write-Output '============================================================'

Set-Location $aionUiDir
bun run dev
exit $LASTEXITCODE
