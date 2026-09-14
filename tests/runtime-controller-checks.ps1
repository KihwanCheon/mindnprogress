$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\scripts\mnp-runtime.ps1')

function Assert-MnpTest($Condition, $Message) { if (-not $Condition) { throw $Message } }
function Assert-MnpThrows([scriptblock]$Work, $Pattern) {
    try { & $Work } catch { if ($_.Exception.Message -match $Pattern) { return }; throw }
    throw "Expected failure: $Pattern"
}
$node = 'C:\Program Files\nodejs\node.exe'
$entry = 'C:\fixture\MindNProgress\server\index.mjs'
$record = [pscustomobject]@{ ProcessId = 100; ParentProcessId = 90; CreationDate = [datetime]::UtcNow; ExecutablePath = $node; CommandLine = ('"{0}" "{1}"' -f $node, $entry) }
Assert-MnpTest (Test-MnpCommand $record $node $entry) 'Quoted command rejected'
Assert-MnpTest (-not (Test-MnpCommand $record $node ($entry + '.other'))) 'Prefix path accepted'
$other = $record.PSObject.Copy(); $other.CommandLine += ' --unexpected'
Assert-MnpTest (-not (Test-MnpCommand $other $node $entry)) 'Extra argument accepted'
$other = $record.PSObject.Copy(); $other.CreationDate = $record.CreationDate.AddSeconds(1)
Assert-MnpTest (-not (Test-MnpSameRecord $record $other)) 'Reused PID accepted'
$other = $record.PSObject.Copy(); $other.ParentProcessId = 91
Assert-MnpTest (-not (Test-MnpSameRecord $record $other)) 'Changed parent accepted'

