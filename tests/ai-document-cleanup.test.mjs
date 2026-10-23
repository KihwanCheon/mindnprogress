import assert from 'node:assert/strict'
import test from 'node:test'
import { aiDocumentDeletionBusy, createAiDocumentRecordMap, removeAiDocumentRecords } from '../server/lib/aiDocumentCleanup.mjs'

const deletedId = 'map-delete'
const retainedId = 'map-keep'
const idleStores = { delegations: [], instructions: [] }

test('문서 삭제는 대상·상위·지시 대상 기록을 지우되 같은 대화의 다른 문서 기록을 보존한다', () => {
  const deletedMapIds = new Set()
  const stores = [createAiDocumentRecordMap(deletedMapIds), createAiDocumentRecordMap(deletedMapIds)]
  const retained = { mapId: retainedId, conversationId: 'same-chat', detail: { value: '보존할 기록' } }
  stores[0].set('target', { mapId: deletedId, conversationId: 'same-chat' })
  stores[0].set('parent', { mapId: retainedId, parentMapId: deletedId })
  stores[0].set('keep', retained)
  stores[1].set('instruction', { mapId: retainedId, targetMapId: deletedId })
  stores[1].set('unscoped', { conversationId: 'same-chat' })

  removeAiDocumentRecords([deletedId], deletedMapIds, stores)

  assert.deepEqual([...stores[0]], [['keep', retained]])
  assert.deepEqual([...stores[1]], [['unscoped', { conversationId: 'same-chat' }]])
  assert.deepEqual([...deletedMapIds], [deletedId])
})

test('삭제 이후 늦게 도착한 응답은 어느 문서 귀속 필드로도 AI 기록을 되살릴 수 없다', () => {
  const deletedMapIds = new Set()
  const store = createAiDocumentRecordMap(deletedMapIds)
  const retained = { mapId: retainedId, conversationId: 'same-chat' }
  store.set('keep', retained)
  removeAiDocumentRecords(new Set([deletedId]), deletedMapIds, [store])

  for (const field of ['mapId', 'parentMapId', 'targetMapId']) {
    assert.equal(store.set(field, { [field]: deletedId }), store)
    store.set('keep', { [field]: deletedId, conversationId: 'same-chat' })
  }

  assert.deepEqual([...store], [['keep', retained]])
  assert.equal(store.set('new', { mapId: 'map-new' }).get('new').mapId, 'map-new')
})

test('교차 문서의 실행 중 위임과 전달 중 지시는 삭제를 막고 무관한 실행은 막지 않는다', () => {
  const running = { id: 'running', mapId: retainedId, parentMapId: deletedId, state: 'running' }
  assert.equal(aiDocumentDeletionBusy([deletedId], { ...idleStores, delegations: [running] }), true)
  assert.equal(aiDocumentDeletionBusy([retainedId], { ...idleStores, delegations: [running] }), true)
  assert.equal(aiDocumentDeletionBusy(['map-other'], { ...idleStores, delegations: [running] }), false)

  const instruction = { id: 'instruction', parentMapId: retainedId, targetMapId: deletedId, state: 'delivered', dispatchState: 'running' }
  assert.equal(aiDocumentDeletionBusy([deletedId], { ...idleStores, instructions: [instruction] }), true)
  assert.equal(aiDocumentDeletionBusy(['map-other'], { ...idleStores, instructions: [instruction] }), false)
})

test('표시 상태가 실패여도 진행 중인 복구와 비동기 전달 작업은 삭제를 막는다', () => {
  const failed = { id: 'failed', mapId: deletedId, state: 'failed' }
  for (const patch of [
    { integrationRecoveryRequest: { status: 'queued' } },
    { integrationRecoveryRequest: { status: 'checking' } },
    { pendingRecovery: { operationId: 'recovery-operation' } },
    { resultCorrection: { phase: 'preparing' } },
  ]) {
    assert.equal(aiDocumentDeletionBusy([deletedId], { ...idleStores, delegations: [{ ...failed, ...patch }] }), true)
  }
  assert.equal(aiDocumentDeletionBusy([deletedId], { ...idleStores, delegations: [failed], delegationBusy: id => id === failed.id }), true)
  assert.equal(aiDocumentDeletionBusy([deletedId], { ...idleStores,
    instructions: [{ id: 'sending', targetMapId: deletedId, state: 'pending' }], instructionBusy: id => id === 'sending' }), true)
})

