import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const projectDirectory = path.resolve(import.meta.dirname, '..')
const adminEmail = 'webui-probe-admin@mind.local'
const adminPassword = 'webui-probe-admin-password'
// 실제 사내 주소를 쓰지 않는다. TEST-NET-1은 문서·예제 전용 대역이다.
const runnerNetworkAddress = '192.0.2.23'

async function waitForServer(baseUrl, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) return
    } catch {
      // 서버 시작 대기
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('WebUI 포트 확인 검증 서버가 제한 시간 안에 시작되지 않았습니다.')
}

async function stopServer(server) {
  if (server.exitCode !== null) return
  server.kill()
  await new Promise((resolve) => server.once('exit', resolve))
}

async function request(baseUrl, cookie, pathname, method = 'GET', body, headers = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { response, body: await response.json() }
}

// 서브 머신 백엔드 확인은 Runner 대기열을 거치므로 Runner처럼 요청을 가져가 응답한다.
// 전달 헤더 없이 loopback에서 가져가므로 관측 주소는 바뀌지 않는다.
async function requestWithRunner(baseUrl, token, pendingRequest) {
  let outcome = null
  const trackedRequest = pendingRequest.then(
    (value) => { outcome = { value } },
    (error) => { outcome = { error } },
  )
  while (!outcome) {
    const claimed = await request(baseUrl, '', '/api/machines/macbook/runner/operations/claim', 'POST',
      { waitMs: 1_000, limit: 16, callbackBaseUrl: 'http://127.0.0.1:43129' },
      { Authorization: `Bearer ${token}` })
    assert.equal(claimed.response.status, 200)
    for (const operation of claimed.body.operations) {
      assert.equal(operation.request.pathname, '/api/internal/conversation-runtimes/active')
      const settled = await request(baseUrl, '', `/api/machines/macbook/runner/operations/${operation.operationId}/result`, 'POST',
        { ok: true, data: { schema_version: 1, items: [] } },
        { Authorization: `Bearer ${token}`, 'X-MnP-Operation-Token': operation.resultToken })
      assert.equal(settled.response.status, 200)
    }
    await Promise.race([trackedRequest, new Promise((resolve) => setTimeout(resolve, 5))])
  }
  await trackedRequest
  if (outcome.error) throw outcome.error
  return outcome.value
}

async function startFakeWebUi() {
  const server = createServer((req, res) => {
    if (req.url === '/api/auth/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: true, needs_setup: false, user_count: 1, is_authenticated: false }))
      return
    }
    res.writeHead(404).end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return server
}

test('머신 연결 확인은 AI 대화 열기가 쓰는 WebUI 주소의 포트 응답을 함께 알려 준다', { timeout: 60_000 }, async () => {
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'mnp-webui-probe-'))
  const fakeWebUi = await startFakeWebUi()
  const webUiPort = fakeWebUi.address().port
  const port = 36_000 + Math.floor(Math.random() * 4_000)
  const baseUrl = `http://127.0.0.1:${port}`
  const server = spawn(process.execPath, ['server/index.mjs'], {
    cwd: projectDirectory,
    env: {
      ...process.env,
      MNP_DATA_DIR: dataDirectory,
      MNP_WORKSPACE_POOL_REGISTRY: path.join(dataDirectory, 'absent-workspaces.json'),
      MNP_API_HOST: '127.0.0.1',
      MNP_API_PORT: String(port),
      MNP_WEB_PORT: String(port),
      MNP_PUBLIC_URL: `http://192.0.2.10:${port}`,
      MNP_MACHINE_ID: 'desk-win',
      MNP_AIONUI_URL: 'http://127.0.0.1:9',
      MNP_AIONUI_WEB_URL: `http://127.0.0.1:${webUiPort}`,
      MNP_ADMIN_EMAIL: adminEmail,
      MNP_ADMIN_PASSWORD: adminPassword,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let diagnosticLog = ''
  server.stderr.on('data', (chunk) => { diagnosticLog += chunk })

  try {
    await waitForServer(baseUrl)
    const login = await request(baseUrl, '', '/api/auth/login', 'POST', { email: adminEmail, password: adminPassword })
    assert.equal(login.response.status, 200)
    const cookie = login.response.headers.get('set-cookie')?.split(';')[0]
    assert.ok(cookie)

    const main = await request(baseUrl, cookie, '/api/machines/desk-win/probe', 'POST')
    assert.equal(main.response.status, 200, diagnosticLog)
    // 백엔드 연결 결과는 이 PC에서 실행 중인 AionCore에 따라 달라지므로 기존 필드 유지만 확인한다.
    assert.equal(typeof main.body.reachable, 'boolean')
    assert.equal(main.body.machineId, 'desk-win')
    assert.equal(main.body.webUi.status, 'ok')
    assert.equal(main.body.webUi.configuredUrl, `http://127.0.0.1:${webUiPort}`)
    assert.equal(main.body.webUi.configuredPort, webUiPort)
    assert.equal(main.body.webUi.configuredReachable, true)
    assert.ok(main.body.webUi.respondingPorts.includes(webUiPort))
    assert.equal(main.body.webUi.configuredFromEnv, true)
    assert.equal(main.body.webUi.suggestedConfigUrl, null)

    assert.equal((await request(baseUrl, cookie, '/api/machines', 'POST', {
      machineId: 'macbook', label: '개발 맥북', platform: 'darwin',
    })).response.status, 200)
    const issued = await request(baseUrl, cookie, '/api/machines/macbook/token', 'POST')
    const runnerToken = issued.body.token

    const unknown = await requestWithRunner(baseUrl, runnerToken, request(baseUrl, cookie, '/api/machines/macbook/probe', 'POST'))
    assert.equal(unknown.response.status, 200)
    assert.equal(unknown.body.reachable, true)
    assert.equal(unknown.body.webUi.status, 'address-unknown')
    assert.match(unknown.body.webUi.error, /Runner/)

    const heartbeat = await request(baseUrl, '', '/api/machines/macbook/runner/heartbeat', 'POST', {
      callbackBaseUrl: 'http://127.0.0.1:43129',
    }, { Authorization: `Bearer ${runnerToken}`, 'X-Forwarded-For': runnerNetworkAddress })
    assert.equal(heartbeat.response.status, 200)

    const sub = await requestWithRunner(baseUrl, runnerToken, request(baseUrl, cookie, '/api/machines/macbook/probe', 'POST'))
    assert.equal(sub.response.status, 200)
    assert.equal(sub.body.reachable, true)
    const subUrl = new URL(sub.body.webUi.configuredUrl)
    assert.equal(subUrl.hostname, runnerNetworkAddress, '서브 머신은 Runner가 관측한 주소로 확인한다')
    assert.equal(Number(subUrl.port), webUiPort, '서브 머신도 같은 WebUI 포트 설정을 쓴다')
    assert.equal(sub.body.webUi.configuredReachable, false)
    assert.equal(sub.body.webUi.loopbackRespondingPorts, null, '서브 머신은 메인 PC의 loopback을 확인하지 않는다')
  } finally {
    await stopServer(server)
    await new Promise((resolve) => fakeWebUi.close(resolve))
    await rm(dataDirectory, { recursive: true, force: true })
  }
})
