import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyMapContentPatch, createMapContentPatch, MapContentPatchError } from '../src/utils/mapContentPatch.mjs'

const node = (id, description = '') => ({
  id, type: 'mind', position: { x: 0, y: 0 },
  data: { label: id, description, sharedKnowledge: `지식-${id}` },
})
const edge = (id, source, target) => ({ id, source, target, data: { relation: 'hierarchy' } })

test('긴 기존 description을 보내지 않고 카드 필드만 수정하며 원문을 보존한다', () => {
  const original = { nodes: [node('root', '가'.repeat(500_000)), node('task', '원본 설명')], edges: [edge('link', 'root', 'task')] }
  const changed = structuredClone(original)
  changed.nodes[1].data.label = '변경된 제목'
  changed.nodes[1].position.x = 240
  const patch = createMapContentPatch(original, changed)

  assert.ok(Buffer.byteLength(JSON.stringify(original)) > 1_500_000)
  assert.ok(Buffer.byteLength(JSON.stringify(patch)) < 1_000)
  assert.equal(JSON.stringify(patch).includes('가'.repeat(100)), false)
  assert.deepEqual(applyMapContentPatch(original, patch), changed)
  assert.equal(original.nodes[0].data.description.length, 500_000)
})

test('카드 추가·삭제·순서 변경과 관계 변경을 한 요청으로 적용한다', () => {
  const original = { nodes: [node('root'), node('old')], edges: [edge('old-edge', 'root', 'old')] }
  const changed = { nodes: [node('new', '새 카드'), node('root')], edges: [edge('new-edge', 'root', 'new')] }
  const patch = createMapContentPatch(original, changed)

  assert.deepEqual(applyMapContentPatch(original, patch), changed)
  assert.deepEqual(original.nodes.map((item) => item.id), ['root', 'old'])
})

test('본문 필드 변경과 삭제는 다른 카드 내용에 영향을 주지 않는다', () => {
  const original = { nodes: [node('root', '원본'), node('other', '보존')], edges: [] }
  const changed = structuredClone(original)
  changed.nodes[0].data.description = '수정된 설명'
  delete changed.nodes[0].data.sharedKnowledge
  const patch = createMapContentPatch(original, changed)

  assert.deepEqual(patch.nodeChanges[0].dataSet, { description: '수정된 설명' })
  assert.deepEqual(patch.nodeChanges[0].dataRemove, ['sharedKnowledge'])
  assert.deepEqual(applyMapContentPatch(original, patch), changed)
})

test('중복·누락·위험한 키를 가진 패치는 전체 변경을 거부한다', () => {
  const original = { nodes: [node('root')], edges: [] }
  const patch = createMapContentPatch(original, original)
  assert.throws(() => applyMapContentPatch(original, { ...patch, nodeOrder: ['root', 'root'] }), MapContentPatchError)
  assert.throws(() => applyMapContentPatch(original, { ...patch, nodeOrder: [] }), MapContentPatchError)
  assert.throws(() => applyMapContentPatch(original, {
    ...patch,
    nodeChanges: [{ id: 'root', set: {}, remove: [], dataSet: JSON.parse('{"__proto__":{"polluted":true}}'), dataRemove: [] }],
  }), MapContentPatchError)
  assert.equal({}.polluted, undefined)
})
