import assert from 'node:assert/strict'
import test from 'node:test'
import { aiDelegationBusyDispatchRejected, aiDelegationBusyRecoveryOperation,
  aiDelegationRecoveryAvailability, rejectedAiDelegationRecoveryPatch } from '../server/lib/aiDelegations.mjs'

const lease = { workspaceId: 'worker', jobId: 'job-test', leaseId: 'lease-test', projectRoot: 'C:/test/worker', branch: 'mnp/test', baseCommit: 'a'.repeat(40) }
const rejected = { operationId: 'job-recover-1', conversationId: 'chat-test', state: 'failed', workspaceLease: lease,
  errorMessage: 'Conversation is busy: conversation chat-test is already running' }
const legacy = { id: 'job', mapId: 'map-test', targetCardId: 'card-test', targetConversationId: 'chat-test',
  state: 'failed', childOperationId: rejected.operationId, recoveryOperationId: rejected.operationId,
  recoveryAttempt: 1, childTurnId: null, workspaceLease: lease,
  workspaceResult: { workspaceId: lease.workspaceId, jobId: lease.jobId, leaseId: lease.leaseId, branch: lease.branch, baseCommit: lease.baseCommit,
    mapId: 'map-test', cardId: 'card-test', conversationId: 'chat-test', status: 'quarantined', childStatus: 'failed', childError: rejected.errorMessage } }

test('busy는 일치하는 복구 요청의 미실행 거절만 인정하며 턴·대화·실행 오류는 혼동하지 않는다', () => {
  assert.ok(aiDelegationBusyDispatchRejected(rejected, 'chat-test', rejected.operationId))
  for (const patch of [{ turnId: 'started-turn' }, { state: 'running' }, { conversationId: 'other-chat' },
    { operationId: 'other-request' }, { errorMessage: '실제 컴파일 실패' }, { errorMessage: 'Conversation is busy: conversation other-chat is already running' }]) {
    assert.equal(aiDelegationBusyDispatchRejected({ ...rejected, ...patch }, 'chat-test', rejected.operationId), false)
  }
})

test('구버전의 busy 격리는 복구 후보지만 실제 실행·통합·다른 소유권은 제외한다', () => {
  assert.equal(aiDelegationBusyRecoveryOperation(legacy), rejected.operationId)
  assert.equal(aiDelegationRecoveryAvailability(legacy).failureCategory, 'recovery-dispatch-busy')
  assert.equal(aiDelegationRecoveryAvailability(legacy).recoveryAvailable, true)
  for (const patch of [{ state: 'completed' }, { recoveryAttempt: 0 }, { recoveryAttempt: undefined }, { childTurnId: 'started-turn' },
    { resultCorrection: { phase: 'held' } },
    { childOperationId: 'original-job' }, { workspaceLease: { ...lease, jobId: 'foreign-job' } },
    ...[{ integratedCommit: 'b'.repeat(40) }, { integrationBranch: 'integrating' }, { unmergedFiles: ['conflict'] },
      { childStatus: 'completed' }, { cardId: 'foreign-card' }, { childError: '실제 실행 실패' }].map(p => ({ workspaceResult: { ...legacy.workspaceResult, ...p } }))]) {
    assert.equal(aiDelegationBusyRecoveryOperation({ ...legacy, ...patch }), null)
  }
})

test('거절은 원 실행·결과·체크포인트를 유지하고 자동 재실행 없이 복구 대기로 보존한다', () => {
  const original = { ...legacy, state: 'waiting-model-capacity', childOperationId: 'original-job', childTurnId: 'original-turn',
    childResultSnapshot: '기존 결과', childResultHash: 'existing-hash', childError: '모델 용량 부족' }
  const pending = { operationId: rejected.operationId, attempt: 1, sourceState: original.state, workspaceLease: lease }
  const patch = rejectedAiDelegationRecoveryPatch(original, pending, rejected, '2026-10-12T00:00:00Z')
  const saved = { ...original, ...patch }
  assert.equal(saved.state, 'recovery-required')
  for (const key of ['childOperationId', 'childTurnId', 'childResultSnapshot', 'childResultHash', 'childError', 'workspaceResult']) assert.deepEqual(saved[key], original[key])
  assert.equal(saved.pendingRecovery, null)
  assert.equal(saved.recoveryDispatchRejection.executionStarted, false)
  assert.equal(aiDelegationRecoveryAvailability(saved).failureCategory, 'recovery-dispatch-busy')
  assert.throws(() => rejectedAiDelegationRecoveryPatch(original, pending, { ...rejected, workspaceLease: { ...lease, leaseId: 'foreign' } }))
})
