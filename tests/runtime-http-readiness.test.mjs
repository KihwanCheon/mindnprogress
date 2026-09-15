import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'

test('HTTP 준비 검사는 느린 정상 응답을 취소하지 않고 전체 시작 제한·오류 응답은 지킨다', { skip: process.platform !== 'win32', timeout: 30000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'mnp-http-deadline-'))
  const sockets = new Set()
  const server = createServer((request, response) => {
    if (request.url === '/never') return
    if (request.url === '/bad') { response.writeHead(503); response.end('{}'); return }
    if (request.url === '/invalid') { response.end('not-json'); return }
    if (request.url === '/wrong-status') { response.end('{"status":"starting"}'); return }
    const timer = setTimeout(() => response.end('{"status":"ok"}'), request.url === '/slow' ? 1800 : 0)
    response.once('close', () => clearTimeout(timer))
  })
  server.on('connection', (socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)) })
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const baseUrl = `http://127.0.0.1:${server.address().port}`
    const probePath = path.join(directory, 'probe.ps1')
    const resultPath = path.join(directory, 'result.json')
    const quote = (value) => `'${value.replaceAll("'", "''")}'`
    await writeFile(probePath, `
$ErrorActionPreference = 'Stop'
. ${quote(path.resolve(import.meta.dirname, '../scripts/mnp-runtime.ps1'))}
$context = [pscustomobject]@{ Config = [pscustomobject]@{ webUrl='${baseUrl}/slow'; apiUrl='${baseUrl}/slow' } }
$old = Test-MnpHttp $context
$oldDetail = $script:MnpLastHttpCheck
$watch = [Diagnostics.Stopwatch]::StartNew()
Wait-MnpHttpReady $context ([datetime]::UtcNow.AddSeconds(5)) 'slow healthy response failed'
$slowElapsed = $watch.ElapsedMilliseconds
$slowDetail = $script:MnpLastHttpCheck
$invalidResults = @()
foreach ($route in @('bad','invalid','wrong-status')) {
  $context.Config.webUrl = '${baseUrl}/ok'; $context.Config.apiUrl = '${baseUrl}/' + $route
  $invalidResults += (Test-MnpHttp $context 2000)
}
$context.Config.apiUrl = '${baseUrl}/never'
$watch.Restart(); $timedOut = $false
try { Wait-MnpHttpReady $context ([datetime]::UtcNow.AddMilliseconds(500)) 'expected deadline' }
catch { if ($_.Exception.Message -ne 'expected deadline') { throw }; $timedOut = $true }
$timeoutElapsed = $watch.ElapsedMilliseconds
$timeoutDetail = $script:MnpLastHttpCheck
$context.Config.webUrl = '${baseUrl}/never'; $context.Config.apiUrl = '${baseUrl}/ok'
$webTimedOut = -not (Test-MnpHttp $context 500)
$webTimeoutDetail = $script:MnpLastHttpCheck
$watch.Restart(); $expired = $false
try { Wait-MnpHttpReady $context ([datetime]::UtcNow.AddSeconds(-1)) 'expired deadline' }
catch { if ($_.Exception.Message -ne 'expired deadline') { throw }; $expired = $true }
$expiredElapsed = $watch.ElapsedMilliseconds
$result = @{ oldHealthy=$old; old=$oldDetail; slow=$slowDetail; slowElapsed=$slowElapsed; invalidResults=$invalidResults;
  timedOut=$timedOut; timeoutElapsed=$timeoutElapsed; timeoutDetail=$timeoutDetail;
  webTimedOut=$webTimedOut; webTimeoutDetail=$webTimeoutDetail; expired=$expired; expiredElapsed=$expiredElapsed }
[IO.File]::WriteAllText(${quote(resultPath)}, ($result | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding($false)))
`)
    await promisify(execFile)(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', probePath], { windowsHide: true, timeout: 25000 })
    const result = JSON.parse(await readFile(resultPath, 'utf8'))
    assert.equal(result.oldHealthy, false, 'The old 900 ms cancellation was not reproduced')
    assert.equal(result.old.timeoutMs, 900)
    assert.equal(result.slow.healthy, true)
    assert.equal(result.slow.webStatus, 200)
    assert.equal(result.slow.apiStatus, 200)
    assert.ok(result.slowElapsed >= 1700 && result.slowElapsed < 5000)
    assert.deepEqual(result.invalidResults, [false, false, false])
    assert.equal(result.timedOut, true)
    assert.equal(result.timeoutDetail.webStatus, 200, 'Healthy web response was lost when API timed out')
    assert.equal(result.timeoutDetail.apiStatus, null)
    assert.equal(result.webTimedOut, true)
    assert.equal(result.webTimeoutDetail.apiStatus, 200, 'Healthy API response was lost when web timed out')
    assert.equal(result.webTimeoutDetail.webStatus, null)
    assert.ok(result.timeoutElapsed < 2000, `Unresponsive endpoint exceeded its deadline: ${result.timeoutElapsed}`)
    assert.equal(result.expired, true)
    assert.ok(result.expiredElapsed < 500, 'Expired deadline initiated another request')
    console.log(`[HTTP] old 900ms probe rejected the healthy 1800ms response; shared-deadline probe accepted it in ${result.slowElapsed}ms; hanging endpoint stopped in ${result.timeoutElapsed}ms`)
  } finally {
    for (const socket of sockets) socket.destroy()
    await new Promise((resolve) => server.close(resolve))
    assert.equal(path.dirname(directory), tmpdir())
    assert.ok(path.basename(directory).startsWith('mnp-http-deadline-'))
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
})

