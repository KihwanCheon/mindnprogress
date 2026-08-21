import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyBoxSelection,
  boxSelectionNodeIds,
  boxSelectionRect,
  isBoxSelectionDrag,
} from '../src/utils/boxSelection.mjs'

function card(id, x, y, extra = {}) {
  return { id, x, y, width: 100, height: 60, ...extra }
}

test('드래그 방향과 무관하게 같은 사각형을 만든다', () => {
  const forward = boxSelectionRect({ x: 10, y: 20 }, { x: 110, y: 220 })
  const backward = boxSelectionRect({ x: 110, y: 220 }, { x: 10, y: 20 })

  assert.deepEqual(forward, { x: 10, y: 20, width: 100, height: 200 })
  assert.deepEqual(backward, forward)
})

test('임계값 이하로 움직이면 드래그로 보지 않는다', () => {
  assert.equal(isBoxSelectionDrag({ x: 0, y: 0 }, { x: 3, y: 0 }), false)
  assert.equal(isBoxSelectionDrag({ x: 0, y: 0 }, { x: 4, y: 0 }), false)
  assert.equal(isBoxSelectionDrag({ x: 0, y: 0 }, { x: 5, y: 0 }), true)
})

test('기본 판정은 사각형에 걸치기만 해도 대상에 포함한다', () => {
  const candidates = [card('a', 0, 0), card('b', 200, 0), card('c', 400, 400)]
  const ids = boxSelectionNodeIds(candidates, { x: 50, y: 30, width: 200, height: 40 })

  assert.deepEqual(ids, ['a', 'b'])
})

test('full 판정은 사각형에 완전히 들어온 카드만 포함한다', () => {
  const candidates = [card('a', 0, 0), card('b', 200, 0)]
  const rect = { x: -10, y: -10, width: 130, height: 90 }

  assert.deepEqual(boxSelectionNodeIds(candidates, rect, { mode: 'full' }), ['a'])
  assert.deepEqual(boxSelectionNodeIds(candidates, rect, { mode: 'partial' }), ['a'])
})

test('선택할 수 없는 카드는 제외한다', () => {
  const candidates = [card('a', 0, 0), card('b', 20, 0, { selectable: false })]

  assert.deepEqual(boxSelectionNodeIds(candidates, { x: 0, y: 0, width: 300, height: 300 }), ['a'])
})

test('경계만 맞닿은 카드는 포함하지 않는다', () => {
  const candidates = [card('a', 100, 0)]

  assert.deepEqual(boxSelectionNodeIds(candidates, { x: 0, y: 0, width: 100, height: 60 }), [])
})

test('선택되지 않은 카드를 드래그하면 기존 선택에 더한다', () => {
  assert.deepEqual(applyBoxSelection(['a', 'b'], ['c', 'd']), ['a', 'b', 'c', 'd'])
})

test('이미 모두 선택된 카드를 다시 드래그하면 그 카드만 선택을 해제한다', () => {
  const base = ['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'n9', 'n10']

  assert.deepEqual(applyBoxSelection(base, ['n1', 'n2', 'n3', 'n4', 'n5']), ['n6', 'n7', 'n8', 'n9', 'n10'])
})

test('선택과 미선택이 섞이면 박스에 걸친 카드를 모두 선택한다', () => {
  const base = ['n1', 'n2', 'n3', 'n4', 'n5']
  const box = ['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'n9', 'n10']

  assert.deepEqual(applyBoxSelection(base, box), box)
})

test('박스 밖의 기존 선택은 유지한다', () => {
  assert.deepEqual(applyBoxSelection(['a', 'b', 'c'], ['b']), ['a', 'c'])
})

test('빈 박스는 기존 선택을 바꾸지 않는다', () => {
  assert.deepEqual(applyBoxSelection(['a', 'b'], []), ['a', 'b'])
})

test('중복된 박스 대상은 한 번만 처리한다', () => {
  assert.deepEqual(applyBoxSelection(['a'], ['a', 'a']), [])
  assert.deepEqual(applyBoxSelection([], ['a', 'a']), ['a'])
})
