import assert from 'node:assert/strict'
import test from 'node:test'
import { aiDelegationStatusByCard } from '../src/utils/aiDelegationStatus.mjs'

test('현재 문서에서 진행 중이거나 복구 가능한 위임을 카드 상태로 만든다', () => {
  const result = aiDelegationStatusByCard([
    { id: 'recover-new', mapId: 'map-a', parentCardId: 'card-a', targetCardId: 'child-a', updatedAt: '2026-09-16T02:00:00.000Z', childError: '모델 용량 초과', recovery: { recoveryAvailable: true } },
    { id: 'recover-old', mapId: 'map-a', parentCardId: 'card-a', targetCardId: 'child-b', updatedAt: '2026-09-16T01:00:00.000Z', recovery: { recoveryAvailable: true } },
    { id: 'running', mapId: 'map-a', parentCardId: 'card-b', targetCardId: 'child-c', state: 'running', updatedAt: '2026-09-16T03:00:00.000Z', recovery: { recoveryAvailable: false } },
    { id: 'completed', mapId: 'map-a', parentCardId: 'card-b', targetCardId: 'child-d', updatedAt: '2026-09-16T01:00:00.000Z', state: 'completed', recovery: { recoveryAvailable: false } },
    { id: 'other-map', mapId: 'map-b', parentCardId: 'card-c', targetCardId: 'child-e', updatedAt: '2026-09-16T01:00:00.000Z', recovery: { recoveryAvailable: true } },
  ], 'map-a')

  assert.deepEqual(Object.keys(result), ['card-a', 'card-b'])
  assert.equal(result['card-a'].kind, 'recovery')
  assert.equal(result['card-a'].count, 2)
  assert.match(result['card-a'].title, /모델 용량 초과/)
  assert.equal(result['card-b'].kind, 'active')
  assert.equal(result['card-b'].activeCount, 1)
  assert.match(result['card-b'].title, /AI 위임 진행 1건/)
})

test('작업 재개가 없고 결과 재전달만 가능하면 별도 상태로 표시한다', () => {
  const result = aiDelegationStatusByCard([
    { id: 'report', mapId: 'map-a', parentCardId: 'card-a', targetCardId: 'child-a', updatedAt: '2026-09-16T02:00:00.000Z', recovery: { recoveryAvailable: false, reportRetryAvailable: true } },
  ], 'map-a')

  assert.equal(result['card-a'].kind, 'report')
  assert.equal(result['card-a'].reportCount, 1)
  assert.match(result['card-a'].title, /AI 결과 전달 필요 1건/)
})

test('재개와 결과 재전달이 함께 있으면 재개를 우선하고 나머지도 알린다', () => {
  const result = aiDelegationStatusByCard([
    { id: 'recover', mapId: 'map-a', parentCardId: 'card-a', targetCardId: 'child-a', updatedAt: '2026-09-16T02:00:00.000Z', recovery: { recoveryAvailable: true } },
    { id: 'report', mapId: 'map-a', parentCardId: 'card-a', targetCardId: 'child-b', updatedAt: '2026-09-16T01:00:00.000Z', recovery: { recoveryAvailable: false, reportRetryAvailable: true } },
  ], 'map-a')

  assert.equal(result['card-a'].kind, 'recovery')
  assert.equal(result['card-a'].count, 2)
  assert.equal(result['card-a'].recoveryCount, 1)
  assert.equal(result['card-a'].reportCount, 1)
  assert.match(result['card-a'].title, /AI 결과 전달 필요 1건/)
})

test('위임 현황은 위임한 상위 카드에만 표시하고 위임받은 하위 카드는 제외한다', () => {
  const result = aiDelegationStatusByCard([
    { id: 'cross-map', mapId: 'child-map', parentMapId: 'map-a', parentCardId: 'parent', targetCardId: 'child', state: 'waiting-workspace', updatedAt: '2026-09-16T02:00:00.000Z' },
    { id: 'same-card', mapId: 'map-a', parentMapId: 'map-a', parentCardId: 'same', targetCardId: 'same', state: 'running', updatedAt: '2026-09-16T01:00:00.000Z' },
  ], 'map-a')

  assert.equal(result.parent.activeCount, 1)
  assert.equal(result.child, undefined)
  assert.equal(result.same.count, 1)
})
