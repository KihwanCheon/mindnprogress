import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const projectDirectory = path.resolve(import.meta.dirname, '..')

async function waitForServer(baseUrl, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`)
      if (response.ok) return
    } catch {
      // 서버 시작 대기
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('작업공간 이력 API 검증 서버가 제한 시간 안에 시작되지 않았습니다.')
}

function startServer(dataDirectory, port) {
  return spawn(process.execPath, ['server/index.mjs'], {
    cwd: projectDirectory,
    env: {
      ...process.env,
      MNP_DATA_DIR: dataDirectory,
      MNP_API_HOST: '127.0.0.1',
      MNP_API_PORT: String(port),
      MNP_WEB_PORT: String(port),
      MNP_ADMIN_EMAIL: 'workspace-admin@mind.local',
      MNP_ADMIN_PASSWORD: 'workspace-admin-password',
    },
    stdio: 'ignore',
  })
}

async function stopServer(server) {
  if (server.exitCode !== null) return
  server.kill()
  await new Promise((resolve) => server.once('exit', resolve))
}

async function login(baseUrl, email, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  assert.equal(response.status, 200)
  const cookie = response.headers.get('set-cookie')?.split(';')[0]
  assert.ok(cookie)
  return cookie
}

async function workspaceRequest(baseUrl, cookie, method = 'GET', body) {
  const response = await fetch(`${baseUrl}/api/integrations/aionui/workspaces`, {
    method,
    headers: {
      Cookie: cookie,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { response, body: await response.json() }
}

test('최근 AI 작업공간을 로그인 계정별로 공유하고 서버 재시작 후에도 유지한다', { timeout: 45_000 }, async () => {
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'mindnprogress-ai-workspaces-'))
  const port = 45_000 + Math.floor(Math.random() * 4_000)
  const baseUrl = `http://127.0.0.1:${port}`
  let server = startServer(dataDirectory, port)

  try {
    await waitForServer(baseUrl)
    const unauthorized = await fetch(`${baseUrl}/api/integrations/aionui/workspaces`)
    assert.equal(unauthorized.status, 401)

    const integrationToken = (await readFile(path.join(dataDirectory, '_integration-token'), 'utf8')).trim()
    const integrationResponse = await fetch(`${baseUrl}/api/integrations/aionui/workspaces`, {
      headers: { Authorization: `Bearer ${integrationToken}`, 'X-MNP-Editor-Id': 'user-admin' },
    })
    assert.equal(integrationResponse.status, 401)

    const adminCookieOnPc = await login(baseUrl, 'workspace-admin@mind.local', 'workspace-admin-password')
    const migratedByPc = await workspaceRequest(baseUrl, adminCookieOnPc, 'POST', {
      migration: true,
      workspaces: [' C:\\Git\\MindNProgress ', 'C:\\Git\\Other'],
    })
    assert.equal(migratedByPc.response.status, 200)
    assert.deepEqual(migratedByPc.body.workspaces, ['C:\\Git\\MindNProgress', 'C:\\Git\\Other'])

    const adminCookieOnWeb = await login(baseUrl, 'workspace-admin@mind.local', 'workspace-admin-password')
    const readOnWeb = await workspaceRequest(baseUrl, adminCookieOnWeb)
    assert.equal(readOnWeb.response.status, 200)
    assert.deepEqual(readOnWeb.body.workspaces, migratedByPc.body.workspaces)

    const rememberedByWeb = await workspaceRequest(baseUrl, adminCookieOnWeb, 'POST', {
      workspace: 'C:\\Git\\Other',
    })
    assert.equal(rememberedByWeb.response.status, 200)
    assert.deepEqual(rememberedByWeb.body.workspaces, ['C:\\Git\\Other', 'C:\\Git\\MindNProgress'])

    const createEditor = await fetch(`${baseUrl}/api/admin/editors`, {
      method: 'POST',
      headers: { Cookie: adminCookieOnPc, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '작업공간 편집자',
        email: 'workspace-editor@mind.local',
        password: 'workspace-editor-password',
      }),
    })
    assert.equal(createEditor.status, 201)
    const editorCookie = await login(baseUrl, 'workspace-editor@mind.local', 'workspace-editor-password')
    const editorHistory = await workspaceRequest(baseUrl, editorCookie)
    assert.equal(editorHistory.response.status, 200)
    assert.deepEqual(editorHistory.body.workspaces, [])

    const removedOnPc = await workspaceRequest(baseUrl, adminCookieOnPc, 'DELETE', {
      workspace: 'C:\\Git\\MindNProgress',
    })
    assert.equal(removedOnPc.response.status, 200)
    assert.deepEqual(removedOnPc.body.workspaces, ['C:\\Git\\Other'])

    const rejectedStaleCache = await workspaceRequest(baseUrl, adminCookieOnPc, 'POST', {
      workspaces: ['C:\\Git\\MindNProgress', 'C:\\Git\\Other'],
    })
    assert.equal(rejectedStaleCache.response.status, 400)

    const ignoredStaleMigration = await workspaceRequest(baseUrl, adminCookieOnPc, 'POST', {
      migration: true,
      workspaces: ['C:\\Git\\MindNProgress', 'C:\\Git\\Other'],
    })
    assert.equal(ignoredStaleMigration.response.status, 200)
    assert.deepEqual(ignoredStaleMigration.body.workspaces, ['C:\\Git\\Other'])

    const removedVisibleOnWeb = await workspaceRequest(baseUrl, adminCookieOnWeb)
    assert.deepEqual(removedVisibleOnWeb.body.workspaces, ['C:\\Git\\Other'])

    const removedAllOnWeb = await workspaceRequest(baseUrl, adminCookieOnWeb, 'DELETE', {
      workspace: 'C:\\Git\\Other',
    })
    assert.equal(removedAllOnWeb.response.status, 200)
    assert.deepEqual(removedAllOnWeb.body.workspaces, [])

    const ignoredMigrationAfterRemovingAll = await workspaceRequest(baseUrl, adminCookieOnPc, 'POST', {
      migration: true,
      workspaces: ['C:\\Git\\MindNProgress', 'C:\\Git\\Other'],
    })
    assert.equal(ignoredMigrationAfterRemovingAll.response.status, 200)
    assert.deepEqual(ignoredMigrationAfterRemovingAll.body.workspaces, [])

    await stopServer(server)
    server = startServer(dataDirectory, port)
    await waitForServer(baseUrl)
    const adminCookieAfterRestart = await login(baseUrl, 'workspace-admin@mind.local', 'workspace-admin-password')
    const persisted = await workspaceRequest(baseUrl, adminCookieAfterRestart)
    assert.equal(persisted.response.status, 200)
    assert.deepEqual(persisted.body.workspaces, [])

    const ignoredMigrationAfterRestart = await workspaceRequest(baseUrl, adminCookieAfterRestart, 'POST', {
      migration: true,
      workspaces: ['C:\\Git\\MindNProgress', 'C:\\Git\\Other'],
    })
    assert.equal(ignoredMigrationAfterRestart.response.status, 200)
    assert.deepEqual(ignoredMigrationAfterRestart.body.workspaces, [])
  } finally {
    await stopServer(server)
    await rm(dataDirectory, { recursive: true, force: true })
  }
})
