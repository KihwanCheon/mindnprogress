$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\scripts\mnp-runtime.ps1')

function Assert-PortCheck($Condition, $Message) { if (-not $Condition) { throw $Message } }
function Assert-PortFailure([scriptblock]$Work, [string]$Pattern) {
    try { & $Work } catch { if ($_.Exception.Message -match $Pattern) { return }; throw }
    throw "Expected failure: $Pattern"
}

# 실제 snapshot을 호출한다. 프로세스 목록·소유 계정·netstat 출력만 격리하고 운영 작업은 호출하지 않는다.
& {
    $mnpFixtureContext = [pscustomobject]@{
        Project = 'C:\fixture\MindNProgress'; Launcher = 'C:\fixture\MindNProgress_Launcher.cjs'
        Node = 'C:\fixture\node.exe'; TaskExe = 'C:\fixture\wscript.exe'; OwnerSid = 'fixture-owner'
        Task = [pscustomobject]@{ Actions = @([pscustomobject]@{ Arguments = 'fixture-task' }) }
        Config = [pscustomobject]@{ apiPort = 44176; webPort = 44175 }; Ports = @(44175, 44176)
    }
    $mnpFixtureProcesses = @(
        [pscustomobject]@{ ProcessId = 10; ParentProcessId = 1; CreationDate = [datetime]'2026-01-01';
            ExecutablePath = $mnpFixtureContext.TaskExe; CommandLine = '"C:\fixture\wscript.exe" fixture-task' }
    )
    $mnpFixtureEntries = @($mnpFixtureContext.Launcher, 'C:\fixture\MindNProgress\scripts\dev.mjs',
        'C:\fixture\MindNProgress\server\index.mjs', 'C:\fixture\MindNProgress\scripts\runtime\web.mjs')
    for ($index = 0; $index -lt $mnpFixtureEntries.Count; $index++) {
        $mnpFixtureProcesses += [pscustomobject]@{ ProcessId = 11 + $index; ParentProcessId = [math]::Min(10 + $index, 12);
            CreationDate = ([datetime]'2026-01-01').AddSeconds(1 + $index); ExecutablePath = $mnpFixtureContext.Node;
            CommandLine = '"C:\fixture\node.exe" "' + $mnpFixtureEntries[$index] + '"' }
    }
    $mnpFixtureOutput = @'
Active Connections
  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:44175           0.0.0.0:0              LISTENING       14
  TCP    [::1]:44176            [::]:0                 LISTENING       13
  TCP    127.0.0.1:44175         127.0.0.1:55555        ESTABLISHED     999
  TCP    127.0.0.1:44177         0.0.0.0:0              LISTENING       999
  UDP    0.0.0.0:44176           *:*                                    999
'@
    $mnpFixtureResult = [pscustomobject]@{ ExitCode = 0; Output = $mnpFixtureOutput; Error = '' }
    function Get-CimInstance { param($ClassName, $Filter); Assert-PortCheck ($ClassName -eq 'Win32_Process') 'Unexpected CIM query'; return $mnpFixtureProcesses }
    function Get-MnpProcessOwnerSid { return 'fixture-owner' }
    function Get-NetTCPConnection { throw 'Broken NetTCPIP provider must not be queried' }
    function Invoke-MnpHiddenCommand {
        param($Executable, $Arguments)
        Assert-PortCheck ($Executable -eq (Join-Path $env:SystemRoot 'System32\netstat.exe')) 'Unexpected query executable'
        Assert-PortCheck ($Arguments -eq '-ano') 'Query must include both IPv4 and IPv6'
        return $mnpFixtureResult
    }
    $mnpSnapshot = Get-MnpSnapshot $mnpFixtureContext
    Assert-PortCheck ($mnpSnapshot.Records.Count -eq 5 -and $mnpSnapshot.Listeners.Count -eq 2) 'Default preflight lost verified processes or listeners'
    Assert-PortCheck (@($mnpSnapshot.Listeners | Where-Object { $_.LocalPort -eq 44176 -and $_.OwningProcess -eq 13 }).Count -eq 1) 'IPv6 API owner lost'
    Assert-PortCheck ((Get-MnpSnapshot $mnpFixtureContext -FastPorts).Listeners.Count -eq 2) 'Legacy fast-port caller failed'
    Assert-PortCheck ((Get-MnpSnapshot $mnpFixtureContext -FastPorts:$false).Listeners.Count -eq 2) 'False fast-port flag used the broken provider'

    $mnpFixtureResult.Output = $mnpFixtureOutput.Replace('LISTENING       14', 'LISTENING       999')
    Assert-PortFailure { Get-MnpSnapshot $mnpFixtureContext } 'not owned by the verified MnP web'
    $mnpFixtureResult.Output = $mnpFixtureOutput.Replace('LISTENING       13', 'LISTENING       14')
    Assert-PortFailure { Get-MnpSnapshot $mnpFixtureContext } 'not owned by the verified MnP api'
    $mnpFixtureResult.Output = $mnpFixtureOutput
    & {
        function Get-MnpProcessOwnerSid { return 'another-owner' }
        Assert-PortFailure { Get-MnpSnapshot $mnpFixtureContext } 'Cannot verify NHN ownership'
    }
    $mnpFixtureResult.ExitCode = 1
    Assert-PortFailure { Get-MnpSnapshot $mnpFixtureContext } 'Could not verify TCP port ownership'
    $mnpFixtureResult.ExitCode = 0; $mnpFixtureResult.Error = 'query failed'
    Assert-PortFailure { Get-MnpSnapshot $mnpFixtureContext } 'Could not verify TCP port ownership'
    $mnpFixtureResult.Error = ''
    $mnpFixtureResult.ExitCode = 0; $mnpFixtureResult.Output = ''
    Assert-PortFailure { Get-MnpSnapshot $mnpFixtureContext } 'Could not verify TCP port ownership'
    $mnpFixtureResult.Output = '  TCP    0.0.0.0:44175    0.0.0.0:0    LISTENING    invalid-pid'
    Assert-PortFailure { Get-MnpSnapshot $mnpFixtureContext } 'Unrecognized TCP row'
    $mnpFixtureResult.Output = $mnpFixtureOutput
    & {
        function Invoke-MnpHiddenCommand { throw 'Hidden runtime query timed out.' }
        Assert-PortFailure { Get-MnpSnapshot $mnpFixtureContext } 'query timed out'
    }
    $mnpFixtureProcesses = @()
    Assert-PortFailure { Get-MnpSnapshot $mnpFixtureContext } 'not owned by the verified MnP'
    $mnpFixtureResult.Output = "Active Connections`n  Proto  Local Address  Foreign Address  State  PID"
    $mnpSnapshot = Get-MnpSnapshot $mnpFixtureContext
    Assert-PortCheck ($mnpSnapshot.Records.Count -eq 0 -and $mnpSnapshot.Listeners.Count -eq 0) 'Cleanly stopped runtime rejected'
    $mnpFixtureResult.Output += "`n  TCP    127.0.0.1:44177    0.0.0.0:0    LISTENING    999"
    Assert-PortCheck ((Get-MnpSnapshot $mnpFixtureContext).Listeners.Count -eq 0) 'Unrelated port was included'
}

# 실제 Windows 조회도 확인한다. 운영 포트 대신 OS가 배정한 루프백 포트만 사용하고 반드시 닫는다.
$mnpProbeV4 = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
$mnpProbeV6 = New-Object Net.Sockets.TcpListener([Net.IPAddress]::IPv6Loopback, 0)
try {
    $mnpProbeV4.Start(); $mnpProbeV6.Start()
    $mnpProbePorts = @($mnpProbeV4.LocalEndpoint.Port, $mnpProbeV6.LocalEndpoint.Port)
    $mnpActualListeners = @(Get-MnpTcpListeners $mnpProbePorts)
    foreach ($port in $mnpProbePorts) {
        Assert-PortCheck (@($mnpActualListeners | Where-Object { $_.LocalPort -eq $port -and $_.OwningProcess -eq $PID }).Count -eq 1) 'Real listener or owning PID not found'
    }
} finally { $mnpProbeV4.Stop(); $mnpProbeV6.Stop() }
Assert-PortCheck (@(Get-MnpTcpListeners $mnpProbePorts).Count -eq 0) 'Closed listeners are still reported'
Write-Host 'Runtime port query checks passed (real IPv4/IPv6, stopped runtime, provider failure and owner guards).'
