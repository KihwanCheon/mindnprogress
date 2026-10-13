import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { aiDelegationRecoveryAvailability, aiDelegationLimitState, aiDelegationStateReason,
  retryableAiExecutionFailureCategory } from '../server/lib/aiDelegations.mjs'
import { assertAiDelegationInterruptedLease, readAiDelegationInterruptedProof,
  verifyAiDelegationInterruptedHistory } from '../server/lib/aiDelegationInterruptedRecovery.mjs'
import { originalDelegationMessage } from './helpers/aiDelegationOriginalMessage.mjs'
import { WorkspacePoolManager } from '../server/lib/workspacePool.mjs'
import { RemoteWorkspacePool } from '../server/lib/remoteWorkspacePool.mjs'

const error = 'stream disconnected before completion: An error occurred while processing your request. You can retry your request.'
function fixture() {
  const startedAt = '2026-10-12T14:18:16.606Z'
  const lease = { workspaceId: 'worker', leaseId: 'lease-a', jobId: 'job-a', projectRoot: 'C:/test/worker',
    branch: 'mnp/job-a', baseCommit: 'a'.repeat(40), startedAt, mapId: 'map-a', cardId: 'card-a', conversationId: 'chat-a' }
  const instruction = '승인된 작업만 진행하고 기존 결과를 보존하세요.'
  const delegation = { id: 'request-a', childOperationId: 'request-a', childTurnId: 'turn-a', childStatus: 'failed',
    strategy: 'resume', state: 'parent-wake-failed', mapId: 'map-a', targetCardId: 'card-a', targetConversationId: 'chat-a',
    startedBy: 'editor-a', createdAt: '2026-10-12T14:18:06Z', workspaceLease: lease,
    pendingInstruction: instruction, instructionHash: createHash('sha256').update(instruction).digest('hex'),
    workspaceResult: { ...lease, childStatus: 'failed', childError: error, status: 'quarantined', unmergedFiles: [] } }
  const message = { ...originalDelegationMessage(delegation), conversation_id: 'chat-a', status: 'finish' }
  delete delegation.pendingInstruction
  const origin = { conversationId: 'chat-a', mapId: 'map-a', cardId: 'card-a', startedBy: 'editor-a' }
  const conversation = { id: 'chat-a', created_at: Date.parse(startedAt) - 86_400_000, extra: { workspace: lease.projectRoot },
    runtime: { state: 'idle', is_processing: false, has_task: false, pending_confirmations: 0, task_status: null, turn_id: null } }
  const manual = { id: 'manual-result', conversation_id: 'chat-a', type: 'text', position: 'left', status: 'finish',
    created_at: message.created_at + 3_600_000, content: 'RESULT은 아직 미커밋입니다.' }
  const pages = [{ items: [message, manual], has_more_before: false, has_more_after: false,
    oldest_cursor: 'oldest-a', newest_cursor: 'newest-a' }]
  const dispatch = { operationId: 'request-a', conversationId: 'chat-a', turnId: 'turn-a', state: 'failed',
    workspaceLease: lease, errorMessage: error }
  return { delegation, origin, conversation, message, pages, dispatch }
}

test('연결 중단은 수동 복구 후보이며 모델·사용량 대기나 업무 완료로 처리하지 않는다', () => {
  const { delegation } = fixture()
  assert.equal(retryableAiExecutionFailureCategory(error), 'upstream-interrupted')
  assert.equal(aiDelegationRecoveryAvailability(delegation).recoveryAvailable, true)
  assert.equal(aiDelegationRecoveryAvailability(delegation).failureCategory, 'upstream-interrupted')
  assert.equal(aiDelegationLimitState(delegation), null)
  assert.match(aiDelegationStateReason(delegation).message, /하위 AI 실행이 중단/)
  const integrationFailed = { ...delegation, childStatus: 'completed', workspaceResult: {
    ...delegation.workspaceResult, childStatus: 'completed', childError: null, integrationBranch: 'integration-a' } }
  assert.match(aiDelegationStateReason(integrationFailed).message, /필요한 통합을 완료하지 못/)
  for (const text of ['컴파일 실패', 'network error', 'You can retry your request.', `테스트 로그: ${error}`]) {
    assert.equal(retryableAiExecutionFailureCategory(text), null)
  }
  assert.equal(retryableAiExecutionFailureCategory('usage limit exceeded'), 'usage-limit')
})

