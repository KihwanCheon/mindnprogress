import test from 'node:test'
import assert from 'node:assert/strict'
import {
  aiDelegationCanBeSupersededBy,
  aiDelegationClosureAvailability,
  aiDelegationIsTerminal,
  aiDelegationWorkPending,
  preservedIntegrationReleaseClosure,
} from '../server/lib/aiDelegations.mjs'

const completedAttempt = {
  id: 'old-report', state: 'parent-wake-failed', mapId: 'map-a',
  parentCardId: 'root-a', targetCardId: 'task-a',
  parentConversationId: 'old-parent', targetConversationId: 'removed-child',
  createdAt: '2026-09-01T00:00:00.000Z', childStatus: 'completed',
  workspaceLease: { leaseId: 'lease-a' }, workspaceResult: { status: 'completed' },
}

const replacement = {
  ...completedAttempt,
  id: 'replacement', state: 'completed',
  parentConversationId: 'new-parent', targetConversationId: 'new-child',
  createdAt: '2026-09-02T00:00:00.000Z', parentDispatchState: 'completed',
}

test('완료 후 보고 실패 기록은 대화가 달라도 같은 카드의 후속 성공으로 종료할 수 있다', () => {
  assert.equal(aiDelegationCanBeSupersededBy(completedAttempt, replacement), true)
  assert.deepEqual(aiDelegationClosureAvailability(completedAttempt), {
    closeAvailable: true,
    reason: 'completed-child-report-abandonment',
  })
})

test('그룹 위임은 기존 그룹 복구 흐름을 사용하고 일반 문서 사용자 종료로 우회하지 않는다', () => {
  const grouped = { ...completedAttempt, groupId: 'group-a' }
  assert.deepEqual(aiDelegationClosureAvailability(grouped), {
    closeAvailable: false,
    reason: 'group-managed',
  })
  assert.equal(aiDelegationCanBeSupersededBy(grouped, { ...replacement, groupId: 'group-a' }), false)
})

test('변경이 보존된 한도 중단은 사용자 종료를 막고 변경 없는 중단만 허용한다', () => {
  const waiting = {
    ...completedAttempt,
    state: 'waiting-usage-limit', childStatus: 'failed',
    childError: 'usage limit', workspaceResult: { status: 'quarantined' },
  }
  assert.equal(aiDelegationClosureAvailability(waiting)?.closeAvailable, false)
  assert.equal(aiDelegationClosureAvailability({ ...waiting, workspaceResult: { status: 'failed-clean' } })?.closeAvailable, true)
})

test('사용자 종료는 완료가 아니지만 미종료 작업 차단에서는 제외한다', () => {
  const closed = { ...completedAttempt, state: 'closed' }
  assert.equal(aiDelegationIsTerminal(closed), true)
  assert.equal(aiDelegationWorkPending(closed), false)
  assert.equal(aiDelegationClosureAvailability(closed), null)
})

test('완료 실행의 로컬 변경 통합 실패만 명시적 결과 보존 반환 후보로 표시한다', () => {
  const failed = { ...completedAttempt, state: 'failed', workspaceResult: { status: 'quarantined', childStatus: 'completed',
    integrationBranch: 'mnp/integrate/job', integrationBaseCommit: 'base',
    error: `Command failed: git -c core.autocrlf=false cherry-pick ${'a'.repeat(40)}\nerror: Your local changes would be overwritten by merge:\nfile` } }
  assert.equal(aiDelegationClosureAvailability(failed)?.workspaceReleaseRequired, true)
  for (const patch of [{ groupId: 'group' }, { workspaceLease: { leaseId: 'remote', ownership: {} } },
    { pendingRecovery: {} }, { integrationRecoveryRequest: { status: 'checking' } },
    { workspaceResult: { ...failed.workspaceResult, childStatus: 'failed' } },
    { workspaceResult: { ...failed.workspaceResult, unmergedFiles: ['conflict'] } }]) {
    assert.notEqual(aiDelegationClosureAvailability({ ...failed, ...patch })?.workspaceReleaseRequired, true)
  }
  assert.equal(aiDelegationCanBeSupersededBy(failed, replacement), false, '후속 성공만으로 자동 반환하지 않는다.')
})

test('풀 반환 후 위임 저장 전 중단은 귀속이 일치하는 반환 receipt로만 종료 대사한다', () => {
  const failed = { ...completedAttempt, state: 'failed', workspaceResult: { status: 'quarantined', childStatus: 'completed',
    headCommit: 'source', integrationBranch: 'mnp/integrate/job', integrationBaseCommit: 'base',
    error: `Command failed: git cherry-pick ${'a'.repeat(40)}\nerror: Your local changes would be overwritten by merge:\nfile` } }
  const scope = { leaseId: 'lease-a', jobId: 'job-a', mapId: failed.mapId, cardId: failed.targetCardId, conversationId: failed.targetConversationId }
  const lease = { ...scope, status: 'cancelled', result: { ...scope, status: 'released-preserved', integratedCommit: null,
    previousResult: failed.workspaceResult, preservedRelease: { phase: 'released', sourceHead: 'source', reason: '승인된 반환', releasedAt: '2026-10-14', approvedByOperator: 'NHN' } } }
  const patch = preservedIntegrationReleaseClosure(failed, lease)
  assert.equal(patch.state, 'closed')
  assert.equal(patch.closedByOperator, 'NHN')
  assert.deepEqual(patch.workspaceResult.previousResult, failed.workspaceResult)
  for (const invalid of [{ ...lease, status: 'quarantined' }, { ...lease, conversationId: 'other' },
    { ...lease, result: { ...lease.result, leaseId: 'other' } },
    { ...lease, result: { ...lease.result, previousResult: { headCommit: 'different' } } }]) {
    assert.equal(preservedIntegrationReleaseClosure(failed, invalid), null)
  }
  assert.equal(preservedIntegrationReleaseClosure({ ...failed, state: 'running' }, lease), null)
  assert.equal(preservedIntegrationReleaseClosure({ ...failed, ...patch }, lease), null)
})