# 부모 창뿐 아니라 제어 명령이 만든 실제 자식 프로세스의 콘솔도 확인한다.
$mnpTestDirectory = Join-Path ([IO.Path]::GetTempPath()) ('mnp-runtime-controller-' + [guid]::NewGuid().ToString('N'))
$null = [IO.Directory]::CreateDirectory($mnpTestDirectory)
try {
    $mnpConsoleProbe = @'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class MnpHiddenQueryProbe {
    [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool IsWindowVisible(IntPtr window);
}
"@
$window = [MnpHiddenQueryProbe]::GetConsoleWindow()
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
[Console]::Error.WriteLine('fixture-error')
@{ handle = $window.ToInt64(); visible = [MnpHiddenQueryProbe]::IsWindowVisible($window); text = '숨김 조회 검증' } | ConvertTo-Json -Compress
exit 7
'@
    $mnpProbePath = Join-Path $mnpTestDirectory 'console-probe.ps1'
    [IO.File]::WriteAllText($mnpProbePath, $mnpConsoleProbe, (New-Object Text.UTF8Encoding($true)))
    $mnpProbeArguments = '-NoLogo -NoProfile -NonInteractive -File "' + $mnpProbePath + '"'
    $mnpHiddenResult = Invoke-MnpHiddenCommand (Join-Path $PSHOME 'powershell.exe') $mnpProbeArguments
    Assert-MnpTest (-not [string]::IsNullOrWhiteSpace($mnpHiddenResult.Output)) ('Hidden probe failed: ' + ($mnpHiddenResult | ConvertTo-Json -Compress))
    $mnpProbeResult = $mnpHiddenResult.Output | ConvertFrom-Json
    Assert-MnpTest ($mnpProbeResult.handle -eq 0 -and -not $mnpProbeResult.visible) ('Hidden query created a console window: ' + $mnpHiddenResult.Output)
    Assert-MnpTest ($mnpProbeResult.text -eq '숨김 조회 검증') 'Hidden query damaged UTF-8 output'
    Assert-MnpTest ($mnpHiddenResult.ExitCode -eq 7 -and $mnpHiddenResult.Error.Trim() -eq 'fixture-error') 'Hidden query lost exit status or stderr'
    Assert-MnpThrows { Invoke-MnpHiddenCommand $node '-e "setTimeout(() => {}, 10000)"' 1 } 'timed out'

    $script:context = [pscustomobject]@{ StateDirectory = $mnpTestDirectory; Task = [pscustomobject]@{ TaskName = 'test-only'; TaskPath = '\' }; Config = [pscustomobject]@{ webUrl = 'http://example.invalid' } }
    $script:snapshot = [pscustomobject]@{ Records = @([pscustomobject]@{ Role = 'api'; Process = $record }); Listeners = @() }
    $script:descriptor = $null
    $script:calls = @()
    $script:stopped = $false
    $script:healthy = $true
    function Get-MnpContext { return $script:context }
    function Get-MnpSnapshot { return $script:snapshot }
    function Get-MnpDescriptor { return $script:descriptor }
    function Stop-ScheduledTask { $script:calls += 'stop-task' }
    function Start-ScheduledTask { $script:calls += 'start-task' }
    function Send-MnpShutdown { $script:calls += 'graceful' }
    function Stop-MnpLegacy { $script:calls += 'legacy'; $script:stopped = $true }
    function Test-MnpStopped { return $script:stopped }
    function Test-MnpHttp { return $script:healthy }
    function Wait-MnpCondition([scriptblock]$Condition, [int]$Seconds, [string]$Failure) { if (-not (& $Condition)) { throw $Failure } }

    Assert-MnpThrows { Invoke-MnpRuntime restart 1 1 $false $false } 'Legacy runtime'
    Assert-MnpTest ($script:calls.Count -eq 0) 'Legacy guard stopped a task before consent'
    Invoke-MnpRuntime start 1 1 $false $false
    Assert-MnpTest ($script:calls.Count -eq 0) 'Start restarted an existing healthy server'
    $script:healthy = $false
    Assert-MnpThrows { Invoke-MnpRuntime start 1 1 $false $false } 'not healthy'
    Assert-MnpTest ($script:calls.Count -eq 0) 'Start replaced an unhealthy existing server'
    $script:healthy = $true
    $script:descriptor = [pscustomobject]@{ instanceId = 'fixture' }
    Assert-MnpThrows { Invoke-MnpRuntime restart 1 1 $false $false } 'Stop timed out'
    Assert-MnpTest (($script:calls -join ',') -eq 'stop-task,graceful') 'Stop timeout forced termination or started another server'
    $script:calls = @(); $script:descriptor = $null
    Invoke-MnpRuntime stop 1 1 $false $true
    Assert-MnpTest (($script:calls -join ',') -eq 'stop-task,legacy') 'Explicit legacy stop did not use ordered stop-only flow'
    $script:calls = @(); $script:stopped = $false
    $script:snapshot = [pscustomobject]@{ Records = @(); Listeners = @() }
    Assert-MnpThrows { Invoke-MnpRuntime start 1 1 $false $false } 'still occupied'
    Assert-MnpTest ($script:calls.Count -eq 0) 'Occupied ports allowed startup'
    $lock = [IO.File]::Open((Join-Path $mnpTestDirectory 'runtime-operation.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
    try { Assert-MnpThrows { Invoke-MnpRuntime restart 1 1 $false $true } '.' }
    finally { $lock.Dispose() }
    Assert-MnpTest ($script:calls.Count -eq 0) 'Concurrent restart changed task state'
    # A single transient final HTTP failure retries checks, never the scheduled task itself.
    $script:context.Config | Add-Member -NotePropertyName apiPort -NotePropertyValue 44176
    $script:context.Config | Add-Member -NotePropertyName webPort -NotePropertyValue 44175
    $script:snapshot = [pscustomobject]@{ Records = @([pscustomobject]@{ Role = 'api'; Process = $record }); Listeners = @() }
    $script:httpChecks = 0; $script:finalChecksFail = $false
    function Start-ScheduledTask {
        $script:calls += 'start-task'
        $api = $record.PSObject.Copy(); $api.ProcessId = 101; $api.CreationDate = [datetime]::UtcNow.AddSeconds(1)
        $web = $record.PSObject.Copy(); $web.ProcessId = 102; $web.CreationDate = [datetime]::UtcNow.AddSeconds(1)
        $script:snapshot = [pscustomobject]@{ Records = @([pscustomobject]@{Role='api';Process=$api},[pscustomobject]@{Role='web';Process=$web});
            Listeners = @([pscustomobject]@{LocalPort=44176;OwningProcess=101},[pscustomobject]@{LocalPort=44175;OwningProcess=102}) }
    }
    function Test-MnpHttp { $script:httpChecks++; return $script:httpChecks -eq 1 -or (-not $script:finalChecksFail -and $script:httpChecks -ge 3) }
    function Wait-MnpCondition([scriptblock]$Condition, [int]$Seconds, [string]$Failure) {
        for ($attempt = 0; $attempt -lt 2; $attempt++) { if (& $Condition) { return } }
        throw $Failure
    }
    Invoke-MnpRuntime restart 1 1 $false $true
    Assert-MnpTest ($script:httpChecks -eq 3) 'Final readiness did not retry a transient failure'
    Assert-MnpTest (($script:calls -join ',') -eq 'stop-task,legacy,start-task') 'HTTP retry repeated task startup'
    $script:calls = @(); $script:httpChecks = 0; $script:finalChecksFail = $true
    Assert-MnpThrows { Invoke-MnpRuntime restart 1 1 $false $true } 'HTTP readiness was not restored'
    Assert-MnpTest (@($script:calls | Where-Object { $_ -eq 'start-task' }).Count -eq 1) 'Persistent HTTP failure caused repeated startup'
    $script:calls = @()
    function Get-MnpContext { throw 'task not found' }
    Assert-MnpThrows { Invoke-MnpRuntime restart 1 1 $false $true } 'task not found'
    Assert-MnpTest ($script:calls.Count -eq 0) 'Missing task allowed stop'
    Write-Host 'Runtime controller safety checks passed (20 cases).'
} finally {
    $resolved = [IO.Path]::GetFullPath($mnpTestDirectory)
    if ([IO.Path]::GetDirectoryName($resolved) -ine ([IO.Path]::GetTempPath().TrimEnd('\')) -or [IO.Path]::GetFileName($resolved) -notlike 'mnp-runtime-controller-*') { throw 'Unsafe fixture cleanup path' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
