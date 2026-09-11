# AionCore release 재빌드 스크립트
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'aionui-common.ps1')

$aionCoreDir = Get-AionCoreDir
$backendBin = Get-AionCoreBinary

if (-not (Test-Path (Join-Path $aionCoreDir 'Cargo.toml'))) {
    Write-Mnp "AionCore 저장소를 찾지 못했습니다: $aionCoreDir"
    Write-Mnp "다른 위치에 있다면 AIONCORE_DIR 환경변수로 지정하세요."
    exit 1
}

$cargo = Resolve-Cargo
if (-not $cargo) {
    Write-Mnp "cargo 를 찾지 못했습니다."
    Write-Mnp "mise install rust@1.95.0 으로 설치할 수 있습니다. (rust-toolchain.toml 이 1.95.0 을 고정합니다)"
    exit 1
}

# AIONUI_BACKEND_BIN 이 target\release\aioncore.exe 를 직접 가리키므로 AionUi 가 켜져
# 있으면 그 파일이 잠겨 링크 단계에서 실패합니다.
if ((Test-Path $backendBin) -and (Test-AionUiRunning)) {
    Write-Mnp "AionUi 가 실행 중입니다. 빌드 산출물이 잠겨 링크가 실패합니다."
    Write-Mnp "AionUi 를 완전히 종료한 뒤 다시 실행하세요. (AionUi_Stop.bat)"
    exit 1
}

Write-Output '============================================================'
Write-Mnp "AionCore release 빌드"
Write-Mnp "  경로  : $aionCoreDir"
Write-Mnp "  cargo : $cargo"
Write-Mnp "  처음 빌드는 10분 이상 걸릴 수 있습니다."
Write-Output '============================================================'

Set-Location $aionCoreDir
& $cargo build --release --locked --bin aioncore
$exitCode = $LASTEXITCODE

if ($exitCode -ne 0) {
    Write-Mnp "빌드 실패 (exit $exitCode)."
    exit $exitCode
}

Write-Mnp "빌드 완료: $backendBin"
$version = (& $backendBin --version 2>$null | Select-Object -First 1)
if ($version) { Write-Mnp "버전: $version" }
Write-Mnp "AionUi 를 다시 시작하면 새 바이너리를 사용합니다."
exit 0
