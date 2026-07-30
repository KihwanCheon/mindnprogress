import assert from 'node:assert/strict'
import { test } from 'node:test'
import { detectReleasedWaitingItems } from '../server/lib/waitingItems.mjs'

const node = (id, label, waitingItems, assigneeId) => ({
  id,
  type: 'mind',
  position: { x: 0, y: 0 },
  data: { label, ...(waitingItems ? { waitingItems } : {}), ...(assigneeId ? { assigneeId } : {}) },
})

test('제거된 waitingItems를 해제로 감지한다', () => {
  const previous = [node('a', '카드 A', [{ id: 'w1', label: '서버 API 대기' }, { id: 'w2', label: '아트 리소스 대기' }], 'user-editor')]
  const current = [node('a', '카드 A', [{ id: 'w2', label: '아트 리소스 대기' }], 'user-editor')]
  const released = detectReleasedWaitingItems(previous, current)
  assert.equal(released.length, 1)
  assert.deepEqual(released[0], {
    nodeId: 'a',
    nodeLabel: '카드 A',
    assigneeId: 'user-editor',
    item: { id: 'w1', label: '서버 API 대기' },
  })
})

test('waitingItems 전체 해제도 감지한다', () => {
  const previous = [node('a', '카드 A', [{ label: '기획 확인 대기' }])]
  const current = [node('a', '카드 A', [])]
  const released = detectReleasedWaitingItems(previous, current)
  assert.equal(released.length, 1)
  assert.equal(released[0].item.label, '기획 확인 대기')
  assert.equal(released[0].assigneeId, null)
})

test('변경이 없으면 해제로 보지 않는다', () => {
  const items = [{ id: 'w1', label: '서버 API 대기' }]
  const released = detectReleasedWaitingItems([node('a', '카드 A', items)], [node('a', '카드 A', items)])
  assert.equal(released.length, 0)
})

test('카드 자체가 삭제되면 해제로 보지 않는다', () => {
  const previous = [node('a', '카드 A', [{ id: 'w1', label: '서버 API 대기' }])]
  const released = detectReleasedWaitingItems(previous, [])
  assert.equal(released.length, 0)
})

test('id가 없는 항목은 label로 비교한다', () => {
  const previous = [node('a', '카드 A', [{ label: '기획 확인 대기' }, { label: '서버 배포 대기' }])]
  const current = [node('a', '카드 A', [{ label: '기획 확인 대기' }])]
  const released = detectReleasedWaitingItems(previous, current)
  assert.equal(released.length, 1)
  assert.equal(released[0].item.label, '서버 배포 대기')
})

test('같은 label의 항목이 새 id로 저장되어도 해제로 보지 않는다', () => {
  const previous = [node('a', '카드 A', [{ id: 'w1', label: '서버 API 대기' }])]
  const current = [node('a', '카드 A', [{ id: 'w2', label: '서버 API 대기' }])]
  const released = detectReleasedWaitingItems(previous, current)
  assert.equal(released.length, 0)
})

test('같은 label의 중복 항목이 줄어들면 제거된 개수만 해제로 감지한다', () => {
  const previous = [node('a', '카드 A', [
    { id: 'w1', label: '기획 확인 대기' },
    { id: 'w2', label: '기획 확인 대기' },
  ])]
  const current = [node('a', '카드 A', [{ id: 'w3', label: '기획 확인 대기' }])]
  const released = detectReleasedWaitingItems(previous, current)
  assert.equal(released.length, 1)
})

test('빈 label 항목은 무시한다', () => {
  const previous = [node('a', '카드 A', [{ label: '  ' }, { label: '유효한 대기' }])]
  const current = [node('a', '카드 A', [{ label: '유효한 대기' }])]
  const released = detectReleasedWaitingItems(previous, current)
  assert.equal(released.length, 0)
})

test('새로 추가된 항목은 해제로 보지 않는다', () => {
  const previous = [node('a', '카드 A', [{ id: 'w1', label: '서버 API 대기' }])]
  const current = [node('a', '카드 A', [{ id: 'w1', label: '서버 API 대기' }, { id: 'w2', label: '새 대기' }])]
  const released = detectReleasedWaitingItems(previous, current)
  assert.equal(released.length, 0)
})
