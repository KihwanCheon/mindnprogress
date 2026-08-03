import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyProgressRollup, computeWorkRollup } from '../server/lib/progressRollup.mjs'

const node = (id, data) => ({ id, type: 'mind', position: { x: 0, y: 0 }, data })
const hierarchy = (source, target) => ({ id: `edge-${source}-${target}`, source, target })
const knowledge = (source, target) => ({ id: `edge-${source}-${target}`, source, target, data: { relation: 'knowledge' } })

test('계층 안의 모든 업무 진행률을 동일 가중치로 평균해 반올림한다', () => {
  const nodes = [
    node('root', { kind: 'root', label: '루트', isWork: true, status: 'planned', progress: 100 }),
    node('a', { kind: 'task', label: 'A', isWork: true, progress: 30 }),
    node('b', { kind: 'task', label: 'B', isWork: true, progress: 45 }),
  ]
  const edges = [hierarchy('root', 'a'), hierarchy('root', 'b')]
  const rollup = computeWorkRollup(nodes, edges)
  assert.deepEqual(rollup, { rootId: 'root', targetCount: 2, progress: 38, status: 'in-progress' })
})

test('하위 업무를 가진 실행 업무도 별도 업무로 집계한다', () => {
  const nodes = [
    node('root', { kind: 'root', label: '루트', status: 'planned', progress: 0 }),
    node('parent-work', { kind: 'task', label: '상위 업무', isWork: true, progress: 90 }),
    node('leaf-1', { kind: 'task', label: '말단 1', isWork: true, progress: 100 }),
    node('leaf-2', { kind: 'task', label: '말단 2', isWork: true, progress: 0 }),
  ]
  const edges = [hierarchy('root', 'parent-work'), hierarchy('parent-work', 'leaf-1'), hierarchy('parent-work', 'leaf-2')]
  const rollup = computeWorkRollup(nodes, edges)
  assert.equal(rollup.targetCount, 3)
  assert.equal(rollup.progress, 63)
})

test('지식선은 계층으로 취급하지 않는다', () => {
  const nodes = [
    node('root', { kind: 'root', label: '루트', progress: 0 }),
    node('a', { kind: 'task', label: 'A', isWork: true, progress: 60 }),
    node('other', { kind: 'task', label: '다른 문서 참조', isWork: true, progress: 0 }),
  ]
  const edges = [hierarchy('root', 'a'), knowledge('other', 'a')]
  const rollup = computeWorkRollup(nodes, edges)
  assert.equal(rollup.targetCount, 1)
  assert.equal(rollup.progress, 60)
})

test('집계 대상 업무가 없으면 롤업하지 않는다', () => {
  const nodes = [
    node('root', { kind: 'root', label: '루트', status: 'in-progress', progress: 40 }),
    node('a', { kind: 'branch', label: '업무 아닌 카드', progress: 10 }),
  ]
  const map = { id: 'map-test', nodes, edges: [hierarchy('root', 'a')] }
  assert.equal(computeWorkRollup(nodes, map.edges), null)
  assert.equal(applyProgressRollup(map), map)
})

test('평균 100이면 최상위 카드를 done으로 변경한다', () => {
  const map = {
    id: 'map-test',
    nodes: [
      node('root', { kind: 'root', label: '루트', status: 'in-progress', progress: 50 }),
      node('a', { kind: 'task', label: 'A', isWork: true, progress: 100 }),
    ],
    edges: [hierarchy('root', 'a')],
  }
  const rolled = applyProgressRollup(map)
  const root = rolled.nodes.find((candidate) => candidate.id === 'root')
  assert.equal(root.data.progress, 100)
  assert.equal(root.data.status, 'done')
})

test('평균 0이면 진행률만 반영하고 기존 상태를 유지한다', () => {
  const map = {
    id: 'map-test',
    nodes: [
      node('root', { kind: 'root', label: '루트', status: 'planned', progress: 30 }),
      node('a', { kind: 'task', label: 'A', isWork: true, progress: 0 }),
    ],
    edges: [hierarchy('root', 'a')],
  }
  const rolled = applyProgressRollup(map)
  const root = rolled.nodes.find((candidate) => candidate.id === 'root')
  assert.equal(root.data.progress, 0)
  assert.equal(root.data.status, 'planned')
})

test('변경이 필요 없으면 원본 객체를 그대로 반환한다', () => {
  const map = {
    id: 'map-test',
    nodes: [
      node('root', { kind: 'root', label: '루트', status: 'in-progress', progress: 38 }),
      node('a', { kind: 'task', label: 'A', isWork: true, progress: 30 }),
      node('b', { kind: 'task', label: 'B', isWork: true, progress: 45 }),
    ],
    edges: [hierarchy('root', 'a'), hierarchy('root', 'b')],
  }
  assert.equal(applyProgressRollup(map), map)
})

test('계층 순환이 있어도 무한 루프에 빠지지 않는다', () => {
  const nodes = [
    node('root', { kind: 'root', label: '루트', progress: 0 }),
    node('a', { kind: 'task', label: 'A', isWork: true, progress: 20 }),
    node('b', { kind: 'task', label: 'B', isWork: true, progress: 40 }),
  ]
  const edges = [hierarchy('root', 'a'), hierarchy('a', 'b'), hierarchy('b', 'a')]
  const rollup = computeWorkRollup(nodes, edges)
  assert.equal(rollup.targetCount, 2)
  assert.equal(rollup.progress, 30)
})
