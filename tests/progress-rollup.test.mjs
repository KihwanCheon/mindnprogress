import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyProgressRollup, computeProgressRollups, computeWorkRollup } from '../server/lib/progressRollup.mjs'

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
  const rolled = applyProgressRollup(map)
  assert.equal(rolled.nodes.find((candidate) => candidate.id === 'root').data.progress, 40)
  assert.equal(rolled.nodes.find((candidate) => candidate.id === 'a').data.progress, 0)
})

test('묶음 카드에서 마지막 하위 업무가 사라지면 낡은 자동 진행률을 초기화한다', () => {
  const map = {
    id: 'map-test',
    nodes: [
      node('root', { kind: 'root', label: '루트', status: 'in-progress', progress: 50 }),
      node('group', { kind: 'branch', label: '빈 묶음', isWork: false, status: 'in-progress', progress: 80 }),
    ],
    edges: [hierarchy('root', 'group')],
  }
  const rolled = applyProgressRollup(map)
  assert.equal(rolled.nodes.find((candidate) => candidate.id === 'group').data.progress, 0)
  assert.equal(rolled.nodes.find((candidate) => candidate.id === 'group').data.status, 'in-progress')
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

test('하위 업무가 시작되지 않았으면 최상위 카드도 예정 상태로 만든다', () => {
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

test('비업무 묶음 카드는 모든 하위 업무 진행률을 자동 집계한다', () => {
  const map = {
    id: 'map-test',
    nodes: [
      node('root', { kind: 'root', label: '루트', status: 'planned', progress: 0 }),
      node('group', { kind: 'branch', label: 'v0.3·v0.4 기획 변경 대응', isWork: false, status: 'planned', progress: 0 }),
      ...[73, 95, 83, 64, 80, 62, 25, 0].map((progress, index) => node(`work-${index}`, {
        kind: 'task',
        label: `업무 ${index}`,
        isWork: true,
        status: progress > 0 ? 'in-progress' : 'planned',
        progress,
      })),
    ],
    edges: [
      hierarchy('root', 'group'),
      ...Array.from({ length: 8 }, (_, index) => hierarchy('group', `work-${index}`)),
    ],
  }

  const rolled = applyProgressRollup(map)
  const group = rolled.nodes.find((candidate) => candidate.id === 'group')
  assert.equal(group.data.progress, 60)
  assert.equal(group.data.status, 'in-progress')
  assert.deepEqual(
    computeProgressRollups(map.nodes, map.edges).find((candidate) => candidate.nodeId === 'group'),
    { nodeId: 'group', targetCount: 8, progress: 60, status: 'in-progress' },
  )
})

test('중첩 묶음의 파생 진행률은 상위 집계에 중복 포함하지 않는다', () => {
  const nodes = [
    node('root', { kind: 'root', label: '루트', status: 'planned', progress: 0 }),
    node('group', { kind: 'branch', label: '묶음', isWork: false, status: 'planned', progress: 0 }),
    node('a', { kind: 'task', label: 'A', isWork: true, status: 'planned', progress: 0 }),
    node('b', { kind: 'task', label: 'B', isWork: true, status: 'done', progress: 100 }),
    node('c', { kind: 'task', label: 'C', isWork: true, status: 'done', progress: 100 }),
  ]
  const edges = [
    hierarchy('root', 'group'),
    hierarchy('group', 'a'),
    hierarchy('group', 'b'),
    hierarchy('root', 'c'),
  ]
  const rollups = computeProgressRollups(nodes, edges)
  assert.equal(rollups.find((candidate) => candidate.nodeId === 'group').progress, 50)
  assert.equal(rollups.find((candidate) => candidate.nodeId === 'root').progress, 67)
  assert.equal(rollups.find((candidate) => candidate.nodeId === 'root').targetCount, 3)
})

test('이미지, Ref, Dooray 지식 카드는 비업무여도 롤업 대상으로 만들지 않는다', () => {
  const nodes = [
    node('root', { kind: 'root', label: '루트', status: 'planned', progress: 0 }),
    node('image', { kind: 'image', label: '이미지', isWork: false, progress: 0 }),
    node('ref', { kind: 'branch', label: 'Ref', isWork: false, progress: 0, reference: { mapId: 'other', nodeId: 'source' } }),
    node('dooray', { kind: 'task', label: 'Dooray', isWork: false, progress: 0, externalLink: { provider: 'dooray-wiki' } }),
    node('a', { kind: 'task', label: 'A', isWork: true, status: 'in-progress', progress: 40 }),
  ]
  const edges = [
    hierarchy('root', 'image'),
    hierarchy('image', 'a'),
    hierarchy('root', 'ref'),
    hierarchy('ref', 'a'),
    hierarchy('root', 'dooray'),
    hierarchy('dooray', 'a'),
  ]
  const rollupIds = computeProgressRollups(nodes, edges).map((rollup) => rollup.nodeId)
  assert.deepEqual(rollupIds, ['root'])
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
    node('root', { kind: 'root', label: '루트', isWork: true, progress: 0 }),
    node('a', { kind: 'task', label: 'A', isWork: true, progress: 20 }),
    node('b', { kind: 'task', label: 'B', isWork: true, progress: 40 }),
  ]
  const edges = [hierarchy('root', 'a'), hierarchy('a', 'b'), hierarchy('b', 'a'), hierarchy('b', 'root')]
  const rollup = computeWorkRollup(nodes, edges)
  assert.equal(rollup.targetCount, 2)
  assert.equal(rollup.progress, 30)
})

test('다른 문서를 투영하는 Ref 카드는 이 문서 진행률에 넣지 않는다', () => {
  const nodes = [
    node('root', { kind: 'root', label: '루트', status: 'planned', progress: 0 }),
    node('a', { kind: 'task', label: '내 업무', isWork: true, progress: 40 }),
    node('ref', {
      kind: 'task',
      label: '남의 업무 (ref)',
      isWork: true,
      progress: 100,
      reference: { mapId: 'map-other', nodeId: 'node-other' },
    }),
  ]
  const edges = [hierarchy('root', 'a'), hierarchy('root', 'ref')]
  const rollup = computeWorkRollup(nodes, edges)
  assert.deepEqual(rollup, { rootId: 'root', targetCount: 1, progress: 40, status: 'in-progress' })
})

test('Ref 카드만 있는 묶음 카드는 집계 대상이 아니다', () => {
  const nodes = [
    node('root', { kind: 'root', label: '루트', status: 'planned', progress: 0 }),
    node('group', { kind: 'branch', label: '지식 묶음', progress: 0 }),
    node('ref', {
      kind: 'task',
      label: '남의 업무 (ref)',
      isWork: true,
      progress: 100,
      reference: { mapId: 'map-other', nodeId: 'node-other' },
    }),
  ]
  const edges = [hierarchy('root', 'group'), hierarchy('group', 'ref')]
  assert.deepEqual(computeProgressRollups(nodes, edges), [])
  assert.equal(computeWorkRollup(nodes, edges), null)
})
