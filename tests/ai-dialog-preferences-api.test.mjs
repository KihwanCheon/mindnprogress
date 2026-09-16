import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

test('접힘 상태 API는 로그인 계정만 수정하고 다른 세션·서버 재시작에서 복원한다', { timeout: 45_000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'mnp-dialog-preferences-api-'))
  const probe = createServer()
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve))
  const port = probe.address().port, base = `http://127.0.0.1:${port}`
  await new Promise(resolve => probe.close(resolve))
  const start = () => spawn(process.execPath, ['server/index.mjs'], { cwd: path.resolve(import.meta.dirname, '..'), windowsHide: true, stdio: 'ignore', env: {
    ...process.env, MNP_DATA_DIR: directory, MNP_API_HOST: '127.0.0.1', MNP_API_PORT: String(port), MNP_WEB_PORT: String(port),
    MNP_WORKSPACE_POOL_REGISTRY: path.join(directory, 'no-pool.json'), MNP_PUBLIC_VIEWER_ENABLED: 'true',
    MNP_ADMIN_EMAIL: 'dialog-admin@mind.local', MNP_ADMIN_PASSWORD: 'dialog-test-password',
  } })
  let server = start()
  const stop = async () => { if (server.exitCode === null) { const done = new Promise(resolve => server.once('exit', resolve)); server.kill(); await done } }
  const ready = async () => {
    for (let i = 0; i < 150; i++) { try { if ((await fetch(base + '/api/health')).ok) return } catch {} await new Promise(resolve => setTimeout(resolve, 100)) }
    throw Error('접힘 상태 테스트 서버 시작 실패')
  }
  const login = async (email = 'dialog-admin@mind.local') => {
    const response = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'dialog-test-password' }) })
    assert.equal(response.status, 200)
    return response.headers.get('set-cookie').split(';')[0]
  }
  const route = '/api/integrations/aionui/dialog-preferences'
  const api = async (cookie, body, method = body ? 'PATCH' : 'GET') => {
    const response = await fetch(base + route, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    return { status: response.status, body: await response.json() }
  }
  try {
    await ready()
    assert.equal((await api('')).status, 401)
    const token = (await readFile(path.join(directory, '_integration-token'), 'utf8')).trim()
    assert.equal((await fetch(base + route, { headers: { Authorization: `Bearer ${token}`, 'X-MNP-Editor-Id': 'user-admin' } })).status, 401)
    const viewer = await fetch(base + '/api/auth/viewer-access', { method: 'POST' })
    assert.equal((await api(viewer.headers.get('set-cookie').split(';')[0])).status, 403)
    const firstSession = await login(), secondSession = await login()
    const original = (await api(firstSession)).body
    assert.deepEqual(original.sections, { workspace: true, mcp: true, skills: true })
    const save = (sections, extra = {}) => api(firstSession, { expectedUserId: original.userId, sections, ...extra })
    for (const invalid of [null, {}, [], { workspace: 'false' }, { other: false }]) assert.equal((await save(invalid)).status, 400)
    assert.equal((await save({ workspace: false }, { expectedUserId: 'another-account' })).status, 409)
    assert.equal((await save({ workspace: false }, { userId: 'another-account' })).status, 400)
    assert.equal((await api(firstSession, undefined, 'DELETE')).status, 405)
    const updates = await Promise.all([save({ workspace: false }), save({ mcp: false }), save({ skills: false })])
    assert.ok(updates.every(result => result.status === 200))
    assert.deepEqual((await api(secondSession)).body.sections, { workspace: false, mcp: false, skills: false })
    const editor = await fetch(base + '/api/admin/editors', { method: 'POST', headers: { Cookie: firstSession, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '별도 편집자', email: 'dialog-editor@mind.local', password: 'dialog-test-password' }) })
    assert.equal(editor.status, 201)
    assert.deepEqual((await api(await login('dialog-editor@mind.local'))).body.sections, original.sections)
    await stop(); server = start(); await ready()
    assert.deepEqual((await api(await login())).body.sections, { workspace: false, mcp: false, skills: false })
  } finally {
    await stop()
    assert.equal(path.dirname(directory), tmpdir())
    assert.ok(path.basename(directory).startsWith('mnp-dialog-preferences-api-'))
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
})