test('첫 HTTP 요청만 멈춘 경우 같은 시작 제한 안에서 새 요청으로 준비 상태를 다시 확인한다', { skip: process.platform !== 'win32', timeout: 25000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'mnp-http-reprobe-'))
  const sockets = new Set()
  const attempts = new Map()
  const server = createServer((request, response) => {
    const count = (attempts.get(request.url) ?? 0) + 1
    attempts.set(request.url, count)
    if (request.url.endsWith('-first-hangs') && count === 1) return
    response.end('{"status":"ok"}')
  })
  server.on('connection', (socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)) })
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const baseUrl = `http://127.0.0.1:${server.address().port}`
    const probePath = path.join(directory, 'probe.ps1')
    const resultPath = path.join(directory, 'result.json')
    const quote = (value) => `'${value.replaceAll("'", "''")}'`
    await writeFile(probePath, `
$ErrorActionPreference = 'Stop'
. ${quote(path.resolve(import.meta.dirname, '../scripts/mnp-runtime.ps1'))}
$results = @()
foreach ($side in @('web', 'api')) {
  $context = [pscustomobject]@{ Config = [pscustomobject]@{ webUrl='${baseUrl}/ok'; apiUrl='${baseUrl}/ok' } }
  $context.Config.($side + 'Url') = '${baseUrl}/' + $side + '-first-hangs'
  $watch = [Diagnostics.Stopwatch]::StartNew(); $recovered = $false
  try { Wait-MnpHttpReady $context ([datetime]::UtcNow.AddSeconds(7)) 'first request exhausted startup'; $recovered = $true }
  catch { if ($_.Exception.Message -ne 'first request exhausted startup') { throw } }
  $results += @{ side=$side; recovered=$recovered; elapsedMs=$watch.ElapsedMilliseconds; detail=$script:MnpLastHttpCheck }
}
[IO.File]::WriteAllText(${quote(resultPath)}, (ConvertTo-Json -InputObject $results -Depth 4), (New-Object Text.UTF8Encoding($false)))
`)
    await promisify(execFile)(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', probePath], { windowsHide: true, timeout: 20000 })
    const results = JSON.parse(await readFile(resultPath, 'utf8'))
    for (const result of results) {
      assert.equal(result.recovered, true, `${result.side}: the first stalled request consumed the entire deadline`)
      assert.ok(result.elapsedMs < 7000)
      assert.equal(result.detail.webStatus, 200)
      assert.equal(result.detail.apiStatus, 200)
      assert.ok(attempts.get(`/${result.side}-first-hangs`) >= 2)
    }
    console.log(`[HTTP] stalled first requests recovered without server restart: ${results.map((item) => `${item.side}=${item.elapsedMs}ms`).join(', ')}`)
  } finally {
    for (const socket of sockets) socket.destroy()
    await new Promise((resolve) => server.close(resolve))
    assert.equal(path.dirname(directory), tmpdir())
    assert.ok(path.basename(directory).startsWith('mnp-http-reprobe-'))
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
})