test('resume 원 전문과 내구 hash로 같은 job을 확인하며 최신 수동 결과를 완료 증거로 만들지 않는다', () => {
  const f = fixture()
  const proof = verifyAiDelegationInterruptedHistory(f.delegation, f.origin, f.conversation, f.pages)
  assert.equal(proof.originalRequest.messageId, f.message.id)
  assert.equal(proof.observedTurnId, 'turn-a')
  assert.equal(proof.state, undefined)
  assert.equal(proof.result, undefined)
  assert.equal(JSON.stringify(proof).includes('승인된 작업만'), false)
  assertAiDelegationInterruptedLease({ ...f.delegation.workspaceLease, status: 'quarantined', result: f.delegation.workspaceResult },
    proof, { mapId: 'map-a', cardId: 'card-a', conversationId: 'chat-a' })
})

for (const [label, mutate] of [
  ['다른 origin 카드', f => { f.origin.cardId = 'other' }],
  ['다른 origin 계정', f => { f.origin.startedBy = 'other' }],
  ['변경된 지시', f => { f.message.content.content += '\n추가 변경' }],
  ['다른 브랜치', f => { f.message.content.content = f.message.content.content.replace('mnp/job-a', 'mnp/other') }],
  ['다른 기준 커밋', f => { f.message.content.content = f.message.content.content.replace('a'.repeat(40), 'b'.repeat(40)) }],
  ['다른 lease', f => { f.message.content.content = f.message.content.content.replace('lease-a', 'lease-other') }],
  ['이전 job의 전문', f => { f.message.created_at -= 86_400_000 }],
  ['늦은 복사본 전문', f => { f.message.created_at += 300_000 }],
  ['AI가 인용한 전문', f => { f.message.position = 'left' }],
  ['중복 전문', f => { f.pages[0].items.push({ ...f.message, id: 'copied-request' }) }],
  ['중복 헤더', f => { f.message.content.content = f.message.content.content.replace('- cardId: `card-a`', '- cardId: `card-a`\n- cardId: `card-a`') }],
  ['불완전 페이지', f => { f.pages[0].has_more_before = true }],
  ['축약된 메시지', f => { f.message.truncated = true }],
  ['다른 대화 메시지', f => { f.message.conversation_id = 'other' }],
  ['실행 중인 대화', f => { f.conversation.runtime.state = 'running' }],
  ['다른 실제 작업공간', f => { f.conversation.extra.workspace = 'C:/other' }],
  ['성공한 실행', f => { f.delegation.childStatus = 'completed' }],
  ['이미 통합 시작', f => { f.delegation.workspaceResult.integrationBranch = 'integration-a' }],
  ['결과 scope 불일치', f => { f.delegation.workspaceResult.cardId = 'other' }],
  ['만료된 후속 복구 실행', f => { f.delegation.recoveryAttempt = 1 }],
]) test(`연결 중단 만료 증거 거부: ${label}`, () => {
  const f = fixture(); mutate(f)
  assert.throws(() => verifyAiDelegationInterruptedHistory(f.delegation, f.origin, f.conversation, f.pages),
    { code: 'AI_DELEGATION_INTERRUPTED_SOURCE_UNCONFIRMED' })
})

test('pool은 임의 category만으로 격리를 해제하지 않으며 다른 실패·소유권도 거부한다', () => {
  const f = fixture(), scope = { mapId: 'map-a', cardId: 'card-a', conversationId: 'chat-a' }
  const lease = { ...f.delegation.workspaceLease, status: 'quarantined', result: f.delegation.workspaceResult }
  const proof = verifyAiDelegationInterruptedHistory(f.delegation, f.origin, f.conversation, f.pages)
  for (const [candidate, evidence, target] of [
    [lease, undefined, scope], [lease, proof, { ...scope, cardId: 'other' }],
    [{ ...lease, result: { ...lease.result, childError: '실제 구현 실패' } }, proof, scope],
    [{ ...lease, jobId: 'other' }, proof, scope],
  ]) assert.throws(() => assertAiDelegationInterruptedLease(candidate, evidence, target))
  assertAiDelegationInterruptedLease({ ...lease, status: 'leased', result: null,
    recoveryHistory: [{ previousResult: lease.result, interruptedProof: proof }] }, proof, scope)
})

function fakeFetch(f, { expired = true, code = 'EXTERNAL_DISPATCH_NOT_FOUND', changeHistory = false } = {}) {
  const calls = []; let pageReads = 0
  const fetchOn = async (_machine, pathname) => {
    calls.push(pathname)
    if (pathname.includes('external-conversation-dispatches')) {
      if (!expired) return structuredClone(f.dispatch)
      throw Object.assign(new Error('missing'), { status: 404, code })
    }
    if (pathname.includes('/messages?')) {
      const url = new URL(pathname, 'http://test')
      assert.equal(url.searchParams.get('limit'), '100')
      assert.equal(url.searchParams.get('content_mode'), 'full')
      assert.equal(url.searchParams.has('before'), false)
      const page = structuredClone(f.pages[0])
      if (changeHistory && ++pageReads > 1) page.items[0].content.content += '\n変更'
      return page
    }
    return structuredClone(f.conversation)
  }
  return { fetchOn, calls }
}

