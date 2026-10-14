import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const projectDirectory = path.resolve(import.meta.dirname, '..')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

test('레거시 접수 실패를 실제 재접수에 연결하고 실패 원문·위임·카드 및 재시작 후 이력을 보존한다', { timeout: 45_000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'mnp-request-failure-'))
  const probe = createServer()
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve))
  const port = probe.address().port
  await new Promise(resolve => probe.close(resolve))
  const baseUrl = `http://127.0.0.1:${port}`
  let child
  let errors = ''
  async function stop() {
    if (!child || child.exitCode !== null) return
    const exited = new Promise(resolve => child.once('exit', resolve))
    child.kill()
    await exited
    child = null
  }
  async function start() {
    child = spawn(process.execPath, ['server/index.mjs'], { cwd: projectDirectory, env: {
      ...process.env, MNP_DATA_DIR: directory, MNP_API_HOST: '127.0.0.1',
      MNP_API_PORT: String(port), MNP_WEB_PORT: String(port),
      MNP_AIONUI_URL: `http://127.0.0.1:${port}`, MNP_AI_DELEGATION_POLL_INTERVAL_MS: '60000',
      MNP_WORKSPACE_POOL_REGISTRY: path.join(directory, 'no-workspace-pool.json'),
      MNP_ADMIN_EMAIL: 'request-test@mind.local', MNP_ADMIN_PASSWORD: 'RequestTest!2026',
    }, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    child.stderr.on('data', chunk => { errors += chunk })
    for (let attempt = 0; attempt < 100; attempt++) {
      try { if ((await fetch(baseUrl + '/api/health')).ok) return } catch { /* 격리 서버 시작 대기 */ }
      await pause(100)
    }
    throw new Error(`격리 서버 시작 실패: ${errors}`)
  }
  async function login() {
    const response = await fetch(baseUrl + '/api/auth/login', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'request-test@mind.local', password: 'RequestTest!2026' }) })
    assert.equal(response.status, 200)
    return response.headers.get('set-cookie').split(';')[0]
  }
  async function api(cookie, pathname, method = 'GET', body) {
    const response = await fetch(baseUrl + pathname, { method,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) })
    return { status: response.status, body: await response.json() }
  }
  try {
    await start()
    let cookie = await login()
    const created = await api(cookie, '/api/maps', 'POST', { title: '접수 실패 연결 격리 검증', map: {
      nodes: [
        { id: 'root', type: 'mind', position: { x: 0, y: 0 }, data: { label: '상위', description: '', kind: 'root', isWork: false, progress: 0, status: 'planned' } },
        { id: 'task', type: 'mind', position: { x: 300, y: 0 }, data: { label: '대상', description: '사용자 원문', kind: 'task', isWork: true, progress: 100, status: 'done' } },
      ], edges: [],
    } })
    assert.equal(created.status, 201)
    const mapId = created.body.map.id
    const machineId = (await api(cookie, '/api/machines')).body.mainMachineId
    assert.ok(machineId)
    const originalFailure = { id: 'request-old', kind: 'request-failure', state: 'request-failed',
      requestedDelegationId: 'rev1-task', requestSignature: 'revision-1', parentMapId: mapId, mapId,
      parentCardId: 'root', targetCardId: 'task', targetHomeMachineId: machineId, phase: 'preflight',
      accepted: false, executionState: 'not-started', automaticRetry: false, status: 409,
      reasonCode: 'AI_DELEGATION_VERSION_CONFLICT', message: '최신 문서 버전 재조회 필요',
      createdAt: '2026-10-13T00:00:00.000Z', updatedAt: '2026-10-13T00:00:00.000Z' }
    const accepted = { id: 'rev2-task', requestSignature: 'revision-2', mapId, parentCardId: 'root', targetCardId: 'task',
      parentConversationId: 'parent-conversation', targetConversationId: 'child-conversation',
      targetHomeMachineId: machineId, state: 'completed', createdAt: '2026-10-13T00:01:00.000Z', updatedAt: '2026-10-13T00:01:00.000Z',
      childStatus: 'completed', parentDispatchState: 'completed', reportReceipt: { at: '2026-10-13T00:02:00.000Z' } }
    await stop()
    await writeFile(path.join(directory, '_ai-delegations.json'), JSON.stringify([accepted]), 'utf8')
    await writeFile(path.join(directory, '_ai-delegation-request-failures.json'), JSON.stringify([
      originalFailure, { ...originalFailure, id: 'request-unknown', phase: 'dispatch', executionState: 'unknown' },
    ]), 'utf8')
    await start()
    cookie = await login()
    const beforeMap = (await api(cookie, `/api/maps/${mapId}`)).body.map
    const delegationBefore = await readFile(path.join(directory, '_ai-delegations.json'), 'utf8')
    const endpoint = `/api/maps/${mapId}/ai-delegation-request-failures/request-old/resolve`
    const body = { expectedUpdatedAt: originalFailure.updatedAt, replacementDelegationId: accepted.id,
      confirmSameWork: true, note: '동일 업무의 정상 재접수 확인' }
    assert.equal((await api(null, endpoint, 'POST', body)).status, 401)
    assert.equal((await api(cookie, endpoint, 'POST', { ...body, expectedUpdatedAt: 'stale' })).status, 409)
    assert.equal((await api(cookie, endpoint, 'POST', { ...body, confirmSameWork: false })).status, 400)
    assert.equal((await api(cookie, endpoint, 'POST', { ...body, replacementDelegationId: 'missing' })).status, 409)
    const unknown = await api(cookie, `/api/maps/${mapId}/ai-delegation-request-failures/request-unknown/resolve`, 'POST', body)
    assert.equal(unknown.status, 409)
    assert.equal(unknown.body.reasonCode, 'AI_DELEGATION_REQUEST_FAILURE_EXECUTION_UNCERTAIN')
    const result = await api(cookie, endpoint, 'POST', body)
    assert.equal(result.status, 200, JSON.stringify(result.body))
    assert.equal(result.body.reasonCode, 'AI_DELEGATION_REQUEST_FAILURE_RESOLVED')
    assert.equal(result.body.executionRequested, false)
    assert.equal(result.body.cardChanged, false)
    assert.equal(result.body.requestFailure.resolvedByDelegationId, accepted.id)
    assert.equal((await api(cookie, endpoint, 'POST', body)).body.repeated, true)
    assert.deepEqual((await api(cookie, `/api/maps/${mapId}`)).body.map, beforeMap)
    assert.equal(await readFile(path.join(directory, '_ai-delegations.json'), 'utf8'), delegationBefore)
    const stored = JSON.parse(await readFile(path.join(directory, '_ai-delegation-request-failures.json'), 'utf8'))
    const updated = stored.find(item => item.id === originalFailure.id)
    assert.deepEqual({ ...updated, updatedAt: originalFailure.updatedAt, resolution: undefined }, { ...originalFailure, resolution: undefined })
    await stop()
    await start()
    cookie = await login()
    const history = (await api(cookie, `/api/maps/${mapId}/ai-delegations`)).body.requestFailures
    assert.equal(history.find(item => item.id === originalFailure.id).resolvedByDelegationId, accepted.id)
    assert.equal(history.find(item => item.id === 'request-unknown').resolvedByDelegationId, null)
  } finally {
    await stop()
    // mkdtemp가 반환한 이번 테스트의 전용 경로만 정리한다.
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()))
    assert.ok(path.basename(directory).startsWith('mnp-request-failure-'))
    await rm(directory, { recursive: true, force: true })
  }
})
