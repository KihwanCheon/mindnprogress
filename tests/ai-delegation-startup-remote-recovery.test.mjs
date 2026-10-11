import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const projectDirectory = path.resolve(import.meta.dirname, '..')

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return server.address().port
}

async function availablePort() {
  const probe = createServer()
  const port = await listen(probe)
  await new Promise((resolve) => probe.close(resolve))
  return port
}

async function waitForHealth(baseUrl, output) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) return
    } catch { /* 서버 기동 대기 */ }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`원격 위임 복구 중 API가 열리지 않았습니다.\n${output()}`)
}

async function stop(server) {
  if (!server || server.exitCode !== null) return
  server.kill()
  await new Promise((resolve) => server.once('exit', resolve))
}

test('원격 위임 상태 복구는 API 수신 후 Runner 요청으로 처리해 시작을 막지 않는다', { timeout: 40_000 }, async () => {
  const testRoot = await mkdtemp(path.join(tmpdir(), 'mnp-remote-startup-'))
  const dataDirectory = path.join(testRoot, 'data')
  const registry = path.join(testRoot, 'test-workspaces.json')
  const integration = path.join(testRoot, 'integration')
  const worker = path.join(testRoot, 'worker')
  await mkdir(dataDirectory); await mkdir(integration); await mkdir(worker)
  await writeFile(registry, JSON.stringify({ schemaVersion: 1, poolId: 'test-pool', sharedRoot: testRoot,
    workspaces: [{ id: 'main', root: integration, role: 'integration' }, { id: 'worker', root: worker, role: 'worker' }] }))

  const upstream = createServer((request, response) => {
    const capabilities = request.url === '/api/internal/external-conversation-dispatches/capabilities'
    response.writeHead(capabilities ? 200 : 404, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ success: capabilities, data: capabilities ? {
      workspaceLeaseVersion: 2, atomicWorkspaceRebind: true, releasesRuntimeOnTerminal: true,
    } : {} }))
  })
  let server
  try {
    const upstreamPort = await listen(upstream)
    const port = await availablePort()
    const baseUrl = `http://127.0.0.1:${port}`
    const env = { ...process.env, MNP_DATA_DIR: dataDirectory, MNP_API_HOST: '127.0.0.1',
      MNP_API_PORT: String(port), MNP_WEB_PORT: String(port), MNP_MACHINE_ID: 'desk-win',
      MNP_WORKSPACE_POOL_REGISTRY: registry, MNP_AIONUI_URL: `http://127.0.0.1:${upstreamPort}`,
      MNP_ADMIN_EMAIL: 'admin@startup.test', MNP_ADMIN_PASSWORD: 'startup-test-password' }
    let output = ''
    const start = () => {
      output = ''
      const child = spawn(process.execPath, ['server/index.mjs'], { cwd: projectDirectory, env, stdio: ['ignore', 'pipe', 'pipe'] })
      child.stdout.on('data', (chunk) => { output += String(chunk) })
      child.stderr.on('data', (chunk) => { output += String(chunk) })
      return child
    }
    server = start()
    await waitForHealth(baseUrl, () => output)
    const login = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@startup.test', password: 'startup-test-password' }) })
    assert.equal(login.status, 200)
    const cookie = login.headers.get('set-cookie')?.split(';')[0]
    assert.ok(cookie)
    const register = await fetch(`${baseUrl}/api/machines`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ machineId: 'macbook', label: '맥북', platform: 'darwin' }) })
    assert.equal(register.status, 200)
    const tokenResponse = await fetch(`${baseUrl}/api/machines/macbook/token`, { method: 'POST', headers: { Cookie: cookie } })
    assert.equal(tokenResponse.status, 200)
    const { token } = await tokenResponse.json()
    await stop(server)

    const now = new Date().toISOString()
    await writeFile(path.join(dataDirectory, '_ai-delegations.json'), JSON.stringify([{
      id: 'remote-startup-recovery', mapId: 'map-test', parentCardId: 'parent', targetCardId: 'child',
      parentConversationId: 'parent-conversation', targetConversationId: 'child-conversation',
      parentHomeMachineId: 'desk-win', targetHomeMachineId: 'macbook', childOperationId: 'remote-startup-recovery',
      state: 'running', createdAt: now, updatedAt: now,
    }]))

    server = start()
    await waitForHealth(baseUrl, () => output)
    const claim = await fetch(`${baseUrl}/api/machines/macbook/runner/operations/claim`, { method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ waitMs: 5_000 }) })
    assert.equal(claim.status, 200)
    const claimed = await claim.json()
    assert.equal(claimed.operations.length, 1)
    assert.equal(claimed.operations[0].request.pathname,
      '/api/internal/external-conversation-dispatches/remote-startup-recovery')
    assert.equal((await fetch(`${baseUrl}/api/health`)).status, 200)
  } finally {
    await stop(server)
    await new Promise((resolve) => upstream.close(resolve))
    await rm(testRoot, { recursive: true, force: true })
  }
})
