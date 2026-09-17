import test from 'node:test'
import assert from 'node:assert/strict'
import { viewportForNodeVisibility } from '../src/utils/nodeViewportVisibility.mjs'

const viewport = { x: 0, y: 0, zoom: 1 }
const viewportSize = { width: 1000, height: 700 }

test('화면 안에 들어온 카드는 뷰포트를 이동하지 않는다', () => {
  assert.equal(viewportForNodeVisibility({
    viewport,
    viewportSize,
    node: { x: 120, y: 100, width: 220, height: 130 },
  }), null)
})

test('화면 밖 카드는 중앙이 아니라 가장 가까운 여백 안으로 이동한다', () => {
  assert.deepEqual(viewportForNodeVisibility({
    viewport,
    viewportSize,
    node: { x: 900, y: 640, width: 180, height: 100 },
  }), { x: -128, y: -88, zoom: 1 })
})

test('현재 확대율을 반영하고 그대로 유지한다', () => {
  assert.deepEqual(viewportForNodeVisibility({
    viewport: { x: 20, y: 10, zoom: 2 },
    viewportSize,
    node: { x: -30, y: 100, width: 100, height: 80 },
  }), { x: 108, y: 10, zoom: 2 })
})

test('화면보다 큰 카드는 가능한 표시 영역의 가운데에 맞춘다', () => {
  assert.deepEqual(viewportForNodeVisibility({
    viewport,
    viewportSize,
    node: { x: 0, y: 100, width: 1200, height: 100 },
  }), { x: -100, y: 0, zoom: 1 })
})
