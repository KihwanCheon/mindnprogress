import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const execFileAsync = promisify(execFile)
const defaultUnityMcpUrl = 'http://127.0.0.1:8080/mcp'
const unityBusyTitlePattern = /hold on|importing assets|compiling|reload(?:ing)? (?:assembl|domain)|building player/i
let unityMcpUnavailableUntil = 0
let unityMcpUnavailableReason = null
const unityProcessHints = new Map()

function normalizedPath(value) {
  const resolved = path.resolve(String(value ?? '').trim()).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function jsonText(result) {
  const text = result?.contents?.find((item) => item?.text)?.text
  return text ? JSON.parse(text) : null
}

export function unityEditorStateBusyReasons(state) {
  const reasons = []
  const playMode = state?.editor?.play_mode ?? {}
  if (playMode.is_playing) reasons.push('play-mode')
  if (playMode.is_changing) reasons.push('play-mode-transition')
  if (state?.compilation?.is_compiling) reasons.push('compiling')
  if (state?.compilation?.is_domain_reload_pending) reasons.push('domain-reload')
  if (state?.assets?.is_updating) reasons.push('asset-import')
  if (state?.assets?.refresh?.is_refresh_in_progress) reasons.push('asset-refresh')
  if (state?.assets?.external_changes_dirty) reasons.push('external-changes')
  if (state?.tests?.is_running) reasons.push('tests-running')
  const phase = String(state?.activity?.phase ?? '').trim()
  if (phase && phase !== 'idle' && !reasons.includes(phase)) reasons.push(phase)
  if (state?.advice?.ready_for_tools === false && reasons.length === 0) {
    reasons.push('unity-not-ready-for-tools')
  }
  return reasons
}

async function unityMcpSnapshot(workspace, {
  endpoint = process.env.MNP_UNITY_MCP_URL || defaultUnityMcpUrl,
  timeoutMs = Math.max(500, Number(process.env.MNP_UNITY_MCP_PROBE_TIMEOUT_MS) || 1_500),
} = {}) {
  const instance = String(workspace?.unityInstanceHash ?? '').trim()
  if (!instance) return null

  const timeoutController = new AbortController()
  const timer = setTimeout(() => timeoutController.abort(new Error('Unity MCP 상태 조회 시간이 초과됐습니다.')), timeoutMs)
  const probeFetch = (input, init = {}) => fetch(input, {
    ...init,
    signal: init.signal
      ? AbortSignal.any([init.signal, timeoutController.signal])
      : timeoutController.signal,
  })
  const client = new Client({ name: 'mindnprogress-unity-readiness', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    fetch: probeFetch,
    reconnectionOptions: {
      maxReconnectionDelay: 100,
      initialReconnectionDelay: 50,
      reconnectionDelayGrowFactor: 1,
      maxRetries: 0,
    },
  })
  try {
    await client.connect(transport)
    const selected = await client.callTool({
      name: 'set_active_instance',
      arguments: { instance },
    })
    if (selected?.isError) throw new Error('Unity MCP가 대상 인스턴스를 선택하지 못했습니다.')

    const project = jsonText(await client.readResource({ uri: 'mcpforunity://project/info' }))?.data
    if (!project?.projectRoot || normalizedPath(project.projectRoot) !== normalizedPath(workspace.root)) {
      throw new Error('Unity MCP 대상 프로젝트가 작업공간과 일치하지 않습니다.')
    }
    const state = jsonText(await client.readResource({ uri: 'mcpforunity://editor/state' }))?.data
    if (!state) throw new Error('Unity MCP 편집기 상태가 비어 있습니다.')
    const reasons = unityEditorStateBusyReasons(state)
    return {
      available: true,
      busy: reasons.length > 0,
      reasons,
      observedAtUnixMs: Number(state.observed_at_unix_ms) || null,
      instanceId: state.unity?.instance_id ?? instance,
    }
  } finally {
    clearTimeout(timer)
    await client.close().catch(() => {})
  }
}

const windowsUnityProbeScript = String.raw`
$ErrorActionPreference = 'Stop'
$target = [IO.Path]::GetFullPath($env:MNP_UNITY_PROBE_PROJECT_ROOT).TrimEnd('\').ToLowerInvariant()
$hint = 0
[void][int]::TryParse([string]$env:MNP_UNITY_PROBE_PID, [ref]$hint)
if ($hint -gt 0) {
  $process = Get-Process -Id $hint -ErrorAction SilentlyContinue
  if ($process) {
    $candidate = [pscustomobject]@{
      processId = [int]$process.Id
      responding = [bool]$process.Responding
      title = [string]$process.MainWindowTitle
    }
    $busy = -not $candidate.responding -or $candidate.title -match '(?i)hold on|importing assets|compiling|reload(?:ing)? (?:assembl|domain)|building player'
    [pscustomobject]@{ running = $true; busy = $busy; processes = @($candidate); usedHint = $true } | ConvertTo-Json -Depth 4 -Compress
    exit 0
  }
}
$foundProcesses = @()
foreach ($item in @(Get-CimInstance Win32_Process -Filter "Name='Unity.exe'")) {
  $commandLine = [string]$item.CommandLine
  if ($commandLine -notmatch '(?i)(?:^|\s)-projectpath\s+(?:"([^"]+)"|([^\s]+))') { continue }
  $candidate = if ($Matches[1]) { $Matches[1] } else { $Matches[2] }
  try { $resolved = [IO.Path]::GetFullPath($candidate).TrimEnd('\').ToLowerInvariant() } catch { continue }
  if ($resolved -ne $target) { continue }
  $process = Get-Process -Id $item.ProcessId -ErrorAction SilentlyContinue
  $foundProcesses += [pscustomobject]@{
    processId = [int]$item.ProcessId
    responding = if ($process) { [bool]$process.Responding } else { $false }
    title = if ($process) { [string]$process.MainWindowTitle } else { '' }
  }
}
$busy = @($foundProcesses | Where-Object { -not $_.responding -or $_.title -match '(?i)hold on|importing assets|compiling|reload(?:ing)? (?:assembl|domain)|building player' }).Count -gt 0
[pscustomobject]@{ running = $foundProcesses.Count -gt 0; busy = $busy; processes = $foundProcesses; usedHint = $false } | ConvertTo-Json -Depth 4 -Compress
`

async function windowsUnitySnapshot(workspace) {
  if (process.platform !== 'win32') return { available: false, running: null, busy: false, processes: [] }
  const powershell = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe',
  )
  const cacheKey = normalizedPath(workspace.root)
  const cached = unityProcessHints.get(cacheKey)
  const runProbe = (pid = null) => execFileAsync(powershell, [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-Command', windowsUnityProbeScript,
    ], {
      windowsHide: true,
      timeout: Math.max(1_000, Number(process.env.MNP_UNITY_PROCESS_PROBE_TIMEOUT_MS) || 5_000),
      env: {
        ...process.env,
        MNP_UNITY_PROBE_PROJECT_ROOT: workspace.root,
        MNP_UNITY_PROBE_PID: pid ? String(pid) : '',
      },
    })
  let { stdout } = await runProbe(cached?.expiresAt > Date.now() ? cached.processId : null)
  let snapshot = JSON.parse(String(stdout ?? '').trim() || '{}')
  if (snapshot.usedHint === true && snapshot.running !== true) {
    unityProcessHints.delete(cacheKey)
    ;({ stdout } = await runProbe())
    snapshot = JSON.parse(String(stdout ?? '').trim() || '{}')
  }
  const processes = Array.isArray(snapshot.processes)
    ? snapshot.processes
    : snapshot.processes ? [snapshot.processes] : []
  if (snapshot.running === true && processes[0]?.processId) {
    unityProcessHints.set(cacheKey, {
      processId: Number(processes[0].processId),
      expiresAt: Date.now() + 30_000,
    })
  } else {
    unityProcessHints.delete(cacheKey)
  }
  return {
    available: true,
    running: snapshot.running === true,
    busy: snapshot.busy === true || processes.some((item) => unityBusyTitlePattern.test(String(item?.title ?? ''))),
    processes: processes.map((item) => ({
      processId: Number(item?.processId) || null,
      responding: item?.responding === true,
      title: String(item?.title ?? '').slice(0, 240),
    })),
  }
}