test('명시적 operation 만료만 원문 fallback을 허용하고 원문 변경은 거절한다', async () => {
  const f = fixture(), args = { machineId: 'main', delegation: f.delegation, origin: f.origin }
  const valid = fakeFetch(f)
  assert.equal((await readAiDelegationInterruptedProof(valid.fetchOn, args)).originalRequest.messageId, f.message.id)
  assert.equal(valid.calls.filter(p => p.includes('/messages?')).length, 2)
  const generic404 = fakeFetch(f, { code: 'NOT_FOUND' })
  await assert.rejects(() => readAiDelegationInterruptedProof(generic404.fetchOn, args))
  assert.equal(generic404.calls.some(p => p.includes('/messages?')), false)
  await assert.rejects(() => readAiDelegationInterruptedProof(fakeFetch(f, { changeHistory: true }).fetchOn, args),
    { proofHoldReason: 'history-changed-during-proof' })
})

test('원 dispatch가 남아 있으면 실제 실패 턴·대화·lease·오류를 확인하고 이력으로 우회하지 않는다', async () => {
  const f = fixture(), args = { machineId: 'main', delegation: f.delegation, origin: f.origin }
  assert.equal((await readAiDelegationInterruptedProof(fakeFetch(f, { expired: false }).fetchOn, args)).kind,
    'interrupted-original-operation-v1')
  for (const patch of [{ turnId: 'other' }, { state: 'running' }, { errorMessage: '컴파일 실패' },
    { workspaceLease: { ...f.dispatch.workspaceLease, leaseId: 'other' } }]) {
    const changed = { ...f, dispatch: { ...f.dispatch, ...patch } }, mock = fakeFetch(changed, { expired: false })
    await assert.rejects(() => readAiDelegationInterruptedProof(mock.fetchOn, args))
    assert.equal(mock.calls.some(p => p.includes('/messages?')), false)
  }
})

test('여러 페이지의 원문을 before cursor로 끝까지 조회·재검증하며 부분 이력은 거부한다', async () => {
  const f = fixture(), cursors = []
  f.pages = [{ items: Array.from({ length: 100 }, (_, index) => ({
    ...f.pages[0].items[1], id: `later-${index}`, created_at: f.message.created_at + 1000 + index,
  })), has_more_before: true, has_more_after: false, oldest_cursor: 'page-a', newest_cursor: 'latest' },
  { items: [f.message], has_more_before: false, has_more_after: true, oldest_cursor: 'page-b', newest_cursor: 'request' }]
  const fetchOn = async (_machine, pathname) => {
    if (pathname.includes('external-conversation-dispatches')) throw Object.assign(new Error('expired'),
      { status: 404, code: 'EXTERNAL_DISPATCH_NOT_FOUND' })
    if (!pathname.includes('/messages?')) return structuredClone(f.conversation)
    const before = new URL(pathname, 'http://test').searchParams.get('before')
    cursors.push(before)
    return structuredClone(f.pages[before ? 1 : 0])
  }
  const proof = await readAiDelegationInterruptedProof(fetchOn, { machineId: 'main', delegation: f.delegation, origin: f.origin })
  assert.equal(proof.originalRequest.messageId, f.message.id)
  assert.deepEqual(cursors, [null, 'page-a', null, 'page-a'])
  f.pages[0].items.pop()
  assert.throws(() => verifyAiDelegationInterruptedHistory(f.delegation, f.origin, f.conversation, f.pages),
    { proofHoldReason: 'history-incomplete' })
})

