import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mergeChangedValue, mergeMapContent } from '../src/utils/mergeMapContent.mjs'

const node = (id, data, position = { x: 0, y: 0 }) => ({ id, type: 'mind', position, data })
const edge = (source, target, relation) => ({
  id: `edge-${source}-${target}`,
  source,
  target,
  ...(relation ? { data: { relation } } : {}),
})

test('변경이 없으면 원본을 그대로 유지한다', () => {
  const base = [node('a', { label: '카드' })]
  const merged = mergeChangedValue(base, structuredClone(base), structuredClone(base))
  assert.deepEqual(merged.value, base)
  assert.equal(merged.conflicts, 0)
})

test('한쪽만 변경되면 변경된 쪽을 채택한다', () => {
  const base = [node('a', { label: '카드', progress: 0 })]
  const local = [node('a', { label: '카드', progress: 40 })]
  const merged = mergeChangedValue(base, local, structuredClone(base))
  assert.deepEqual(merged.value, local)
  assert.equal(merged.conflicts, 0)
})

test('서로 다른 필드 변경은 노드·필드 단위로 병합한다', () => {
  const base = [node('a', { label: '카드', progress: 0 })]
  const local = [node('a', { label: '수정된 카드', progress: 0 })]
  const remote = [node('a', { label: '카드', progress: 70 })]
  const merged = mergeChangedValue(base, local, remote)
  assert.deepEqual(merged.value, [node('a', { label: '수정된 카드', progress: 70 })])
  assert.equal(merged.conflicts, 0)
})

test('같은 필드가 서로 다르게 변경되면 내 변경을 유지하고 충돌을 센다', () => {
  const base = [node('a', { label: '카드' })]
  const local = [node('a', { label: '내 제목' })]
  const remote = [node('a', { label: '상대 제목' })]
  const merged = mergeChangedValue(base, local, remote)
  assert.deepEqual(merged.value, local)
  assert.equal(merged.conflicts, 1)
})

test('한쪽의 추가와 다른 쪽의 삭제를 함께 반영한다', () => {
  const base = [node('a', { label: 'A' }), node('b', { label: 'B' })]
  const local = [node('a', { label: 'A' })]
  const remote = [node('a', { label: 'A' }), node('b', { label: 'B' }), node('c', { label: 'C' })]
  const merged = mergeChangedValue(base, local, remote)
  assert.deepEqual(merged.value, [node('a', { label: 'A' }), node('c', { label: 'C' })])
  assert.equal(merged.conflicts, 0)
})

test('내가 삭제한 노드를 상대가 수정하면 상대 수정을 복원하고 충돌을 센다', () => {
  const base = [node('a', { label: 'A' }), node('b', { label: 'B' })]
  const local = [node('a', { label: 'A' })]
  const remote = [node('a', { label: 'A' }), node('b', { label: '수정된 B' })]
  const merged = mergeChangedValue(base, local, remote)
  assert.deepEqual(merged.value, remote)
  assert.equal(merged.conflicts, 1)
})

test('mergeMapContent는 노드와 엣지를 함께 병합하고 충돌 수를 합산한다', () => {
  const base = {
    nodes: [node('a', { label: 'A' })],
    edges: [edge('a', 'b')],
  }
  const local = {
    nodes: [node('a', { label: '내 A' })],
    edges: [edge('a', 'b'), edge('a', 'c', 'knowledge')],
  }
  const remote = {
    nodes: [node('a', { label: '상대 A' })],
    edges: [edge('a', 'b')],
  }
  const merged = mergeMapContent(base, local, remote)
  assert.deepEqual(merged.nodes, local.nodes)
  assert.deepEqual(merged.edges, local.edges)
  assert.equal(merged.conflicts, 1)
})

test('원본을 변형하지 않는다', () => {
  const base = { nodes: [node('a', { label: 'A' })], edges: [] }
  const local = { nodes: [node('a', { label: '내 A' })], edges: [] }
  const remote = { nodes: [node('a', { label: 'A' })], edges: [] }
  const localSnapshot = structuredClone(local)
  const merged = mergeMapContent(base, local, remote)
  merged.nodes[0].data.label = '병합 후 수정'
  assert.deepEqual(local, localSnapshot)
})
