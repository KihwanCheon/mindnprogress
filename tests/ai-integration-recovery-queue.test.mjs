import assert from 'node:assert/strict'
import test from 'node:test'
import { createIntegrationRecoveryQueue, integrationRecoveryPending, integrationRecoveryPublicView } from '../server/lib/aiIntegrationRecovery.mjs'
import { activeAiDelegationsForConversation, aiDelegationRecoveryAvailability, aiDelegationWorkPending } from '../server/lib/aiDelegations.mjs'
import { aiDelegationStatusByCard } from '../src/utils/aiDelegationStatus.mjs'
import { groupDelegationPresentation } from '../src/utils/groupOverview.mjs'

const body = { recoveryRequestId: 'request-123', expectedUpdatedAt: 'before', sourceRevision: 1, targetRevision: 1, confirmApprovedScope: true, instruction: '기존 완료 결과만 통합하세요.' }
const authorization = { editorId: 'editor', human: true, source: null }
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
function fixture(options = {}) {
  let current = { id: 'job', mapId: 'map', parentCardId: 'parent', targetCardId: 'target', targetConversationId: 'chat',
    state: 'failed', childStatus: 'completed', childTurnId: 'original-turn', childResultHash: 'original-hash',
    workspaceLease: { leaseId: 'original-lease' }, workspaceResult: { status: 'quarantined', childStatus: 'completed' }, updatedAt: 'before' }
  let calls = 0
  const get = () => current
  const save = async (_id, patch) => { current = { ...current, ...patch, updatedAt: 'after' }; return current }
  const configuration = { get, save, check: async () => {}, recover: async () => { calls++; return { status: 'waiting-integration' } },
    successPatch: (_d, result) => ({ state: 'waiting-integration', workspaceResult: result }), ...options }
  return { queue: createIntegrationRecoveryQueue(configuration), get, save, configuration, calls: () => calls }
}

test('긴 검증 전에 요청 ID를 저장하고 중복 요청·상태 조회는 같은 receipt를 사용한다', async () => {
  const barrier = deferred(), entered = deferred()
  const f = fixture({ check: async () => { entered.resolve(); await barrier.promise } })
  const receipt = await f.queue.accept('job', body, authorization, 'integration-head-changed')
  assert.equal(receipt.delegation.integrationRecoveryRequest.status, 'queued')
  assert.equal(f.calls(), 0)
  const run = f.queue.run('job'); await entered.promise
  assert.equal(f.get().integrationRecoveryRequest.status, 'checking')
  assert.equal(f.queue.run('job'), run)
  assert.equal((await f.queue.accept('job', body, authorization, 'integration-head-changed')).repeated, true)
  assert.equal(integrationRecoveryPending(f.get()), true)
  assert.equal(aiDelegationRecoveryAvailability(f.get()).recoveryAvailable, false)
  assert.equal(activeAiDelegationsForConversation([f.get()], { mapId: 'map', targetCardId: 'target', targetConversationId: 'chat' }).length, 1)
  assert.equal(aiDelegationWorkPending(f.get()), true)
  assert.equal(groupDelegationPresentation(f.get()).label, '통합 재시도 검증 중')
  assert.equal(aiDelegationStatusByCard([f.get()], 'map').parent.kind, 'active')
  const view = integrationRecoveryPublicView(f.get().integrationRecoveryRequest)
  assert.equal(view.requestId, body.recoveryRequestId)
  assert.equal(JSON.stringify(view).includes('editor'), false)
  assert.equal(JSON.stringify(view).includes('기존 완료 결과'), false)
  barrier.resolve(); await run
  assert.equal(f.calls(), 1)
  assert.equal(f.get().state, 'waiting-integration')
  assert.equal(f.get().integrationRecoveryRequest.status, 'accepted')
  assert.equal(f.get().childTurnId, 'original-turn')
  assert.equal(f.get().childResultHash, 'original-hash')
  assert.equal(f.queue.repeat('job', body, authorization).repeated, true)
})

test('검증 차단은 원 실패 결과를 바꾸지 않고 요청별 오류를 저장하며 자동 재시도하지 않는다', async () => {
  const f = fixture({ check: async () => { throw Object.assign(new Error('사용자 변경 보존'), { reasonCode: 'INTEGRATION_RECOVERY_UNSAFE' }) } })
  const original = f.get().workspaceResult
  await f.queue.accept('job', body, authorization, 'integration-head-changed'); await f.queue.run('job'); await f.queue.run('job')
  assert.equal(f.get().state, 'failed'); assert.equal(f.get().workspaceResult, original)
  assert.equal(f.calls(), 0)
  assert.equal(f.get().integrationRecoveryRequest.reasonCode, 'INTEGRATION_RECOVERY_UNSAFE')
  assert.match(f.get().integrationRecoveryRequest.message, /사용자 변경 보존/)
  assert.equal(f.queue.repeat('job', body, authorization).repeated, true)
  assert.throws(() => f.queue.repeat('job', { ...body, instruction: '다른 지시' }, authorization), /다른 요청/)
  const next = await f.queue.accept('job', { ...body, recoveryRequestId: 'new-request-456' }, authorization, 'integration-head-changed')
  assert.equal(next.repeated, false)
  assert.equal(next.delegation.integrationRecoveryRequestHistory[0].reasonCode, 'INTEGRATION_RECOVERY_UNSAFE')
})

