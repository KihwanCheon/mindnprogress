import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const listen = async server => { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return server.address().port }
test('통합 복구 HTTP는 긴 검증 전에 내구 접수를 반환하고 재시작·응답 유실도 같은 요청으로 확인한다', { timeout: 90000 }, async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'mnp-integration-async-api-')), data = path.join(root, 'data')
  await mkdir(data)
  const originalResult = { status: 'quarantined', childStatus: 'completed', branch: 'source', headCommit: 'b'.repeat(40),
    integrationBranch: 'integration', integrationBaseCommit: 'a'.repeat(40), integrationHeadCommit: 'c'.repeat(40),
    integratedCommit: null, error: '통합 직전에 통합 작업공간의 HEAD가 변경되었습니다.' }
  const now = new Date().toISOString(), text = '기존 완료 결과'
  const delegation = { id: 'test-async', mapId: 'map-test', parentCardId: 'parent', targetCardId: 'target',
    parentConversationId: 'parent-chat', targetConversationId: 'target-chat', state: 'failed', childStatus: 'completed',
    childOperationId: 'original-operation', childTurnId: 'original-turn', childResultTurnId: 'original-turn',
    childResultSnapshot: text, childResultHash: createHash('sha256').update(text).digest('hex'),
    workspaceLease: { leaseId: 'lease-test' }, workspaceResult: originalResult, startedBy: 'user-admin', createdAt: now, updatedAt: now }
  await writeFile(path.join(data, '_ai-delegations.json'), JSON.stringify([delegation]))
  const map = { id: 'map-test', title: '격리 API 검증', version: 1, nodes: [
    { id: 'parent', position: { x: 0, y: 0 }, data: { kind: 'root', label: '상위', aiConversationId: 'parent-chat' } },
    { id: 'target', position: { x: 300, y: 0 }, data: { kind: 'task', label: '대상', aiConversationId: 'target-chat' } },
  ], edges: [{ id: 'edge', source: 'parent', target: 'target' }] }
  await writeFile(path.join(data, 'map-test.json'), JSON.stringify(map))
  const paused = [], posts = []
  const upstream = createServer((request, response) => {
    const send = value => { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ success: true, data: value })) }
    if (request.method === 'POST') posts.push(request.url)
    if (request.url === '/api/conversations/target-chat') { paused.push(() => { if (!response.destroyed) send({ id: 'target-chat', runtime: { state: 'idle' } }) }); return }
    if (request.url.endsWith('/capabilities')) return send({ workspaceLeaseVersion: 0 })
    if (request.url.endsWith('/active')) return send({ items: [] })
    response.writeHead(404); response.end('{}')
  })
  const upstreamPort = await listen(upstream), probe = createServer(), port = await listen(probe)
  await new Promise(resolve => probe.close(resolve))
  const base = `http://127.0.0.1:${port}`, repository = path.resolve(import.meta.dirname, '..')
  let child, output = ''
  const start = async () => {
    child = spawn(process.execPath, ['server/index.mjs'], { cwd: repository, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: {
      ...process.env, MNP_DATA_DIR: data, MNP_API_PORT: String(port), MNP_WEB_PORT: String(port), MNP_API_HOST: '127.0.0.1',
      MNP_AIONUI_URL: `http://127.0.0.1:${upstreamPort}`, MNP_WORKSPACE_POOL_REGISTRY: path.join(root, 'missing-registry.json'),
      MNP_AI_DELEGATION_POLL_INTERVAL_MS: '100', MNP_ADMIN_EMAIL: 'admin@async.test', MNP_ADMIN_PASSWORD: 'async-test-password',
    } })
    child.stdout.on('data', chunk => { output += chunk }); child.stderr.on('data', chunk => { output += chunk })
    for (let attempt = 0; attempt < 150; attempt++) {
      try { if ((await fetch(base + '/api/health')).ok) return } catch { /* 기동 대기 */ }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error(output)
  }
  const stop = async () => { if (child?.exitCode === null) { const exited = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exited } }
  t.after(async () => {
    await stop(); upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve))
    if (path.dirname(path.resolve(root)) !== path.resolve(tmpdir()) || !path.basename(root).startsWith('mnp-integration-async-api-')) throw new Error('격리 검증 폴더 경로 확인 실패')
    await rm(root, { recursive: true, force: true })
  })
  await start()
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@async.test', password: 'async-test-password', remember: true }) })
  assert.equal(login.status, 200)
  const headers = { Cookie: login.headers.get('set-cookie').split(';')[0], 'Content-Type': 'application/json' }
  const input = { recoveryRequestId: 'request-api-test', expectedUpdatedAt: now, sourceRevision: 1, targetRevision: 1, confirmApprovedScope: true, instruction: '완료 결과의 통합만 요청합니다.' }
  const endpoint = base + '/api/maps/map-test/ai-delegations/test-async/recover'
  const post = body => fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) })
  const response = await post(input)
  assert.equal(response.status, 202)
  const accepted = await response.json()
  assert.equal(accepted.recovery.status, 'queued')
  assert.equal(accepted.delegation.state, 'failed', '접수만으로 통합 성공·대기 상태를 만들지 않는다.')
  assert.equal(accepted.recovery.childReexecuted, false)
  assert.equal(accepted.delegation.integrationRecoveryRequest.authorization, undefined)
  assert.equal(JSON.parse(await readFile(path.join(data, '_ai-delegations.json'), 'utf8'))[0].integrationRecoveryRequest.requestId, input.recoveryRequestId)
  assert.equal((await post(input)).status, 202)
  assert.equal((await post({ ...input, instruction: '변경 지시' })).status, 409)
  assert.equal((await fetch(base + '/api/health')).status, 200)
  await stop()
  await start()
  const token = (await readFile(path.join(data, '_integration-token'), 'utf8')).trim()
  const readState = async () => {
    const result = await fetch(base + '/api/maps/map-test/ai-delegations', { headers: { Authorization: `Bearer ${token}` } })
    return (await result.json()).delegations.find(d => d.id === 'test-async')
  }
  let finished
  for (let attempt = 0; attempt < 100; attempt++) {
    for (const release of paused.splice(0)) release()
    finished = await readState()
    if (finished.integrationRecoveryRequest.status === 'failed') break
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.equal(finished.integrationRecoveryRequest.status, 'failed', output)
  assert.equal(finished.integrationRecoveryRequest.requestId, input.recoveryRequestId)
  assert.match(finished.integrationRecoveryRequest.message, /소유권/)
  assert.deepEqual(finished.workspaceResult, originalResult)
  assert.equal(finished.childTurnId, 'original-turn')
  assert.deepEqual(posts, [], '하위 실행·Core 변경 요청을 하지 않는다.')
  assert.deepEqual(JSON.parse(await readFile(path.join(data, 'map-test.json'), 'utf8')).nodes, map.nodes)
})