test('pool 재활성화는 dirty 결과·체크포인트를 보존하고 증거 없는 요청은 Git 조회 전 거부한다', async t => {
  // Git 프로세스 실행 없이 실제 manager의 세션·소유권·HEAD 검사 및 저장 경로를 검증한다.
  const root = await mkdtemp(path.join(tmpdir(), 'mnp-interrupted-pool-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const f = fixture(), lease = f.delegation.workspaceLease
  lease.projectRoot = root
  f.conversation.extra.workspace = root
  f.message.content.content = f.message.content.content.replace('C:/test/worker', root)
  const head = 'b'.repeat(40), checkpoint = { commit: head, paths: ['result.md'] }
  const current = { ...lease, status: 'quarantined', result: f.delegation.workspaceResult,
    headCommit: head, checkpoints: [checkpoint] }
  const scope = { mapId: 'map-a', cardId: 'card-a', conversationId: 'chat-a' }
  const proof = verifyAiDelegationInterruptedHistory(f.delegation, f.origin, f.conversation, f.pages)
  const calls = []
  const gitRunner = async (_root, args) => {
    calls.push(args)
    if (args[0] === 'status') return '?? result.md\0'
    if (args[0] === 'branch') return lease.branch
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') return head
    if (args[0] === 'rev-parse' && args[1] === '--git-path') return path.join(root, args[2])
    if (args[0] === 'diff' || args[0] === 'merge-base') return ''
    throw new Error(`예상하지 않은 Git 호출: ${args.join(' ')}`)
  }
  const manager = new WorkspacePoolManager({ registryFile: path.join(root, 'registry.json'),
    stateFile: path.join(root, 'state.json'), gitRunner })
  manager.registry = { workspaces: [{ id: lease.workspaceId, root, role: 'worker', enabled: true }] }
  manager.state = { leases: { [lease.leaseId]: current }, workspaces: {
    [lease.workspaceId]: { status: 'quarantined', leaseId: lease.leaseId } } }
  await writeFile(path.join(root, '.ai-session.json'), JSON.stringify(lease))
  await writeFile(path.join(root, 'result.md'), '보존할 RESULT\n')
  await assert.rejects(() => manager.reactivateQuarantinedLease(lease.leaseId, { ...scope, failureCategory: 'upstream-interrupted' }))
  assert.equal(calls.length, 0)
  current.headCommit = 'c'.repeat(40)
  await assert.rejects(() => manager.reactivateQuarantinedLease(lease.leaseId, {
    ...scope, failureCategory: 'upstream-interrupted', interruptedProof: proof }), { reasonCode: 'QUARANTINED_LEASE_HEAD_MISMATCH' })
  assert.equal(current.status, 'quarantined')
  current.headCommit = head
  const restored = await manager.reactivateQuarantinedLease(lease.leaseId, {
    ...scope, failureCategory: 'upstream-interrupted', interruptedProof: proof })
  assert.equal(restored.leaseId, lease.leaseId)
  assert.equal(current.status, 'leased')
  assert.deepEqual(current.checkpoints, [checkpoint])
  assert.equal(current.recoveryHistory[0].uncommittedChangesPreserved, true)
  assert.deepEqual(current.recoveryHistory[0].previousResult, f.delegation.workspaceResult)
  assert.equal(await readFile(path.join(root, 'result.md'), 'utf8'), '보존할 RESULT\n')
  assert.equal(calls.some(args => ['add', 'commit', 'checkout', 'switch', 'reset', 'clean'].includes(args[0])), false)
})

test('원격 lease도 실제 소유권 증거가 필요하며 저장 직전 재시도의 원 실패 결과를 보존한다', async () => {
  const f = fixture(), lease = f.delegation.workspaceLease
  lease.ownership = { coordinatorId: 'coordinator-a', machineId: 'mac-a', poolId: 'pool-a', generation: 1 }
  const proof = await readAiDelegationInterruptedProof(fakeFetch(f, { expired: false }).fetchOn,
    { machineId: 'mac-a', delegation: f.delegation, origin: f.origin })
  const pool = new RemoteWorkspacePool({ stateFile: path.join(tmpdir(), 'unused-mnp-interrupted-state.json') })
  const current = { ...lease, status: 'quarantined', result: f.delegation.workspaceResult }
  pool.state = { leases: { [lease.leaseId]: current } }
  const commands = []
  pool.command = async (...args) => { commands.push(args) }
  pool.persist = async () => {}
  const options = { mapId: 'map-a', cardId: 'card-a', conversationId: 'chat-a', failureCategory: 'upstream-interrupted', interruptedProof: proof }
  await assert.rejects(() => pool.reactivateQuarantinedLease(lease.leaseId, { ...options, interruptedProof: {
    ...proof, workspaceLease: { ...lease, ownership: { ...lease.ownership, generation: 2 } } } }))
  assert.equal(commands.length, 0)
  await pool.reactivateQuarantinedLease(lease.leaseId, options)
  await pool.reactivateQuarantinedLease(lease.leaseId, options)
  assert.equal(current.recoveryHistory.length, 1)
  assert.deepEqual(current.recoveryHistory[0].previousResult, f.delegation.workspaceResult)
  assert.equal(current.status, 'leased')
})