test('Git 종료 코드 숫자는 공개 reasonCode로 사용하지 않는다', async () => {
  const f = fixture({ check: async () => { throw Object.assign(new Error('Git 저장소 오류'), { code: 128 }) } })
  await f.queue.accept('job', body, authorization, 'integration-head-changed')
  await f.queue.run('job')
  assert.equal(f.get().integrationRecoveryRequest.reasonCode, 'AI_DELEGATION_INTEGRATION_RECOVERY_FAILED')
  assert.match(f.get().integrationRecoveryRequest.message, /Git 저장소 오류/)
  assert.equal(f.calls(), 0)
})

test('재시작은 승인된 checking 요청만 이어 확인하고 중단 중 새 실패를 만들지 않는다', async () => {
  const f = fixture()
  await f.queue.accept('job', body, authorization, 'integration-head-changed')
  const interrupted = createIntegrationRecoveryQueue({ ...f.configuration, isStopping: () => true })
  await interrupted.run('job'); assert.equal(f.get().integrationRecoveryRequest.status, 'queued')
  const restarted = createIntegrationRecoveryQueue(f.configuration)
  await restarted.run('job')
  assert.equal(f.calls(), 1); assert.equal(f.get().integrationRecoveryRequest.requestId, body.recoveryRequestId)
  assert.equal(f.get().integrationRecoveryRequest.status, 'accepted')
})

test('접수 이후 원 결과 변경·저장 실패를 검증 완료나 새 실행으로 우회하지 않는다', async () => {
  const f = fixture(); await f.queue.accept('job', body, authorization, 'integration-head-changed')
  await f.save('job', { childResultHash: 'changed' }); await f.queue.run('job')
  assert.equal(f.calls(), 0); assert.equal(f.get().integrationRecoveryRequest.reasonCode, 'AI_DELEGATION_INTEGRATION_RECOVERY_STALE')
  const failed = fixture({ save: async () => { throw new Error('disk failure') } })
  await assert.rejects(failed.queue.accept('job', body, authorization, 'integration-head-changed'), /disk failure/)
  await failed.queue.run('job'); assert.equal(failed.calls(), 0)
})

test('pool 대기 저장 후 중단·위임 저장 실패는 같은 checking 요청으로 다시 대사한다', async () => {
  let stopped = false, applied = 0, storedResult
  const f = fixture({ isStopping: () => stopped, recover: async () => {
    storedResult ??= (++applied, { status: 'waiting-integration' })
    stopped = true
    return storedResult
  } })
  await f.queue.accept('job', body, authorization, 'integration-head-changed'); await f.queue.run('job')
  assert.equal(f.get().integrationRecoveryRequest.status, 'checking')
  stopped = false
  await createIntegrationRecoveryQueue({ ...f.configuration, isStopping: () => false, recover: async () => storedResult }).run('job')
  assert.equal(applied, 1); assert.equal(f.get().integrationRecoveryRequest.status, 'accepted')
  const failed = fixture()
  await failed.queue.accept('job', body, authorization, 'integration-head-changed')
  let failOnce = true
  const saving = createIntegrationRecoveryQueue({ ...failed.configuration, save: async (id, patch) => {
    if (patch.state === 'waiting-integration' && failOnce) { failOnce = false; throw new Error('disk failure') }
    return failed.save(id, patch)
  } })
  await assert.rejects(saving.run('job'), /disk failure/)
  assert.equal(failed.get().integrationRecoveryRequest.status, 'checking')
  await saving.run('job'); assert.equal(failed.get().integrationRecoveryRequest.status, 'accepted')
})

test('정규화한 메타 승인도 원 요청 ID 재확인과 필드 순서 변경을 같은 요청으로 처리한다', async () => {
  const f = fixture(), original = { mainCommit: 'a', path: 'Assets\\Guard.cs.meta', expectedSha256: 'b' }
  const input = { ...body, untrackedMetaRecovery: original }
  await f.queue.accept('job', input, authorization, 'integration-git-lock', { untrackedMetaRecovery: { ...original, path: 'Assets/Guard.cs.meta' } })
  assert.equal(f.get().integrationRecoveryRequest.untrackedMetaRecovery.path, 'Assets/Guard.cs.meta')
  assert.equal(f.queue.repeat('job', { ...input, untrackedMetaRecovery: { path: original.path, expectedSha256: 'b', mainCommit: 'a' } }, authorization).repeated, true)
})
