import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const projectDirectory = path.resolve(import.meta.dirname, '..')
const adminEmail = 'runner-mcp-admin@mind.local'
const adminPassword = 'runner-mcp-admin-password'
const conversationId = 'conversation-on-sub-machine'

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
  throw new Error('Runner MCP 검증 서버가 제한 시간 안에 시작되지 않았습니다.')
}

async function stopServer(server) {
  if (server.exitCode !== null) return
  server.kill()
  await new Promise((resolve) => server.once('exit', resolve))
}

async function jsonRequest(baseUrl, pathname, { method = 'GET', cookie = '', token = '', headers = {}, body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { response, body: await response.json() }
}

test('Runner MCP만 머신 대화로 승격하고 로컬·외부 웹 인증은 그대로 유지한다', { timeout: 45_000 }, async () => {
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'mnp-runner-mcp-'))
  await writeFile(path.join(dataDirectory, '_ai-conversation-origins.json'), JSON.stringify([{
    conversationId,
    homeMachineId: 'macbook',
    mapId: 'map-runner-mcp',
    cardId: 'root-card',
    startedBy: 'user-admin',
    linkedAt: new Date().toISOString(),
  }]))
  await writeFile(path.join(dataDirectory, '_ai-attributions.json'), JSON.stringify([{
    tokenHash: 'a'.repeat(64),
    conversationId: 'unlinked-approved-conversation',
    homeMachineId: 'macbook',
    startedBy: 'user-admin',
    authorName: '승인 실행 AI',
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  }]))
  const port = 40_000 + Math.floor(Math.random() * 4_000)
  const baseUrl = `http://127.0.0.1:${port}`
  const server = spawn(process.execPath, ['server/index.mjs'], {
    cwd: projectDirectory,
    windowsHide: true,
    env: {
      ...process.env,
      MNP_DATA_DIR: dataDirectory,
      MNP_API_HOST: '127.0.0.1',
      MNP_API_PORT: String(port),
      MNP_WEB_PORT: String(port),
      MNP_MACHINE_ID: 'desk-win',
      MNP_ADMIN_EMAIL: adminEmail,
      MNP_ADMIN_PASSWORD: adminPassword,
    },
    stdio: 'ignore',
  })

  try {
    await waitForServer(baseUrl)
    const login = await jsonRequest(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { email: adminEmail, password: adminPassword },
    })
    assert.equal(login.response.status, 200)
    const cookie = login.response.headers.get('set-cookie')?.split(';')[0]
    assert.ok(cookie)

    assert.equal((await jsonRequest(baseUrl, '/api/machines', {
      method: 'POST', cookie, body: { machineId: 'macbook', label: '개발 맥북', platform: 'darwin' },
    })).response.status, 200)
    const issued = await jsonRequest(baseUrl, '/api/machines/macbook/token', { method: 'POST', cookie })
    assert.equal(issued.response.status, 200)
    const runnerToken = issued.body.token
    const integrationToken = (await readFile(path.join(dataDirectory, '_integration-token'), 'utf8')).trim()

    // 외부 웹 포트의 계정 세션과 메인 로컬 MCP의 전역 연동 토큰은 기존 계약을 유지한다.
    assert.equal((await jsonRequest(baseUrl, '/api/maps', { cookie })).response.status, 200)
    assert.equal((await jsonRequest(baseUrl, '/api/maps', { token: integrationToken })).response.status, 200)

    const runnerHeaders = {
      'X-MnP-Runner-MCP-Machine-Id': 'macbook',
      'X-MnP-AI-Conversation-Id': conversationId,
    }
    const relayed = await jsonRequest(baseUrl, '/api/maps', { token: runnerToken, headers: runnerHeaders })
    assert.equal(relayed.response.status, 200)

    const approvedWithoutCardLink = await jsonRequest(baseUrl, '/api/maps', {
      token: runnerToken,
      headers: {
        'X-MnP-Runner-MCP-Machine-Id': 'macbook',
        'X-MnP-AI-Conversation-Id': 'unlinked-approved-conversation',
      },
    })
    assert.equal(approvedWithoutCardLink.response.status, 200)

    const missingConversation = await jsonRequest(baseUrl, '/api/maps', {
      token: runnerToken,
      headers: { 'X-MnP-Runner-MCP-Machine-Id': 'macbook' },
    })
    assert.equal(missingConversation.response.status, 403)
    assert.equal(missingConversation.body.code, 'MNP_RUNNER_MCP_CONVERSATION_DENIED')

    const mismatchedAccount = await jsonRequest(baseUrl, '/api/maps', {
      token: runnerToken,
      headers: { ...runnerHeaders, 'X-MnP-AI-Editor-Id': 'user-other' },
    })
    assert.equal(mismatchedAccount.response.status, 403)
    assert.equal(mismatchedAccount.body.code, 'MNP_RUNNER_MCP_ACCOUNT_MISMATCH')

    const forbiddenRoute = await jsonRequest(baseUrl, '/api/auth/me', { token: runnerToken, headers: runnerHeaders })
    assert.equal(forbiddenRoute.response.status, 403)
    assert.equal(forbiddenRoute.body.code, 'MNP_RUNNER_MCP_PATH_DENIED')
  } finally {
    await stopServer(server)
    await rm(dataDirectory, { recursive: true, force: true })
  }
})
