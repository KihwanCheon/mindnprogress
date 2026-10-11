const equal = (first, second) => JSON.stringify(first) === JSON.stringify(second)
const unsafeKeys = new Set(['__proto__', 'constructor', 'prototype'])

export class MapContentPatchError extends Error {
  constructor(message) {
    super(message)
    this.code = 'MAP_CONTENT_PATCH_INVALID'
  }
}

function invalid(message) { throw new MapContentPatchError(message) }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function validId(id) { return typeof id === 'string' && id.length > 0 && id.length <= 120 }
function assertIds(items, label) {
  if (!Array.isArray(items) || items.some((id) => !validId(id)) || new Set(items).size !== items.length) {
    invalid(`${label} 목록이 올바르지 않습니다.`)
  }
}
function assertRecords(items, label) {
  if (!Array.isArray(items) || items.some((item) => !object(item) || !validId(item.id))
    || new Set(items.map((item) => item.id)).size !== items.length) invalid(`${label} 목록이 올바르지 않습니다.`)
}
function byId(items) { return new Map(items.map((item) => [item.id, item])) }

export function createMapContentPatch(base, next) {
  const baseNodes = byId(base.nodes)
  const nextNodes = byId(next.nodes)
  const baseEdges = byId(base.edges)
  const nextEdges = byId(next.edges)
  const nodeAdds = next.nodes.filter((node) => !baseNodes.has(node.id))
  const nodeDeletes = base.nodes.filter((node) => !nextNodes.has(node.id)).map((node) => node.id)
  const nodeChanges = next.nodes.flatMap((node) => {
    const previous = baseNodes.get(node.id)
    if (!previous || equal(previous, node)) return []
    const set = {}
    const remove = []
    for (const key of new Set([...Object.keys(previous), ...Object.keys(node)])) {
      if (key === 'id' || key === 'data' || equal(previous[key], node[key])) continue
      if (Object.hasOwn(node, key) && node[key] !== undefined) set[key] = node[key]
      else remove.push(key)
    }
    const dataSet = {}
    const dataRemove = []
    const beforeData = previous.data ?? {}
    const afterData = node.data ?? {}
    for (const key of new Set([...Object.keys(beforeData), ...Object.keys(afterData)])) {
      if (equal(beforeData[key], afterData[key])) continue
      if (Object.hasOwn(afterData, key) && afterData[key] !== undefined) dataSet[key] = afterData[key]
      else dataRemove.push(key)
    }
    return [{ id: node.id, set, remove, dataSet, dataRemove }]
  })
  return {
    nodeAdds,
    nodeChanges,
    nodeDeletes,
    nodeOrder: next.nodes.map((node) => node.id),
    edgeUpserts: next.edges.filter((edge) => !equal(baseEdges.get(edge.id), edge)),
    edgeDeletes: base.edges.filter((edge) => !nextEdges.has(edge.id)).map((edge) => edge.id),
    edgeOrder: next.edges.map((edge) => edge.id),
  }
}

function assertSafeObject(value, label, forbidden = []) {
  if (!object(value) || Object.keys(value).some((key) => unsafeKeys.has(key) || forbidden.includes(key))) {
    invalid(`${label} 필드가 올바르지 않습니다.`)
  }
}
function assertSafeKeys(keys, label, forbidden = []) {
  if (!Array.isArray(keys) || keys.some((key) => typeof key !== 'string' || unsafeKeys.has(key) || forbidden.includes(key))
    || new Set(keys).size !== keys.length) invalid(`${label} 필드가 올바르지 않습니다.`)
}

export function applyMapContentPatch(base, patch) {
  if (!object(base) || !Array.isArray(base.nodes) || !Array.isArray(base.edges) || !object(patch)
    || Object.keys(patch).some((key) => !['nodeAdds', 'nodeChanges', 'nodeDeletes', 'nodeOrder', 'edgeUpserts', 'edgeDeletes', 'edgeOrder'].includes(key))) {
    invalid('문서 변경 형식이 올바르지 않습니다.')
  }
  assertRecords(patch.nodeAdds, '추가 카드')
  assertRecords(patch.nodeChanges, '변경 카드')
  assertIds(patch.nodeDeletes, '삭제 카드')
  assertIds(patch.nodeOrder, '카드 순서')
  assertRecords(patch.edgeUpserts, '변경 관계')
  assertIds(patch.edgeDeletes, '삭제 관계')
  assertIds(patch.edgeOrder, '관계 순서')
  const nodes = byId(base.nodes)
  const edges = byId(base.edges)
  const changedIds = new Set([...patch.nodeAdds, ...patch.nodeChanges].map((item) => item.id))
  if (patch.nodeDeletes.some((id) => changedIds.has(id))
    || patch.edgeDeletes.some((id) => patch.edgeUpserts.some((edge) => edge.id === id))) {
    invalid('같은 카드 또는 관계를 동시에 변경하고 삭제할 수 없습니다.')
  }
  for (const id of patch.nodeDeletes) {
    if (!nodes.delete(id)) invalid(`삭제할 카드가 없습니다: ${id}`)
  }
  for (const node of patch.nodeAdds) {
    if (nodes.has(node.id)) invalid(`이미 존재하는 카드입니다: ${node.id}`)
    nodes.set(node.id, structuredClone(node))
  }
  for (const change of patch.nodeChanges) {
    const current = nodes.get(change.id)
    if (!current) invalid(`변경할 카드가 없습니다: ${change.id}`)
    if (Object.keys(change).some((key) => !['id', 'set', 'remove', 'dataSet', 'dataRemove'].includes(key))) invalid('변경 카드 형식이 올바르지 않습니다.')
    assertSafeObject(change.set, '카드', ['id', 'data'])
    assertSafeKeys(change.remove, '카드 삭제', ['id', 'data'])
    assertSafeObject(change.dataSet, '카드 데이터')
    assertSafeKeys(change.dataRemove, '카드 데이터 삭제')
    if (change.remove.some((key) => Object.hasOwn(change.set, key))
      || change.dataRemove.some((key) => Object.hasOwn(change.dataSet, key))) invalid('같은 필드를 동시에 변경하고 삭제할 수 없습니다.')
    const updated = structuredClone(current)
    for (const key of change.remove) delete updated[key]
    for (const [key, value] of Object.entries(change.set)) updated[key] = structuredClone(value)
    updated.data = { ...(updated.data ?? {}) }
    for (const key of change.dataRemove) delete updated.data[key]
    for (const [key, value] of Object.entries(change.dataSet)) updated.data[key] = structuredClone(value)
    nodes.set(change.id, updated)
  }
  for (const id of patch.edgeDeletes) {
    if (!edges.delete(id)) invalid(`삭제할 관계가 없습니다: ${id}`)
  }
  for (const edge of patch.edgeUpserts) edges.set(edge.id, structuredClone(edge))
  if (patch.nodeOrder.length !== nodes.size || patch.nodeOrder.some((id) => !nodes.has(id))
    || patch.edgeOrder.length !== edges.size || patch.edgeOrder.some((id) => !edges.has(id))) {
    invalid('카드 또는 관계 순서가 변경 결과와 일치하지 않습니다.')
  }
  return {
    nodes: patch.nodeOrder.map((id) => nodes.get(id)),
    edges: patch.edgeOrder.map((id) => edges.get(id)),
  }
}
