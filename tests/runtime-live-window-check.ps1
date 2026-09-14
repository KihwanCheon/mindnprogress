param([switch]$Restart, [switch]$MigrateGuiHost)
$ErrorActionPreference = 'Stop'
if (-not $Restart) { throw 'This is an opt-in live restart check. Obtain user approval before supplying -Restart.' }
$mnpMigrate = [bool]$MigrateGuiHost
. (Join-Path $PSScriptRoot '..\scripts\mnp-runtime.ps1')
Add-Type -Path (Join-Path $PSScriptRoot 'runtime-window-monitor.cs')

$mnpContext = Get-MnpContext
$mnpBefore = Get-MnpSnapshot $mnpContext
$mnpMonitor = New-Object MnpWindowMonitor
$mnpStartedAt = [datetime]::UtcNow
$mnpFailure = $null
$mnpAfter = $null
try {
    Invoke-MnpRuntime restart 60 90 $false $false $mnpMigrate
} catch { $mnpFailure = $_ }
try {
    # Even if the controller's HTTP deadline expired, record the actual task and
    # process identities using read-only checks. Never repeat the restart here.
    $mnpContext = Get-MnpContext
    $mnpAfter = Get-MnpSnapshot $mnpContext -FastPorts
    if ($mnpContext.TaskExe -ine (Join-Path $env:SystemRoot 'System32\wscript.exe')) { throw 'Live task is not using the tested GUI host.' }
} catch { if (-not $mnpFailure) { $mnpFailure = $_ } }
finally {
    $mnpMonitor.Dispose()
    $mnpPids = @($PID) + @($mnpBefore.Records.Process.ProcessId)
    if ($mnpAfter) { $mnpPids += @($mnpAfter.Records.Process.ProcessId) }
    $mnpShown = @($mnpMonitor.Snapshot() | Where-Object {
        $mnpChain = $_.Ancestry
        $_.WindowClass -match 'ConsoleWindowClass|CASCADIA_HOSTING_WINDOW_CLASS' -or @($mnpPids | Where-Object { $mnpChain -contains $_ }).Count -gt 0
    })
    $mnpReport = [ordered]@{
        startedAt = $mnpStartedAt.ToString('o')
        finishedAt = [datetime]::UtcNow.ToString('o')
        observerSelfTestPassed = $mnpMonitor.SelfTestPassed
        succeeded = ($null -eq $mnpFailure -and $mnpShown.Count -eq 0)
        failure = $(if ($mnpFailure) { $mnpFailure.Exception.Message } else { $null })
        showEventCount = $mnpShown.Count
        showEvents = $mnpShown
        taskExecutable = $mnpContext.TaskExe
        account = $mnpContext.Task.Principal.UserId
        before = @($mnpBefore.Records | ForEach-Object { @{ role = $_.Role; pid = $_.Process.ProcessId; startedAt = $_.Process.CreationDate.ToString('o') } })
        after = @($mnpAfter.Records | ForEach-Object { if ($_) { @{ role = $_.Role; pid = $_.Process.ProcessId; startedAt = $_.Process.CreationDate.ToString('o') } } })
    }
    $mnpReportPath = Join-Path $mnpContext.StateDirectory ('runtime-window-verification-' + $mnpStartedAt.ToString('yyyyMMdd-HHmmss') + '.json')
    [IO.File]::WriteAllText($mnpReportPath, ($mnpReport | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding($false)))
    Write-Host "[window-check] SHOW events=$($mnpShown.Count); report=$mnpReportPath"
}
if ($mnpFailure) { throw $mnpFailure }
if ($mnpShown.Count -ne 0) { throw 'Window SHOW events were observed. Do not claim the console issue is resolved; inspect the report.' }
Write-Host '[window-check] Live restart passed: verified new NHN processes, web/API HTTP 200, and 0 window SHOW events.'