export async function probeUnityWorkspaceReadiness(workspace) {
  if (!workspace?.unityInstanceHash && !workspace?.assetsPath) {
    return { ready: true, applicable: false, reason: 'unity-metadata-unavailable' }
  }

  let windows = null
  let windowsError = null
  try {
    windows = await windowsUnitySnapshot(workspace)
  } catch (error) {
    windowsError = error?.message ?? String(error)
  }
  if (windows?.available && windows.running === false) {
    return { ready: true, applicable: true, running: false, source: 'windows-process' }
  }
  if (windows?.busy) {
    return {
      ready: false,
      applicable: true,
      running: true,
      source: 'windows-process',
      reasons: ['unity-window-busy'],
      windows,
      mcp: null,
      diagnostics: windowsError ? { windowsError } : {},
    }
  }

  let mcp = null
  let mcpError = null
  if (Date.now() < unityMcpUnavailableUntil) {
    mcpError = unityMcpUnavailableReason
  } else {
    try {
      mcp = await unityMcpSnapshot(workspace)
      unityMcpUnavailableUntil = 0
      unityMcpUnavailableReason = null
    } catch (error) {
      mcpError = error?.message ?? String(error)
      unityMcpUnavailableUntil = Date.now() + 10_000
      unityMcpUnavailableReason = mcpError
    }
  }

  const reasons = [
    ...(windows?.busy ? ['unity-window-busy'] : []),
    ...(mcp?.reasons ?? []),
    ...(!windows && !mcp ? ['unity-readiness-unavailable'] : []),
  ]
  return {
    ready: reasons.length === 0,
    applicable: true,
    running: windows?.running ?? true,
    source: mcp?.available ? 'unity-mcp+windows-process' : 'windows-process',
    reasons,
    windows: windows ?? null,
    mcp: mcp ?? null,
    diagnostics: {
      ...(windowsError ? { windowsError } : {}),
      ...(mcpError ? { mcpError } : {}),
    },
  }
}

export const unityWorkspaceReadinessDefaults = Object.freeze({
  stableSamples: Math.max(1, Number(process.env.MNP_UNITY_RELEASE_STABLE_SAMPLES) || 3),
  pollMs: Math.max(100, Number(process.env.MNP_UNITY_RELEASE_POLL_MS) || 750),
  maxWaitMs: Math.max(500, Number(process.env.MNP_UNITY_RELEASE_WAIT_MS) || 12_000),
})
