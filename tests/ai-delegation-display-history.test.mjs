import assert from 'node:assert/strict'
import test from 'node:test'
import { aiDelegationDisplayItems, aiDelegationDisplaySections, aiDelegationStatusByCard } from '../src/utils/aiDelegationStatus.mjs'
import { groupDelegationPresentation, groupDelegationReportHint } from '../src/utils/groupOverview.mjs'

const execution = (id, overrides = {}) => ({
  id, mapId: 'target-map', parentMapId: 'parent-map', parentCardId: 'parent', targetCardId: 'target',
  state: 'completed', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T01:00:00Z',
  workCompleted: true, reportStatus: 'received', result: `${id} 단계 완료 원문`,
  taskCompletion: { state: 'incomplete', status: 'planned', progress: 0, message: '현재 카드 전체 업무 미완료' },
  ...overrides,
})

test('같은 카드의 완료 실행 55건은 카드 확인 1건과 접힌 실행 이력으로 분리한다', () => {
  const items = Array.from({ length: 55 }, (_, index) => execution(`step-${index}`, {
    createdAt: new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString(),
  }))
  const original = structuredClone(items)
  const { currentItems, completedHistory } = aiDelegationDisplaySections(items)
  assert.equal(currentItems.length, 1)
  assert.equal(currentItems[0].id, 'step-54')
  assert.equal(currentItems[0].kind, 'task-attention')
  assert.equal(currentItems[0].completedExecutionCount, 55)
  assert.equal(completedHistory.length, 55)
  assert.equal(completedHistory[0], items[54])
  assert.equal(completedHistory[54], items[0])
  assert.equal(currentItems[0].state, 'completed')
  assert.equal(groupDelegationPresentation(currentItems[0]).label, '카드 업무 미완료 · 확인 필요')
  assert.match(groupDelegationReportHint(currentItems[0]), /완료된 실행 55건/)
  assert.match(groupDelegationReportHint(currentItems[0]), /기록 누락이나 실행 실패를 뜻하지 않습니다/)
  assert.equal(groupDelegationPresentation(items[0]).attention, false, '과거 완료 실행 자체를 현재 업무 확인으로 재분류하지 않는다')
  assert.deepEqual(items, original)
  const badge = aiDelegationStatusByCard(items, 'parent-map').parent
  assert.equal(badge.count, 1)
  assert.equal(badge.incompleteTaskCount, 1)
  assert.equal(badge.activeCount, 0)
  assert.match(badge.title, /카드 업무 확인 필요 1개 카드/)
})

test('169개 실행 형태에서도 진행 3건·업무 확인 7개 카드와 완료 이력 166건으로 집계한다', () => {
  // 운영 문서나 위임 ID를 사용하지 않는 합성 회귀 자료다.
  const counts = [55, 22, 21, 19, 12, 10, 9, 7, 5, 3]
  const items = counts.flatMap((count, target) => Array.from({ length: count }, (_, step) => execution(`target-${target}-step-${step}`, {
    targetCardId: `target-${target}`, createdAt: new Date(Date.UTC(2026, 9, 1, 0, step)).toISOString(),
  })))
  items.push(...Array.from({ length: 3 }, (_, index) => execution(`finished-${index}`, {
    targetCardId: `finished-${index}`, taskCompletion: { state: 'completed', status: 'done', progress: 100 },
  })))
  items.push(...[2, 4, 6].map(index => execution(`running-${index}`, { targetCardId: `target-${index}`, state: 'running', taskCompletion: undefined })))
  const original = structuredClone(items)
  const sections = aiDelegationDisplaySections(items)
  assert.equal(items.length, 169)
  assert.equal(sections.completedHistory.length, 166)
  assert.equal(sections.currentItems.length, 10)
  assert.equal(sections.currentItems.filter(item => item.kind === 'task-attention').length, 7)
  assert.equal(sections.currentItems.filter(item => item.state === 'running').length, 3)
  const badge = aiDelegationStatusByCard(items, 'parent-map').parent
  assert.equal(badge.count, 10)
  assert.equal(badge.kind, 'active')
  assert.equal(badge.activeCount, 3)
  assert.equal(badge.incompleteTaskCount, 7)
  assert.equal(badge.recoveryCount, 0)
  assert.equal(badge.reportCount, 0)
  assert.deepEqual(items, original)
})

test('진행·자원·결과 전달 대기 중이면 같은 카드의 과거 완료 안내를 현재 현황에 중복하지 않는다', () => {
  for (const state of ['running', 'waiting-workspace', 'waiting-resource', 'waiting-parent', 'waking-parent']) {
    const old = execution('old')
    const current = execution('current', { state, taskCompletion: undefined })
    const sections = aiDelegationDisplaySections([old, current])
    assert.deepEqual(sections.currentItems, [current])
    assert.deepEqual(sections.completedHistory, [old])
    assert.equal(aiDelegationStatusByCard([old, current], 'parent-map').parent.incompleteTaskCount, 0)
  }
})

