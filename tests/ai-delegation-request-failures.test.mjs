import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { createAiDelegationRequestFailures, safeDelegationFailureMessage, withDelegationTaskCompletion } from '../server/lib/aiDelegationRequestFailures.mjs'
import { aiDelegationDisplayItems, aiDelegationDisplaySections, aiDelegationStatusByCard, isVisibleAiDelegation } from '../src/utils/aiDelegationStatus.mjs'
import { groupDelegationPresentation } from '../src/utils/groupOverview.mjs'

const context = { requestId: 'request-1', delegationId: 'delegation-1', mapId: 'map-test', parentMapId: 'map-test',
  parentCardId: 'parent', targetCardId: 'child', targetHomeMachineId: 'mac', strategy: 'new', requestSignature: 'same-request', instruction: '비공개 지시 전문', taskSummary: '검수 요청' }
const failure = { status: 409, reasonCode: 'REMOTE_WORKSPACE_RUNNER_STALE', message: '원격 풀 보고가 만료됐습니다.' }

test('요청 실패는 실행과 별개로 직렬 저장하고 재시작 후에도 이유를 조회한다', async () => {
  let disk = []
  const dependencies = { filePath: 'isolated', readJson: async () => structuredClone(disk), writeJson: async (_file, records) => { disk = structuredClone(records) } }
  const ledger = await createAiDelegationRequestFailures(dependencies)
  await Promise.all([ledger.record(context, failure), ledger.record({ ...context, requestId: 'request-2' }, failure)])
  const restarted = await createAiDelegationRequestFailures(dependencies)
  const items = restarted.list({ mapId: 'map-test', delegations: new Map() })
  assert.equal(items.length, 2)
  assert.equal(items[0].status, 409)
  assert.equal(items[0].reasonCode, failure.reasonCode)
  assert.equal(items[0].message, failure.message)
  assert.equal(items[0].executionState, 'not-started')
  assert.equal(items[0].automaticRetry, false)
  assert.equal(JSON.stringify(disk).includes(context.instruction), false)
  assert.equal(items[0].requestSummary, '검수 요청')
  assert.equal(JSON.stringify(disk).includes('비공개 지시 전문'), false)
  assert.equal(isVisibleAiDelegation(items[0]), true)
  const badge = aiDelegationStatusByCard(items, 'map-test').parent
  assert.equal(badge.kind, 'request-failed')
  assert.equal(badge.activeCount, 0)
  assert.equal(badge.recoveryCount, 0)
})

test('전달 불확실 요청은 미실행으로 단정하지 않고 자동 재실행도 하지 않는다', async () => {
  const ledger = await createAiDelegationRequestFailures({ filePath: 'isolated', readJson: async () => [], writeJson: async () => {} })
  const item = await ledger.record({ ...context, dispatchStarted: true }, failure)
  assert.equal(item.executionState, 'unknown')
  assert.match(groupDelegationPresentation(item).label, /실행 여부 확인 필요/)
})

test('같은 요청의 실제 접수 이후에도 실패 이력은 남지만 현재 실패 표시는 해제한다', async () => {
  const ledger = await createAiDelegationRequestFailures({ filePath: 'isolated', readJson: async () => [], writeJson: async () => {} })
  await ledger.record(context, failure)
  const delegations = new Map([[context.delegationId, { ...context, id: context.delegationId, createdAt: '2999-01-01' }]])
  const items = ledger.list({ mapId: 'map-test', delegations })
  assert.equal(items.length, 1)
  assert.equal(items[0].resolvedByDelegationId, context.delegationId)
  assert.equal(aiDelegationDisplayItems([], items).length, 0)
  assert.equal(items[0].requestSignature, undefined)
  delegations.get(context.delegationId).requestSignature = 'different-request'
  assert.equal(ledger.list({ mapId: 'map-test', delegations })[0].resolvedByDelegationId, null)
})

function memoryLedger(initial = []) {
  let disk = structuredClone(initial)
  const dependencies = { filePath: 'isolated', readJson: async () => structuredClone(disk),
    writeJson: async (_file, records) => { disk = structuredClone(records) } }
  return { dependencies, disk: () => structuredClone(disk) }
}

