# AionUi dev 종료 스크립트
$ErrorActionPreference = 'SilentlyContinue'

. (Join-Path $PSScriptRoot 'aionui-common.ps1')

$aionUiDir = (Get-AionUiDir).TrimEnd('\')
$escaped = [Management.Automation.WildcardPattern]::Escape($aionUiDir)

# aioncore 는 AionUi 가 spawn 한 백엔드이므로 이름으로 찾습니다.
$backend = Get-CimInstance Win32_Process -Filter "Name='aioncore.exe'"

# electron / electron-vite 는 이 저장소 경로에서 실행된 것만 대상으로 합니다.
$front = Get-CimInstance Win32_Process |
    Where-Object {
        $_.Name -match '^(electron|electron-vite|bun)\.exe$' -and
        $_.CommandLine -and $_.CommandLine -like "*$escaped*"
    }

$targets = @($backend) + @($front) | Where-Object { $_ } | Sort-Object ProcessId -Unique

if (-not $targets) {
    Write-Mnp "실행 중인 AionUi 프로세스를 찾지 못했습니다."
    exit 0
}

foreach ($proc in $targets) {
    Write-Mnp "PID $($proc.ProcessId) 종료: $($proc.Name)"
    Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
}

Write-Mnp "종료 완료."
exit 0
