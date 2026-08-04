import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  touchPointCentroid,
  touchPointDistance,
  viewportForTouchGesture,
} from '../src/utils/touchViewport.mjs'

test('두 터치가 같은 간격으로 이동하면 배율을 유지하며 화면을 이동한다', () => {
  const viewport = viewportForTouchGesture({
    startCentroid: touchPointCentroid({ x: 100, y: 100 }, { x: 200, y: 100 }),
    currentCentroid: touchPointCentroid({ x: 130, y: 120 }, { x: 230, y: 120 }),
    startDistance: touchPointDistance({ x: 100, y: 100 }, { x: 200, y: 100 }),
    currentDistance: touchPointDistance({ x: 130, y: 120 }, { x: 230, y: 120 }),
    viewport: { x: 10, y: 20, zoom: 1 },
    minZoom: 0.25,
    maxZoom: 1.8,
  })

  assert.deepEqual(viewport, { x: 40, y: 40, zoom: 1 })
})

test('핀치 중심의 맵 좌표를 고정한 채 확대한다', () => {
  const viewport = viewportForTouchGesture({
    startCentroid: { x: 150, y: 100 },
    currentCentroid: { x: 150, y: 100 },
    startDistance: 100,
    currentDistance: 150,
    viewport: { x: 0, y: 0, zoom: 1 },
    minZoom: 0.25,
    maxZoom: 1.8,
  })

  assert.deepEqual(viewport, { x: -75, y: -50, zoom: 1.5 })
})

test('핀치 배율은 허용된 확대 범위를 벗어나지 않는다', () => {
  const zoomedOut = viewportForTouchGesture({
    startCentroid: { x: 0, y: 0 },
    currentCentroid: { x: 0, y: 0 },
    startDistance: 100,
    currentDistance: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
    minZoom: 0.25,
    maxZoom: 1.8,
  })
  const zoomedIn = viewportForTouchGesture({
    startCentroid: { x: 0, y: 0 },
    currentCentroid: { x: 0, y: 0 },
    startDistance: 1,
    currentDistance: 100,
    viewport: { x: 0, y: 0, zoom: 1 },
    minZoom: 0.25,
    maxZoom: 1.8,
  })

  assert.equal(zoomedOut.zoom, 0.25)
  assert.equal(zoomedIn.zoom, 1.8)
})
