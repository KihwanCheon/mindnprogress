import assert from 'node:assert/strict'
import test from 'node:test'
import { aiDelegationCanBeSupersededBy, aiDelegationDatabaseDispatchRejected, aiDelegationDatabaseRecoveryCandidate,
  aiDelegationRecoveryAvailability, retryableAiExecutionFailureCategory, assertAiDelegationDatabaseRejection } from '../server/lib/aiDelegations.mjs'
import { completedReplacementDelegations } from '../src/utils/aiDelegationManagement.mjs'
const error = 'Internal error: Database error: error returned from database: (code: 1) cannot start a transaction within a transaction'
const lease = { workspaceId: 'worker', jobId: 'job', leaseId: 'lease', projectRoot: 'C:/test/worker', branch: 'branch', baseCommit: 'a'.repeat(40) }
function fixture() { return { id: 'operation', state: 'parent-wake-failed', mapId: 'map', parentCardId: 'root', targetCardId: 'api', targetConversationId: 'chat',
  childOperationId: 'operation', childTurnId: null, childStatus: 'failed', createdAt: '2026-10-13', workspaceLease: lease,
  workspaceResult: { ...lease, mapId: 'map', cardId: 'api', conversationId: 'chat', status: 'failed-clean', childStatus: 'failed', childError: error, headCommit: lease.baseCommit } } }

test('정확한 실행 전 DB 접수 오류만 무변경 반환을 확인하는 수동 복구 후보가 된다', () => {
  const d = fixture()
  assert.equal(retryableAiExecutionFailureCategory(error), 'dispatch-database-transient')
  assert.deepEqual(aiDelegationRecoveryAvailability(d), { failurePhase: 'dispatch', failureCategory: 'dispatch-database-transient',
    recoveryAvailable: true, recommendedAction: 'resume-existing', recoveryTool: 'mindnprogress_recover_ai_delegation' })
  for (const message of ['Database error', 'database is corrupt', '테스트 로그: ' + error, error + ' 다른 오류']) assert.equal(retryableAiExecutionFailureCategory(message), null)
  for (const patch of [{ childTurnId: 'started' }, { childStatus: 'completed' }, { workspaceLease: null },
    { workspaceResult: { ...d.workspaceResult, headCommit: 'b'.repeat(40) } }, { workspaceResult: { ...d.workspaceResult, status: 'quarantined' } },
    { workspaceResult: { ...d.workspaceResult, integrationBranch: 'integrating' } }]) assert.equal(aiDelegationDatabaseRecoveryCandidate({ ...d, ...patch }), false)
})

test('원 dispatch도 같은 ID·대화·오류와 실행 턴 없음으로 증명해야 하며 추정하지 않는다', () => {
  const dispatch = { operationId: 'operation', conversationId: 'chat', state: 'failed', turnId: null, errorMessage: error }
  assert.equal(aiDelegationDatabaseDispatchRejected(dispatch, 'chat', 'operation'), true)
  for (const patch of [{ operationId: 'other' }, { conversationId: 'other' }, { state: 'running' }, { turnId: 'started' }, { errorMessage: '일반 오류' }]) {
    assert.equal(aiDelegationDatabaseDispatchRejected({ ...dispatch, ...patch }, 'chat', 'operation'), false)
  }
})

test('이미 이어 완료한 같은 카드의 과거 무변경 DB 접수 실패만 사용자 확인으로 연결 종료할 수 있다', () => {
  const d = fixture(), next = { ...d, id: 'replacement', state: 'completed', createdAt: '2026-10-14', childStatus: 'completed', workspaceResult: { status: 'completed', childStatus: 'completed' } }
  assert.equal(aiDelegationCanBeSupersededBy(d, next), true)
  assert.deepEqual(completedReplacementDelegations({ ...d, recovery: aiDelegationRecoveryAvailability(d) }, [{ ...next, workCompleted: true }]).map(item => item.id), ['replacement'])
  assert.equal(aiDelegationCanBeSupersededBy({ ...d, childTurnId: 'started' }, next), false)
  assert.equal(aiDelegationCanBeSupersededBy(d, { ...next, targetCardId: 'other' }), false)
  assert.equal(aiDelegationCanBeSupersededBy(d, { ...next, state: 'running' }), false)
})

test('DB 재개는 원 반환 lease·대화·오류·체크포인트까지 대사하며 추정한 만료·다른 점유는 거절한다', () => {
  const d = fixture(), dispatch = { operationId: d.childOperationId, conversationId: d.targetConversationId, state: 'failed', turnId: null, errorMessage: error, workspaceLease: lease }
  const stored = { ...lease, mapId: d.mapId, cardId: d.targetCardId, conversationId: d.targetConversationId, status: 'cancelled', result: d.workspaceResult, checkpoints: [] }
  assert.doesNotThrow(() => assertAiDelegationDatabaseRejection(d, dispatch, stored))
  for (const invalid of [undefined, { ...stored, status: 'leased' }, { ...stored, leaseId: 'new-owner' },
    { ...stored, cardId: 'other' }, { ...stored, checkpoints: [{ commit: 'a' }] }, { ...stored, result: { ...stored.result, headCommit: 'b'.repeat(40) } }]) {
    assert.throws(() => assertAiDelegationDatabaseRejection(d, dispatch, invalid), { code: 'AI_DELEGATION_DATABASE_REJECTION_UNCONFIRMED' })
  }
  assert.throws(() => assertAiDelegationDatabaseRejection(d, { ...dispatch, turnId: 'executed' }, stored), { code: 'AI_DELEGATION_DATABASE_REJECTION_UNCONFIRMED' })
  assert.throws(() => assertAiDelegationDatabaseRejection(d, null, stored), { code: 'AI_DELEGATION_DATABASE_REJECTION_UNCONFIRMED' })
})
