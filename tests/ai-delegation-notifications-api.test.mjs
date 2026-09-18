import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const projectDirectory = path.resolve(import.meta.dirname, '..')
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const hash = (value) => createHash('sha256').update(value).digest('hex')
async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return server.address().port
}
async function stop(child) {
  if (!child || child.exitCode !== null) return
  const exited = new Promise((resolve) => child.once('exit', resolve))
  child.kill()
  await exited
}

test('하위 AI 작업이 완료되면 위임 시작 편집자에게 완료 알림을 한 번만 만들고 진행 중인 위임은 알리지 않는다', { timeout: 45_000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'mnp-delegation-notification-'))
  const removeDirectory = async () => {
    if (path.dirname(path.resolve(directory)) !== path.resolve(tmpdir()) || !path.basename(directory).startsWith('mnp-delegation-notification-')) throw new Error('테스트 임시 경로 검증 실패')
    await rm(directory, { recursive: true, force: true })
  }
  const reportMessages = new Map()
  const dispatchRequests = []
  const fake = createServer(async (request, response) => {
    const send = (data, status = 200) => {
      response.writeHead(status, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ success: status === 200, data }))
    }
    if (request.url === '/api/internal/external-conversation-dispatches/capabilities') return send({ historyOnlyReports: true })
    if (request.method === 'POST' && request.url?.endsWith('/external-reports')) {
      let body = ''
      for await (const chunk of request) body += chunk
      const input = JSON.parse(body)
      const messageId = `external-report-${hash(input.operationId)}`
      reportMessages.set(input.operationId, { content: input.content, messageId })
      return send({ operationId: input.operationId, conversationId: 'parent-chat', messageId, contentHash: hash(input.content), executionRequested: false })
    }
    if (request.url?.startsWith('/api/conversations/')) {
      const id = request.url.split('/')[3]
      // 상위 대화는 계속 실행 중이라 결과 전달이 시작되지 않는다. 완료 알림은 결과 전달과 무관하게 만들어져야 한다.
      const busy = id === 'parent-chat'
      return send({ id, type: 'acp', extra: {}, runtime: { state: busy ? 'running' : 'idle', is_processing: busy, turn_id: busy ? 'parent-turn' : null, pending_confirmations: 0 } })
    }
    if (request.method === 'POST' && request.url === '/api/internal/external-conversation-dispatches') {
      let body = ''
      for await (const chunk of request) body += chunk
      dispatchRequests.push(JSON.parse(body))
      return send({ operationId: 'unexpected', conversationId: 'parent-chat', state: 'running', turnId: 'unexpected-turn' })
    }
    if (request.url?.startsWith('/api/internal/external-conversation-dispatches/')) {
      // 진행 중인 하위 실행은 계속 running으로 관측된다.
      return send({ state: 'running', turnId: 'child-running-turn' })
    }
    return send({}, 404)
  })
  const fakePort = await listen(fake)
  const probe = createServer()
  const port = await listen(probe)
  await new Promise((resolve) => probe.close(resolve))
  const baseUrl = `http://127.0.0.1:${port}`
  let child
  let errors = ''
  let headers = {}
  async function start() {
    child = spawn(process.execPath, ['server/index.mjs'], { cwd: projectDirectory, env: {
      ...process.env, MNP_DATA_DIR: directory, MNP_API_HOST: '127.0.0.1',
      MNP_API_PORT: String(port), MNP_WEB_PORT: String(port),
      MNP_AIONUI_URL: `http://127.0.0.1:${fakePort}`, MNP_AI_DELEGATION_POLL_INTERVAL_MS: '100',
      MNP_WORKSPACE_POOL_REGISTRY: path.join(directory, 'no-pool.json'),
      MNP_ADMIN_EMAIL: 'notification-test@mind.local', MNP_ADMIN_PASSWORD: 'NotifyTest!2026',
    }, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    child.stderr.on('data', (chunk) => { errors += chunk })
    for (let attempt = 0; attempt < 100; attempt++) {
      try { if ((await fetch(baseUrl + '/api/health')).ok) return } catch { /* 테스트 서버 시작 대기 */ }
      await pause(50)
    }
    throw new Error(`테스트 서버 시작 실패: ${errors}`)
  }
  async function api(url, method = 'GET', body) {
    const response = await fetch(baseUrl + url, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) })
    return { status: response.status, body: await response.json() }
  }
  async function until(read, predicate) {
    for (let i = 0; i < 100; i++) {
      const value = await read()
      if (predicate(value)) return value
      await pause(50)
    }
    throw new Error(`상태 전환 대기 실패: ${errors}`)
  }
  const editorId = 'user-editor'
  await writeFile(path.join(directory, '_users.json'), JSON.stringify([{
    id: editorId, name: '위임 편집자', email: 'delegator@mind.local', role: 'editor', active: true,
    salt: '00', passwordHash: '00'.repeat(64),
  }]), 'utf8')
  try {
    await start()
    const token = (await readFile(path.join(directory, '_integration-token'), 'utf8')).trim()
    headers = { Authorization: `Bearer ${token}`, 'X-MNP-AI-Editor-Id': editorId, 'Content-Type': 'application/json' }
    const created = await api('/api/maps', 'POST', { title: '위임 알림 회귀', map: {
      nodes: [
        { id: 'parent-card', type: 'mind', position: { x: 0, y: 0 }, data: { label: '상위 기능', kind: 'root', aiConversationId: 'parent-chat', status: 'in-progress', progress: 50 } },
        { id: 'child-card', type: 'mind', position: { x: 300, y: 0 }, data: { label: '완료된 하위', kind: 'task', aiConversationId: 'child-done', status: 'done', progress: 100 } },
        { id: 'busy-card', type: 'mind', position: { x: 300, y: 200 }, data: { label: '진행 중 하위', kind: 'task', aiConversationId: 'child-busy', status: 'in-progress', progress: 30 } },
      ],
      edges: [{ id: 'edge-1', source: 'parent-card', target: 'child-card' }, { id: 'edge-2', source: 'parent-card', target: 'busy-card' }],
    } })
    assert.equal(created.status, 201, JSON.stringify(created.body))
    const mapId = created.body.map.id
    const base = {
      mapId, parentCardId: 'parent-card', parentCardLabel: '상위 기능', parentConversationId: 'parent-chat',
      startedBy: editorId, createdAt: '2026-09-18T01:00:00.000Z', updatedAt: '2026-09-18T01:00:00.000Z',
    }
    await stop(child)
    child = null
    await writeFile(path.join(directory, '_ai-delegations.json'), JSON.stringify([
      {
        ...base, id: 'delegation-done', state: 'waiting-parent',
        targetCardId: 'child-card', targetCardLabel: '완료된 하위', targetConversationId: 'child-done',
        childStatus: 'completed', childTurnId: 'child-finished', childResultTurnId: 'child-finished',
        childResultSnapshot: '검증된 하위 결과', childResultHash: hash('검증된 하위 결과'),
        workspaceLease: { leaseId: 'done-lease' }, workspaceResult: { status: 'completed' },
      },
      {
        ...base, id: 'delegation-busy', state: 'running', childOperationId: 'child-busy-operation',
        targetCardId: 'busy-card', targetCardLabel: '진행 중 하위', targetConversationId: 'child-busy',
      },
    ]), 'utf8')
    await writeFile(path.join(directory, '_ai-conversation-origins.json'), JSON.stringify([
      { conversationId: 'parent-chat', mapId, cardId: 'parent-card', startedBy: editorId, linkedAt: base.createdAt },
    ]), 'utf8')
    await start()

    const notifications = async () => (await api('/api/notifications')).body.notifications
    const completedNotifications = (items) => items.filter((item) => item.type === 'ai-delegation-completed')
    const first = await until(notifications, (items) => completedNotifications(items).length >= 1)
    const [notification] = completedNotifications(first)
    assert.equal(notification.userId, editorId, '위임을 시작한 편집자에게 알린다.')
    assert.equal(notification.mapId, mapId)
    assert.equal(notification.nodeId, 'child-card', '완료된 하위 카드를 가리킨다.')
    assert.equal(notification.nodeLabel, '완료된 하위')
    assert.equal(notification.actor.id, 'system')
    assert.equal(notification.readAt, null)
    assert.match(notification.message, /하위 AI 작업이 완료되었습니다/)
    assert.match(notification.message, /"상위 기능"/)
    assert.equal(first.some((item) => item.type === 'ai-delegation'), false, '완료는 차단 알림 타입으로 만들지 않는다.')

    // 여러 폴링 주기가 지나도 같은 위임의 완료 알림은 하나만 유지되고, 진행 중인 위임은 알리지 않는다.
    await pause(600)
    const settled = await notifications()
    assert.equal(completedNotifications(settled).length, 1, JSON.stringify(settled))
    assert.equal(settled.some((item) => item.nodeId === 'busy-card'), false)
    const delegations = (await api(`/api/maps/${mapId}/ai-delegations`)).body.delegations
    assert.equal(delegations.find((item) => item.id === 'delegation-done').state, 'waiting-parent', '상위 대화가 실행 중이면 결과 전달 전이지만 완료 알림은 만들어진다.')
    assert.equal(delegations.find((item) => item.id === 'delegation-busy').state, 'running')
    assert.equal(dispatchRequests.length, 0, '알림 생성이 상위 대화 실행을 요청하지 않는다.')

    const stored = JSON.parse(await readFile(path.join(directory, '_ai-delegations.json'), 'utf8'))
    const doneRecord = stored.find((item) => item.id === 'delegation-done')
    assert.equal(doneRecord.completedNotificationKey, 'ai-delegation-completed:delegation-done')
    assert.equal(doneRecord.completedNotificationId, notification.id)
    assert.equal(stored.find((item) => item.id === 'delegation-busy').completedNotificationKey, undefined)

    // 재시작 뒤에도 저장된 알림 키로 중복 생성을 막는다.
    await stop(child)
    child = null
    await start()
    await pause(600)
    assert.equal(completedNotifications(await notifications()).length, 1, '재시작 후에도 완료 알림을 다시 만들지 않는다.')
  } finally {
    await stop(child)
    await new Promise((resolve) => fake.close(resolve))
    await removeDirectory()
  }
})
