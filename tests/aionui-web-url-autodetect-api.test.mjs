import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { probeAionUiWebPorts } from '../server/lib/aionUiWebPortProbe.mjs'

const projectDirectory = path.resolve(import.meta.dirname, '..')
const adminEmail = 'webui-autodetect-admin@mind.local'
const adminPassword = 'webui-autodetect-admin-password'
const conversationId = 'main-conversation-1'

async function listen(handler) {
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return server
}

async function closedPort() {
  const server = await listen(() => {})
  const { port } = server.address()
  await new Promise((resolve) => server.close(resolve))
  return port
}

function fakeWebUi() {
  return listen((req, res) => {
    if (req.url !== '/api/auth/status') return res.writeHead(404).end()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ success: true, needs_setup: false, user_count: 1, is_authenticated: false }))
  })
}

async function request(baseUrl, cookie, pathname, method = 'GET', body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { response, body: await response.json() }
}

async function withServer(webUrl, run) {
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'mnp-webui-autodetect-'))
  const port = 40_000 + Math.floor(Math.random() * 4_000)
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
      MNP_PUBLIC_URL: `http://127.0.0.1:${port}`,
      MNP_MACHINE_ID: 'desk-win',
      MNP_AIONUI_URL: 'http://127.0.0.1:9',
      MNP_AIONUI_DISCOVERY_FILE: path.join(dataDirectory, 'no-aion.json'),
      MNP_AIONUI_WEB_URL: webUrl,
      MNP_ADMIN_EMAIL: adminEmail,
      MNP_ADMIN_PASSWORD: adminPassword,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let diagnosticLog = ''
  server.stderr.on('data', (chunk) => { diagnosticLog += chunk })
  try {
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      try { if ((await fetch(`${baseUrl}/api/health`)).ok) break } catch { /* 서버 시작 대기 */ }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    const login = await request(baseUrl, '', '/api/auth/login', 'POST', { email: adminEmail, password: adminPassword })
    assert.equal(login.response.status, 200, diagnosticLog)
    const cookie = login.response.headers.get('set-cookie')?.split(';')[0]
    const created = await request(baseUrl, cookie, '/api/maps', 'POST', {
      title: 'WebUI 자동 감지',
      map: { nodes: [{
        id: 'root-card', type: 'mind', position: { x: 0, y: 0 },
        data: {
          label: '루트', kind: 'root', progress: 0, status: 'planned',
          aiConversationId: conversationId,
          aiConversations: [{ conversationId, homeMachineId: 'desk-win' }],
        },
      }], edges: [] },
    })
    assert.equal(created.response.status, 201, JSON.stringify(created.body))
    const openUrlPath = `/api/maps/${created.body.map.id}/cards/root-card/ai-conversations/${conversationId}/open-url`
    await run({ baseUrl, cookie, openUrlPath })
  } finally {
    if (server.exitCode === null) {
      server.kill()
      await new Promise((resolve) => server.once('exit', resolve))
    }
    await rm(dataDirectory, { recursive: true, force: true })
  }
}

test('메인 머신 대화 주소는 설정 포트가 응답하면 설정 주소를 쓴다', { timeout: 60_000 }, async () => {
  const webUi = await fakeWebUi()
  const webUrl = `http://127.0.0.1:${webUi.address().port}`
  try {
    await withServer(webUrl, async ({ baseUrl, cookie, openUrlPath }) => {
      const opened = await request(baseUrl, cookie, openUrlPath)
      assert.equal(opened.response.status, 200)
      assert.equal(opened.body.homeMachineRole, 'main')
      assert.equal(opened.body.openUrl, `${webUrl}/#/conversation/${conversationId}`)
    })
  } finally {
    await new Promise((resolve) => webUi.close(resolve))
  }
})

test('메인 머신 대화 주소는 설정 포트가 응답하지 않으면 실제 응답하는 AionUi 포트로 바뀐다', { timeout: 60_000 }, async () => {
  const webUrl = `http://127.0.0.1:${await closedPort()}`
  // 이 PC에서 실제로 실행 중인 AionUi(7777·25808·25810)에 따라 기대값이 달라지므로 같은 판정으로 구한다.
  const actual = await probeAionUiWebPorts(webUrl)
  const expectedBase = actual.respondingPorts.length > 0 ? `http://127.0.0.1:${actual.respondingPorts[0]}` : webUrl
  await withServer(webUrl, async ({ baseUrl, cookie, openUrlPath }) => {
    const opened = await request(baseUrl, cookie, openUrlPath)
    assert.equal(opened.response.status, 200)
    assert.equal(opened.body.openUrl, `${expectedBase}/#/conversation/${conversationId}`)

    const probe = await request(baseUrl, cookie, '/api/machines/desk-win/probe', 'POST')
    assert.equal(probe.response.status, 200)
    assert.equal(probe.body.webUi.configuredUrl, webUrl, '연결 확인은 자동 감지와 관계없이 설정 주소를 기준으로 진단한다')
  })
})
