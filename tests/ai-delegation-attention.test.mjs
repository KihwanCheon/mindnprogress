import assert from 'node:assert/strict'
import test from 'node:test'
import { aiDelegationAttentionByCard } from '../src/utils/aiDelegationAttention.mjs'

test('현재 문서에서 실제 복구 가능한 위임만 카드 표시로 만든다', () => {
  const result = aiDelegationAttentionByCard([
    { id: 'recover-new', mapId: 'map-a', targetCardId: 'card-a', updatedAt: '2026-09-16T02:00:00.000Z', childError: '모델 용량 초과', recovery: { recoveryAvailable: true } },
    { id: 'recover-old', mapId: 'map-a', targetCardId: 'card-a', updatedAt: '2026-09-16T01:00:00.000Z', recovery: { recoveryAvailable: true } },
    { id: 'completed', mapId: 'map-a', targetCardId: 'card-b', updatedAt: '2026-09-16T01:00:00.000Z', state: 'completed', recovery: { recoveryAvailable: false } },
    { id: 'other-map', mapId: 'map-b', targetCardId: 'card-c', updatedAt: '2026-09-16T01:00:00.000Z', recovery: { recoveryAvailable: true } },
  ], 'map-a')

  assert.deepEqual(Object.keys(result), ['card-a'])
  assert.equal(result['card-a'].kind, 'recovery')
  assert.equal(result['card-a'].count, 2)
  assert.match(result['card-a'].title, /모델 용량 초과/)
})

test('작업 재개가 없고 결과 재전달만 가능하면 별도 상태로 표시한다', () => {
  const result = aiDelegationAttentionByCard([
    { id: 'report', mapId: 'map-a', targetCardId: 'card-a', updatedAt: '2026-09-16T02:00:00.000Z', recovery: { recoveryAvailable: false, reportRetryAvailable: true } },
  ], 'map-a')

  assert.deepEqual(result['card-a'], {
    kind: 'report',
    count: 1,
    label: '결과 전달 필요',
    title: '완료된 AI 작업 결과 1건을 다시 전달할 수 있습니다.\n클릭하면 카드의 AI 작업 복구 영역으로 이동합니다.',
  })
})

test('재개와 결과 재전달이 함께 있으면 재개를 우선하고 나머지도 알린다', () => {
  const result = aiDelegationAttentionByCard([
    { id: 'recover', mapId: 'map-a', targetCardId: 'card-a', updatedAt: '2026-09-16T02:00:00.000Z', recovery: { recoveryAvailable: true } },
    { id: 'report', mapId: 'map-a', targetCardId: 'card-a', updatedAt: '2026-09-16T01:00:00.000Z', recovery: { recoveryAvailable: false, reportRetryAvailable: true } },
  ], 'map-a')

  assert.equal(result['card-a'].kind, 'recovery')
  assert.equal(result['card-a'].count, 1)
  assert.match(result['card-a'].title, /결과 전달 재시도 1건/)
})