test('같은 카드의 실제 복구·보고 재시도 항목은 최신 실행으로 덮거나 이력으로 숨기지 않는다', () => {
  const recovery = execution('recover', { state: 'failed', recovery: { recoveryAvailable: true } })
  const manual = execution('manual', { state: 'failed', workspaceResult: { status: 'quarantined' }, recovery: { recoveryAvailable: false } })
  const report = execution('report', { recovery: { recoveryAvailable: false, reportRetryAvailable: true } })
  const ordinary = execution('ordinary')
  const running = execution('running', { state: 'running', taskCompletion: undefined })
  const sections = aiDelegationDisplaySections([recovery, manual, report, ordinary, running])
  assert.deepEqual(sections.currentItems, [recovery, manual, report, running])
  assert.deepEqual(sections.completedHistory, [ordinary])
  const badge = aiDelegationStatusByCard([recovery, manual, report, ordinary, running], 'parent-map').parent
  assert.equal(badge.recoveryCount, 2)
  assert.equal(badge.reportCount, 1)
  assert.equal(badge.activeCount, 1)
  assert.equal(badge.incompleteTaskCount, 0)
})

test('새 실행의 접수 실패는 별개로 유지하고 해결된 요청 오류만 숨긴다', () => {
  const old = execution('old')
  const failure = execution('request', { kind: 'request-failure', state: 'request-failed', executionState: 'not-started' })
  const resolved = { ...failure, id: 'resolved', resolvedByDelegationId: 'accepted' }
  const items = aiDelegationDisplayItems([old], [failure, resolved])
  const sections = aiDelegationDisplaySections(items)
  assert.equal(sections.currentItems[0], failure)
  assert.equal(sections.currentItems[1].kind, 'task-attention')
  assert.deepEqual(sections.completedHistory, [old])
  const badge = aiDelegationStatusByCard(items, 'parent-map').parent
  assert.equal(badge.requestFailureCount, 1)
  assert.equal(badge.incompleteTaskCount, 1)
  assert.equal(badge.activeCount, 0)
})

test('문서·상위·대상 귀속이 다른 동일 카드 ID는 서로 합치지 않는다', () => {
  const items = [
    execution('a'), execution('b', { mapId: 'another-target-map' }),
    execution('c', { parentCardId: 'another-parent' }), execution('d', { parentMapId: 'another-parent-map' }),
  ]
  assert.equal(aiDelegationDisplaySections(items).currentItems.length, 4)
  const badges = aiDelegationStatusByCard(items, 'parent-map')
  assert.equal(badges.parent.incompleteTaskCount, 2)
  assert.equal(badges['another-parent'].incompleteTaskCount, 1)
})

test('이전 실행의 상태 재조회 시각 대신 위임 생성 시각으로 대표 이력을 고른다', () => {
  const old = execution('old', { updatedAt: '2099-01-01' })
  const latest = execution('latest', { createdAt: '2026-10-02T00:00:00Z' })
  for (const items of [[old, latest], [latest, old]]) {
    const { currentItems, completedHistory } = aiDelegationDisplaySections(items)
    assert.equal(currentItems[0].id, 'latest')
    assert.equal(completedHistory[0].id, 'latest')
  }
})

test('최신 카드 완료·상태 미확인·종료 실행을 과거 미완료 기록으로 덮지 않는다', () => {
  const old = execution('old')
  for (const overrides of [
    { taskCompletion: { state: 'completed', status: 'done', progress: 100 } },
    { taskCompletion: undefined }, { state: 'closed' }, { state: 'superseded' }, { state: 'failed' },
  ]) {
    const latest = execution('latest', { createdAt: '2026-10-02T00:00:00Z', ...overrides })
    assert.equal(aiDelegationDisplaySections([old, latest]).currentItems.length, 0)
    assert.deepEqual(aiDelegationStatusByCard([old, latest], 'parent-map'), {})
  }
})

test('같은 조회가 반복되어도 화면 항목·집계·원본 결과가 누적되지 않는다', () => {
  const items = [execution('old'), execution('latest', { createdAt: '2026-10-02T00:00:00Z' })]
  const original = structuredClone(items)
  const first = aiDelegationDisplaySections(items)
  for (let iteration = 0; iteration < 5; iteration++) {
    assert.deepEqual(aiDelegationDisplaySections(items), first)
    assert.equal(aiDelegationDisplaySections([...items, ...items]).currentItems.length, 1)
    assert.equal(aiDelegationDisplaySections([...items, ...items]).completedHistory.length, 2)
  }
  assert.deepEqual(items, original)
  assert.equal(first.currentItems[0].result, 'latest 단계 완료 원문')
})