test('하위 작업이 끝나도 상위 AI 보고가 시작·자원 대기·재개 대기·실행 중이면 양쪽 문서 삭제를 막는다', () => {
  for (const parentDispatchState of ['intent-recorded', 'starting', 'waiting_resource', 'waiting-resource', 'running', 'waiting_resume', 'waiting-resume']) {
    const delegation = { id: 'reporting', mapId: retainedId, parentMapId: deletedId,
      state: 'waking-parent', childStatus: 'completed', parentDispatchState }
    const stores = { ...idleStores, delegations: [delegation] }
    assert.equal(aiDocumentDeletionBusy([deletedId], stores), true, parentDispatchState)
    assert.equal(aiDocumentDeletionBusy([retainedId], stores), true, parentDispatchState)
    assert.equal(aiDocumentDeletionBusy(['map-unrelated'], stores), false, parentDispatchState)
  }
})

test('실패한 위임에서도 복구 또는 통합 대기 알림이 상위 AI에서 실행 중이면 삭제를 막는다', () => {
  for (const field of ['recoveryWakeState', 'integrationCleanWakeState']) {
    for (const state of ['starting', 'waiting_resource', 'waiting-resource', 'running', 'waiting_resume', 'waiting-resume']) {
      const delegation = { id: 'notifying', mapId: retainedId, parentMapId: deletedId, state: 'failed', [field]: state }
      assert.equal(aiDocumentDeletionBusy([deletedId], { ...idleStores, delegations: [delegation] }), true, `${field} / ${state}`)
    }
  }
})

test('상위 보고나 알림이 실패·미확인·종료된 기록은 실행 중으로 간주하지 않는다', () => {
  for (const dispatchState of ['failed', 'unknown', 'unavailable', 'completed', 'recovery_required', 'not-sent', null]) {
    const delegation = { id: 'stopped-report', mapId: deletedId, state: 'waking-parent',
      parentDispatchState: dispatchState, recoveryWakeState: dispatchState, integrationCleanWakeState: dispatchState }
    assert.equal(aiDocumentDeletionBusy([deletedId], { ...idleStores, delegations: [delegation] }), false, String(dispatchState))
  }
})

test('활성 작업공간은 문서 직접 귀속과 위임 lease 연결 어느 쪽으로도 삭제를 막는다', () => {
  const delegation = { id: 'failed', mapId: deletedId, state: 'failed', workspaceLease: { leaseId: 'linked' } }
  assert.equal(aiDocumentDeletionBusy([deletedId], { ...idleStores,
    leases: [{ leaseId: 'direct', mapId: deletedId, status: 'leased' }] }), true)
  assert.equal(aiDocumentDeletionBusy([deletedId], { ...idleStores, delegations: [delegation],
    leases: [{ leaseId: 'linked', status: 'finalizing' }] }), true)
  assert.equal(aiDocumentDeletionBusy([deletedId], { ...idleStores, delegations: [delegation],
    leases: [{ leaseId: 'unrelated', mapId: retainedId, status: 'leased' }] }), false)
})

test('실행이 멈춘 실패·복구 필요 기록과 종료·격리 작업공간은 문서 삭제를 막지 않는다', () => {
  for (const state of ['failed', 'recovery-required', 'parent-wake-failed', 'completed']) {
    for (const status of ['completed', 'cancelled', 'quarantined']) {
      assert.equal(aiDocumentDeletionBusy([deletedId], {
        delegations: [{ id: 'stopped', mapId: deletedId, state, workspaceLease: { leaseId: 'stopped-lease' } }],
        instructions: [{ id: 'failed-instruction', targetMapId: deletedId, state: 'failed' }],
        leases: [{ leaseId: 'stopped-lease', mapId: deletedId, status }],
      }), false, `${state} / ${status}`)
    }
  }
})