test('버전 충돌 뒤 키·서명이 바뀌어도 동일 지시·상위·머신의 정상 재접수는 표시를 해제한다', async () => {
  const memory = memoryLedger()
  const ledger = await createAiDelegationRequestFailures(memory.dependencies)
  const original = await ledger.record({ ...context, parentConversationId: 'parent-conversation' }, {
    ...failure, reasonCode: 'AI_DELEGATION_VERSION_CONFLICT',
  })
  const accepted = { ...context, id: 'revision-2', requestSignature: 'changed-revision',
    parentConversationId: 'parent-conversation', strategy: original.strategy,
    instructionHash: createHash('sha256').update(context.instruction).digest('hex'),
    state: 'running', createdAt: '2999-01-01' }
  const originals = structuredClone(accepted)
  const delegations = new Map([[accepted.id, accepted]])
  const item = ledger.list({ mapId: context.mapId, delegations })[0]
  assert.equal(item.resolvedByDelegationId, accepted.id)
  assert.equal(aiDelegationStatusByCard([item], context.mapId)[context.parentCardId], undefined)
  assert.equal(item.instructionHash, undefined)
  assert.equal(item.requestSignature, undefined)
  assert.deepEqual(accepted, originals)
  const restarted = await createAiDelegationRequestFailures(memory.dependencies)
  assert.equal(restarted.list({ mapId: context.mapId, delegations })[0].resolvedByDelegationId, accepted.id)
  for (const delta of [{ instructionHash: 'different-work' }, { parentConversationId: 'another-parent' },
    { targetHomeMachineId: 'another-machine' }, { targetCardId: 'another-card' }, { strategy: 'resume' },
    { createdAt: '2000-01-01' }]) {
    delegations.set(accepted.id, { ...accepted, ...delta })
    assert.equal(ledger.list({ mapId: context.mapId, delegations })[0].resolvedByDelegationId, null)
  }
})

test('실행 불확실·다른 오류·근거 없는 레거시는 새 키의 접수로 자동 해제하지 않는다', async () => {
  for (const mode of ['unknown', 'other-error', 'legacy']) {
    const memory = memoryLedger()
    const ledger = await createAiDelegationRequestFailures(memory.dependencies)
    await ledger.record({ ...context, parentConversationId: mode === 'legacy' ? undefined : 'parent',
      dispatchStarted: mode === 'unknown' }, { ...failure,
      reasonCode: mode === 'other-error' ? failure.reasonCode : 'AI_DELEGATION_VERSION_CONFLICT' })
    const accepted = { ...context, id: 'new-key', requestSignature: 'new-signature', parentConversationId: 'parent',
      instructionHash: createHash('sha256').update(context.instruction).digest('hex'), createdAt: '2999-01-01' }
    assert.equal(ledger.list({ mapId: context.mapId, delegations: new Map([[accepted.id, accepted]]) })[0].resolvedByDelegationId, null)
  }
})

test('레거시 실패는 명시 확인으로 진행 중 재접수에 연결하고 원 오류·실행을 보존한다', async () => {
  const memory = memoryLedger()
  const ledger = await createAiDelegationRequestFailures(memory.dependencies)
  const record = await ledger.record(context, failure)
  const accepted = { ...context, id: 'new-key', requestSignature: 'new-signature', state: 'running', createdAt: '2999-01-01' }
  const before = structuredClone(accepted)
  const delegations = new Map([[accepted.id, accepted]])
  const body = { mapId: context.mapId, failureId: record.id, replacementDelegationId: accepted.id,
    expectedUpdatedAt: record.updatedAt, confirmSameWork: true, note: '승인된 동일 업무 재접수 확인', actorId: 'editor' }
  for (const patch of [{ expectedUpdatedAt: 'stale' }, { confirmSameWork: false },
    { replacementDelegationId: 'missing' }, { mapId: 'other-map' }]) {
    await assert.rejects(ledger.resolve({ ...body, ...patch }, delegations))
  }
  for (const patch of [{ targetCardId: 'another-card' }, { targetHomeMachineId: 'another-machine' },
    { parentCardId: 'another-parent' }, { mapId: 'another-map' }, { parentMapId: 'another-parent-map' },
    { createdAt: '2000-01-01' }, { requestSignature: null }]) {
    delegations.set(accepted.id, { ...accepted, ...patch })
    await assert.rejects(ledger.resolve(body, delegations), { reasonCode: 'AI_DELEGATION_REQUEST_FAILURE_REPLACEMENT_INVALID' })
  }
  delegations.set(accepted.id, accepted)
  const result = await ledger.resolve(body, delegations)
  assert.equal(result.repeated, false)
  assert.equal(result.requestFailure.resolvedByDelegationId, accepted.id)
  assert.equal(result.requestFailure.state, 'request-failed')
  assert.equal(result.requestFailure.message, failure.message)
  assert.equal(result.requestFailure.resolution.actorId, 'editor')
  assert.deepEqual(delegations.get(accepted.id), before)
  assert.equal((await ledger.resolve(body, delegations)).repeated, true)
  await assert.rejects(ledger.resolve({ ...body, replacementDelegationId: 'another' }, delegations),
    { reasonCode: 'AI_DELEGATION_REQUEST_FAILURE_ALREADY_RESOLVED' })
  const restarted = await createAiDelegationRequestFailures(memory.dependencies)
  assert.equal(restarted.list({ mapId: context.mapId, delegations })[0].resolvedByDelegationId, accepted.id)
  assert.equal(memory.disk().length, 1)
})

