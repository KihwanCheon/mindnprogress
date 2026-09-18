import test from 'node:test'
import assert from 'node:assert/strict'
import { completedReplacementDelegations, delegationHierarchyPathNodeIds, delegationPreviewEdgeState, delegationPreviewNodeRole } from '../src/utils/aiDelegationManagement.mjs'

const delegation = (id, state, createdAt, overrides = {}) => ({
  id, state, createdAt, updatedAt: createdAt,
  mapId: 'map-a', parentCardId: 'root-a', targetCardId: 'task-a',
  ...overrides,
})

test('후속 성공 후보는 대화 ID가 달라도 같은 카드 범위의 가장 가까운 완료부터 제시한다', () => {
  const original = delegation('original', 'parent-wake-failed', '2026-09-01T00:00:00.000Z', { targetConversationId: 'removed', workCompleted: true })
  const later = delegation('later', 'completed', '2026-09-03T00:00:00.000Z', { workCompleted: true, targetConversationId: 'newer' })
  const closest = delegation('closest', 'completed', '2026-09-02T00:00:00.000Z', { workCompleted: true, targetConversationId: 'replacement' })
  const otherCard = delegation('other-card', 'completed', '2026-09-02T00:00:00.000Z', { workCompleted: true, targetCardId: 'task-b' })
  assert.deepEqual(completedReplacementDelegations(original, [later, otherCard, closest]).map((item) => item.id), ['closest', 'later'])
})

test('그룹 위임과 변경이 보존된 한도 중단에는 일반 문서 종료 후보를 제시하지 않는다', () => {
  const completed = delegation('completed', 'completed', '2026-09-02T00:00:00.000Z', { workCompleted: true })
  const grouped = delegation('grouped', 'parent-wake-failed', '2026-09-01T00:00:00.000Z', { groupId: 'group-a', workCompleted: true })
  const quarantined = delegation('quarantined', 'waiting-usage-limit', '2026-09-01T00:00:00.000Z', {
    workspaceLease: { leaseId: 'lease-a' }, workspaceResult: { status: 'quarantined' },
  })
  assert.deepEqual(completedReplacementDelegations(grouped, [{ ...completed, groupId: 'group-a' }]), [])
  assert.deepEqual(completedReplacementDelegations(quarantined, [completed]), [])
})

test('위임 미리보기는 상위 카드에서 대상 카드까지 연결된 모든 계층 경로를 유지한다', () => {
  const edges = [
    { source: 'parent', target: 'path-a' },
    { source: 'path-a', target: 'target' },
    { source: 'parent', target: 'path-b' },
    { source: 'path-b', target: 'target' },
    { source: 'parent', target: 'other-branch' },
    { source: 'other-root', target: 'target' },
  ]
  assert.deepEqual(
    [...delegationHierarchyPathNodeIds('parent', 'target', edges)].sort(),
    ['parent', 'path-a', 'path-b', 'target'],
  )
})

test('연결 경로가 없으면 위임 상위 카드와 대상 카드만 유지한다', () => {
  assert.deepEqual(
    [...delegationHierarchyPathNodeIds('parent', 'target', [{ source: 'parent', target: 'other' }])].sort(),
    ['parent', 'target'],
  )
})

test('위임 미리보기는 경로의 계층선만 유지하고 다른 계층선과 지식선은 흐리게 한다', () => {
  const pathNodeIds = new Set(['parent', 'middle', 'target'])
  assert.equal(delegationPreviewEdgeState({ source: 'parent', target: 'middle' }, pathNodeIds), 'edge-linked')
  assert.equal(delegationPreviewEdgeState({ source: 'middle', target: 'target' }, pathNodeIds), 'edge-linked')
  assert.equal(delegationPreviewEdgeState({ source: 'parent', target: 'other' }, pathNodeIds), 'edge-dimmed')
  assert.equal(delegationPreviewEdgeState({ source: 'parent', target: 'middle', data: { relation: 'knowledge' } }, pathNodeIds), 'edge-dimmed')
})

test('위임 미리보기는 같은 화면의 상위 카드와 대상 카드 역할을 구분한다', () => {
  const preview = {
    parent: { mapId: 'map-a', cardId: 'parent' },
    target: { mapId: 'map-a', cardId: 'target' },
  }
  assert.equal(delegationPreviewNodeRole(preview, 'map-a', 'parent'), 'source')
  assert.equal(delegationPreviewNodeRole(preview, 'map-a', 'middle'), undefined)
  assert.equal(delegationPreviewNodeRole(preview, 'map-a', 'target'), 'target')
})

test('다른 문서의 대상 카드가 보이지 않으면 현재 상위 카드의 선택 표시를 유지한다', () => {
  const preview = {
    parent: { mapId: 'map-a', cardId: 'parent' },
    target: { mapId: 'map-b', cardId: 'target' },
  }
  assert.equal(delegationPreviewNodeRole(preview, 'map-a', 'parent'), undefined)
  assert.equal(delegationPreviewNodeRole(preview, 'map-b', 'target'), 'target')
})
