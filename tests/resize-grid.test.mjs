import assert from 'node:assert/strict'
import test from 'node:test'
import { snapAspectResizeToGrid, snapFreeResizeToGrid } from '../src/utils/resizeGrid.mjs'

const bounds = {
  gridSize: 24,
  minWidth: 48,
  minHeight: 48,
  maxWidth: 2_000,
  maxHeight: 2_000,
}

test('현재 크기의 나머지가 아니라 최종 너비와 높이를 그리드 배수로 맞춘다', () => {
  const widthOnly = snapFreeResizeToGrid({
    x: 10,
    y: 20,
    width: 242,
    height: 112,
    fromLeft: false,
    fromTop: false,
    snapAxis: 'width',
  }, bounds)
  assert.deepEqual(widthOnly, {
    x: 10,
    y: 20,
    width: 240,
    height: 112,
    fromLeft: false,
    fromTop: false,
    snapAxis: 'width',
  })

  const both = snapFreeResizeToGrid({ ...widthOnly, height: 118, snapAxis: 'both' }, bounds)
  assert.equal(both.width, 240)
  assert.equal(both.height, 120)
})

test('왼쪽과 위쪽에서 조절해도 반대쪽 모서리 위치를 유지한다', () => {
  const resized = snapFreeResizeToGrid({
    x: 10,
    y: 20,
    width: 242,
    height: 118,
    fromLeft: true,
    fromTop: true,
    snapAxis: 'both',
  }, bounds)
  assert.equal(resized.x + resized.width, 252)
  assert.equal(resized.y + resized.height, 138)
  assert.equal(resized.width, 240)
  assert.equal(resized.height, 120)
})

test('이미지는 비율을 유지하면서 사용자가 맞추기 가까운 너비 또는 높이를 선택한다', () => {
  const byWidth = snapAspectResizeToGrid({
    x: 0,
    y: 0,
    width: 250,
    height: 187.5,
    fromLeft: false,
    fromTop: false,
    snapAxis: 'width',
  }, { ...bounds, aspectRatio: 4 / 3 })
  assert.equal(byWidth.width, 240)
  assert.equal(byWidth.height, 180)

  const byHeight = snapAspectResizeToGrid({
    ...byWidth,
    width: 318,
    height: 238.5,
    snapAxis: 'both',
  }, { ...bounds, aspectRatio: 4 / 3 })
  assert.equal(byHeight.width, 320)
  assert.equal(byHeight.height, 240)
})
