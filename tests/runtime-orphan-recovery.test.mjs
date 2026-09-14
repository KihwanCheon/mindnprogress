import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { createConnection } from 'node:net'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

const project = path.resolve(import.meta.dirname, '..')
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(condition, message, timeout = 15000) {
  const deadline = performance.now() + timeout
  while (performance.now() < deadline) { if (await condition()) return; await pause(50) }
  throw new Error(message)
}
function alive(pid) { try { process.kill(pid, 0); return true } catch { return false } }
async function port() {
  const server = createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const value = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return value
}
async function shutdown(descriptor) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(descriptor.pipe)
    socket.on('error', reject)
    socket.setTimeout(3000, () => socket.destroy(new Error('Fixture control timeout')))
    socket.on('connect', () => socket.end(JSON.stringify({ type: 'mnp:shutdown', instanceId: descriptor.instanceId }) + '\n'))
    socket.resume(); socket.on('end', resolve)
  })
}

test('예약 작업 실행기만 중지하면 PID 자식 4개가 남고 공통 중지는 저장 완료 후 모두 회수한다', { skip: process.platform !== 'win32', timeout: 90000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mnp-orphan-recovery-'))
  const fixture = path.join(root, 'MindNProgress')
  const state = path.join(root, '.mindnprogress')
  const launcher = path.join(root, 'MindNProgress_Launcher.cjs')
  const apiPort = await port(), webPort = await port()
  let host, descriptor, pids = [], recovery
  let output = ''
  try {
    await mkdir(path.join(fixture, 'scripts/runtime'), { recursive: true })
    await mkdir(path.join(fixture, 'server'), { recursive: true })
    await writeFile(path.join(root, 'MindNProgress_Mcp.cjs'), '// Isolated existence marker; never executed.\n')
    await writeFile(launcher, `require(${JSON.stringify(path.join(project, 'scripts/runtime/launcher.cjs'))})(__dirname);\n`)
    await writeFile(path.join(fixture, 'scripts/dev.mjs'), `
import { supervise } from ${JSON.stringify(pathToFileURL(path.join(project, 'scripts/runtime/supervisor.mjs')).href)};
await supervise({ projectDirectory: ${JSON.stringify(fixture)}, stateDirectory: ${JSON.stringify(state)}, entries: [
  { name: 'api', file: ${JSON.stringify(path.join(fixture, 'server/index.mjs'))} },
  { name: 'web', file: ${JSON.stringify(path.join(fixture, 'scripts/runtime/web.mjs'))} }
] });
`)
    const service = (listenPort) => `
import { createServer } from 'node:http';
import { writeFile, access } from 'node:fs/promises';
import { createRuntimeLifecycle, installRuntimeShutdown } from ${JSON.stringify(pathToFileURL(path.join(project, 'server/lib/runtimeLifecycle.mjs')).href)};
const runtime = createRuntimeLifecycle();
const server = createServer(runtime.request(async (request, response) => {
  response.end(JSON.stringify({ status: 'ok' }));
  if (request.url === '/save') {
    await writeFile(${JSON.stringify(path.join(root, 'save-started'))}, 'started');
    for (;;) { try { await access(${JSON.stringify(path.join(root, 'release-save'))}); break; } catch {} await new Promise(resolve => setTimeout(resolve, 20)); }
    await writeFile(${JSON.stringify(path.join(root, 'saved'))}, 'save completed');
  }
}));
installRuntimeShutdown(() => runtime.stop(server));
server.listen(${listenPort}, '127.0.0.1');
`
    await writeFile(path.join(fixture, 'server/index.mjs'), service(apiPort))
    await writeFile(path.join(fixture, 'scripts/runtime/web.mjs'), service(webPort))
    host = spawn(path.join(process.env.SystemRoot, 'System32/wscript.exe'),
      ['//B', '//NoLogo', path.join(project, 'scripts/runtime/task-host.vbs'), process.execPath, launcher],
      { windowsHide: true, stdio: 'ignore' })
    const hostExited = new Promise((resolve) => host.once('exit', resolve))
    await until(async () => {
      try {
        descriptor = JSON.parse(await readFile(path.join(state, 'runtime.json'), 'utf8'))
        const responses = await Promise.all([apiPort, webPort].map((value) => fetch(`http://127.0.0.1:${value}/api/health`, { signal: AbortSignal.timeout(1000) })))
        await Promise.all(responses.map((response) => response.text()))
        return responses.every((response) => response.status === 200)
      } catch { return false }
    }, 'Fixture servers did not start')
    const hints = (await readFile(path.join(state, 'dev.pids'), 'utf8')).trim().split(/\s+/).map(Number)
    pids = [...hints, ...descriptor.children.map((entry) => entry.pid)]
    assert.equal(new Set(pids).size, 4)
    assert.ok(pids.every(alive))
    // The fixture host is the only process deliberately terminated. On Windows,
    // terminating the task's GUI process does not terminate its descendants.
    host.kill(); await hostExited; await pause(300)
    assert.ok(pids.every(alive), 'The old task-host termination no longer reproduces orphaning')
    console.log('[reproduced] task host exited; all 4 recorded child PIDs remain alive')
    await (await fetch(`http://127.0.0.1:${apiPort}/save`)).text()
    await until(async () => { try { await readFile(path.join(root, 'save-started')); return true } catch { return false } }, 'Save did not start')
    // A stale hint points at the unrelated test process. It must never be a kill target.
    await writeFile(path.join(state, 'dev.pids'), String(process.pid))
    const controller = path.join(root, 'recover.ps1')
    const quote = (value) => `'${value.replaceAll("'", "''")}'`
    await writeFile(controller, `
$ErrorActionPreference = 'Stop'
. ${quote(path.join(project, 'scripts/mnp-runtime.ps1'))}
function Get-MnpContext {
  return [pscustomobject]@{ Project=${quote(fixture)}; Root=${quote(root)}; Launcher=${quote(launcher)}; Node=${quote(process.execPath)};
    TaskExe=(Join-Path $env:SystemRoot 'System32\\wscript.exe'); OwnerSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;
    Task=[pscustomobject]@{ TaskName='isolated-already-stopped'; TaskPath='\\'; Actions=@([pscustomobject]@{Arguments='fixture-host-already-exited'}) };
    StateDirectory=${quote(state)}; Ports=@(${apiPort},${webPort}); Config=[pscustomobject]@{apiPort=${apiPort};webPort=${webPort};apiUrl='http://127.0.0.1:${apiPort}/api/health';webUrl='http://127.0.0.1:${webPort}/'} }
}
function Stop-ScheduledTask { param($TaskName,$TaskPath); if ($TaskName -ne 'isolated-already-stopped') { throw 'Wrong fixture task' } }
function Start-ScheduledTask { throw 'Stop-only recovery must never start a task' }
Invoke-MnpRuntime stop 30 30 $false $false
`)
    recovery = spawn(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', controller], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    recovery.stdout.on('data', (value) => { output += value }); recovery.stderr.on('data', (value) => { output += value })
    const recovered = new Promise((resolve) => recovery.once('exit', resolve))
    await until(async () => (await readFile(path.join(state, 'dev.out.log'), 'utf8')).includes('[Runtime] draining'), 'Graceful stop was not requested', 20000)
    assert.ok(alive(descriptor.children.find((entry) => entry.name === 'api').pid), 'API was killed before its save completed')
    await writeFile(path.join(root, 'release-save'), 'release')
    assert.equal(await recovered, 0, output)
    assert.equal(await readFile(path.join(root, 'saved'), 'utf8'), 'save completed')
    assert.ok(pids.every((pid) => !alive(pid)), 'Verified child processes remained')
    for (const value of [apiPort, webPort]) await assert.rejects(fetch(`http://127.0.0.1:${value}`, { signal: AbortSignal.timeout(1000) }))
    assert.ok(alive(process.pid), 'Stale PID hint killed the unrelated process')
    console.log('[verified] common stop recovered 4 child PIDs, released both ports, preserved the pending save and ignored the stale PID hint')
  } finally {
    await writeFile(path.join(root, 'release-save'), 'release')
    if (descriptor && alive(descriptor.pid)) {
      try { await shutdown(descriptor); await until(() => pids.every((pid) => !alive(pid)), 'Fixture cleanup timed out') } catch {}
    }
    if (host?.exitCode === null && host?.signalCode === null) host.kill()
    if (recovery?.exitCode === null && recovery?.signalCode === null) recovery.kill()
    assert.ok(pids.every((pid) => !alive(pid)), `Fixture processes still alive: ${pids.filter(alive).join(', ')}`)
    assert.equal(path.dirname(root), tmpdir())
    assert.ok(path.basename(root).startsWith('mnp-orphan-recovery-'))
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
})
