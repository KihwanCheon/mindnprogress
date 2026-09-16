# MnP Suite 공용 경로 해석 스크립트
# mindnprogress 상위 폴더를 suite 루트로 보고 AionUi / AionCore 위치를 찾습니다.
# 다른 곳에 두셨다면 AIONUI_DIR / AIONCORE_DIR 환경변수로 덮어쓸 수 있습니다.

function Get-MnpRoot {
    return (Resolve-Path (Join-Path $PSScriptRoot '..')).Path.TrimEnd('\')
}

function Get-SuiteRoot {
    return (Resolve-Path (Join-Path (Get-MnpRoot) '..')).Path.TrimEnd('\')
}

function Get-AionUiDir {
    if ($env:AIONUI_DIR) { return $env:AIONUI_DIR.TrimEnd('\') }
    return (Join-Path (Get-SuiteRoot) 'AionUi')
}

function Get-AionCoreDir {
    if ($env:AIONCORE_DIR) { return $env:AIONCORE_DIR.TrimEnd('\') }
    return (Join-Path (Get-SuiteRoot) 'AionCore')
}

function Get-AionCoreBinary {
    return (Join-Path (Get-AionCoreDir) 'target\release\aioncore.exe')
}

function Resolve-Cargo {
    # mise 로 rust 를 설치하면 rustup 규약대로 ~\.cargo\bin 에 들어갑니다.
    $candidate = Join-Path $env:USERPROFILE '.cargo\bin\cargo.exe'
    if (Test-Path $candidate) { return $candidate }
    $onPath = Get-Command cargo -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }
    return $null
}

function Test-AionUiRunning {
    # 빌드 산출물을 잠그는 것은 aioncore.exe 뿐입니다. electron 은 무관한 앱도
    # 같은 이름을 쓰므로 여기서 보지 않습니다.
    $procs = Get-Process -Name 'aioncore' -ErrorAction SilentlyContinue
    return [bool]$procs
}

function Write-Mnp {
    param([string]$Message)
    Write-Output "[MnP Suite] $Message"
}