test('실행 여부가 불확실한 실패는 사용자 확인이 있어도 해제하지 않는다', async () => {
  const ledger = await createAiDelegationRequestFailures(memoryLedger().dependencies)
  const record = await ledger.record({ ...context, dispatchStarted: true }, failure)
  const accepted = { ...context, id: 'new-key', createdAt: '2999-01-01' }
  await assert.rejects(ledger.resolve({ mapId: context.mapId, failureId: record.id, expectedUpdatedAt: record.updatedAt,
    replacementDelegationId: accepted.id, confirmSameWork: true, note: '재접수 확인', actorId: 'editor' },
  new Map([[accepted.id, accepted]])), { reasonCode: 'AI_DELEGATION_REQUEST_FAILURE_EXECUTION_UNCERTAIN' })
})

test('실행 완료와 카드 업무 미완료는 분리하고 기존 완료 상태·원문은 바꾸지 않는다', () => {
  const delegation = { id: 'completed', state: 'completed', mapId: 'map-test', parentCardId: 'parent', targetCardId: 'child', result: '조사 완료, 기록 미완료', workCompleted: true }
  const map = { nodes: [{ id: 'child', data: { isWork: true, status: 'planned', progress: 0 } }] }
  const originals = structuredClone({ delegation, map })
  const item = withDelegationTaskCompletion(delegation, map)
  assert.equal(item.state, 'completed')
  assert.equal(item.workCompleted, true)
  assert.equal(item.taskCompletion.state, 'incomplete')
  assert.equal(isVisibleAiDelegation(item), false, '과거 완료 기록 자체는 현재 현황으로 표시하지 않는다')
  const attention = aiDelegationDisplaySections([item]).currentItems[0]
  assert.equal(isVisibleAiDelegation(attention), true)
  const badge = aiDelegationStatusByCard([item], 'map-test').parent
  assert.equal(badge.kind, 'attention')
  assert.equal(badge.activeCount, 0)
  assert.equal(badge.recoveryCount, 0)
  assert.equal(groupDelegationPresentation(attention).tone, 'warning')
  assert.deepEqual({ delegation, map }, originals)
  map.nodes[0].data = { isWork: true, status: 'done', progress: 100 }
  assert.equal(isVisibleAiDelegation(withDelegationTaskCompletion(delegation, map)), false)
})

test('실패 메시지에서 토큰과 지시 전문을 제외한다', () => {
  const text = safeDelegationFailureMessage(`Bearer example-secret; password=private ${context.instruction}`, context.instruction)
  assert.doesNotMatch(text, /example-secret|password=private|비공개 지시 전문/)
})

