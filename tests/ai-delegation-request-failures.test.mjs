import assert from 'node:assert/strict'
import test from 'node:test'
import { createAiDelegationRequestFailures, safeDelegationFailureMessage, withDelegationTaskCompletion } from '../server/lib/aiDelegationRequestFailures.mjs'
import { aiDelegationDisplayItems, aiDelegationDisplaySections, aiDelegationStatusByCard, isVisibleAiDelegation } from '../src/utils/aiDelegationStatus.mjs'
import { groupDelegationPresentation } from '../src/utils/groupOverview.mjs'

const context = { requestId: 'request-1', delegationId: 'delegation-1', mapId: 'map-test', parentMapId: 'map-test',
  parentCardId: 'parent', targetCardId: 'child', targetHomeMachineId: 'mac', requestSignature: 'same-request', instruction: '비공개 지시 전문' }
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
  const text = safeDelegationFailureMessage('Bearer example-secret; password=private 비공개 지시 전문', context.instruction)
  assert.doesNotMatch(text, /example-secret|password=private|비공개 지시 전문/)
})