test('재접수 참조는 원 지시·귀속·실행 여부를 검증하며 중복 접수를 거부한다', async () => {
  const ledger = await createAiDelegationRequestFailures(memoryLedger().dependencies)
  const original = { ...context, parentConversationId: 'parent-conversation', requestedConversationId: 'child-conversation', strategy: 'resume' }
  const failed = await ledger.record(original, failure)
  assert.equal(failed.retryReference.requestId, failed.id)
  const next = { ...original, delegationId: 'retry', requestSignature: 'new-revision' }
  assert.equal(ledger.validateRetry(next, failed.id, new Map()), failed.id)
  for (const patch of [{ instruction: '다른 업무' }, { parentConversationId: 'other' }, { requestedConversationId: 'other' },
    { targetHomeMachineId: 'other' }, { targetCardId: 'other' }, { parentCardId: 'other' }, { parentMapId: 'other' }, { strategy: 'new' }]) {
    assert.throws(() => ledger.validateRetry({ ...next, ...patch }, failed.id, new Map()), { reasonCode: 'AI_DELEGATION_RETRY_REFERENCE_INVALID' })
  }
  const accepted = { ...next, id: 'retry', createdAt: '2999-01-01', targetConversationId: 'child-conversation',
    instructionHash: createHash('sha256').update(next.instruction).digest('hex'), retryOfRequestId: failed.id, state: 'running' }
  const delegations = new Map([[accepted.id, accepted]])
  assert.equal(ledger.list({mapId: context.mapId, delegations})[0].retryVerification.method, 'retry-reference')
  assert.throws(() => ledger.validateRetry({ ...next, delegationId: 'another-retry' }, failed.id, delegations), { reasonCode: 'AI_DELEGATION_RETRY_ALREADY_ACCEPTED' })
  assert.equal(ledger.validateRetry(next, failed.id, delegations), failed.id)
})

test('재접수 확인은 근거 없는 후보를 고르지 않고 확인된 접수만 감사 이력으로 남긴다', async () => {
  const memory = memoryLedger()
  const ledger = await createAiDelegationRequestFailures(memory.dependencies)
  const original = { ...context, parentConversationId: 'parent-conversation' }
  const failed = await ledger.record(original, { ...failure, reasonCode: 'AI_DELEGATION_ALREADY_ACTIVE' })
  const query = { mapId: context.mapId, failureId: failed.id, expectedUpdatedAt: failed.updatedAt, actorId: 'editor' }
  const delegations = new Map()
  assert.equal((await ledger.recheck(query, delegations)).requestFailure.retryVerification.state, 'not-found')
  const candidate = { ...original, id: 'later', state: 'running', createdAt: '2999-01-01', instructionHash: 'different' }
  delegations.set(candidate.id, candidate)
  assert.equal((await ledger.recheck(query, delegations)).requestFailure.retryVerification.state, 'unverified')
  assert.equal(memory.disk()[0].resolution, undefined)
  candidate.instructionHash = createHash('sha256').update(original.instruction).digest('hex')
  const before = structuredClone(candidate)
  const result = await ledger.recheck(query, delegations)
  assert.equal(result.requestFailure.retryVerification.state, 'confirmed')
  assert.equal(result.requestFailure.retryVerification.replacement.state, 'running')
  assert.equal(result.requestFailure.resolution.method, 'same-instruction')
  assert.deepEqual(candidate, before)
  assert.equal((await ledger.recheck(query, delegations)).requestFailure.resolvedByDelegationId, candidate.id)
  const restarted = await createAiDelegationRequestFailures(memory.dependencies)
  assert.equal(restarted.list({mapId: context.mapId, delegations})[0].resolvedByDelegationId, candidate.id)
})

test('연속 접수 실패의 참조 체인은 원 요청까지 해제하고 실행 불확실 체인은 허용하지 않는다', async () => {
  const ledger = await createAiDelegationRequestFailures(memoryLedger().dependencies)
  const original = { ...context, parentConversationId: 'parent-conversation' }
  const first = await ledger.record(original, failure)
  const second = await ledger.record({ ...original, requestId: 'request-2', retryOfRequestId: first.id }, failure)
  const accepted = { ...original, id: 'retry', requestSignature: 'new-signature', state: 'waiting-workspace', createdAt: '2999-01-01',
    instructionHash: createHash('sha256').update(original.instruction).digest('hex'), retryOfRequestId: second.id }
  assert.ok(ledger.list({mapId: context.mapId, delegations: new Map([[accepted.id, accepted]])}).every(item => item.resolvedByDelegationId === accepted.id))
  const unknown = await ledger.record({ ...original, requestId: 'request-unknown', dispatchStarted: true }, failure)
  assert.equal(unknown.retryReference, undefined)
  assert.throws(() => ledger.validateRetry(original, unknown.id, new Map()), { reasonCode: 'AI_DELEGATION_RETRY_REFERENCE_INVALID' })
})
