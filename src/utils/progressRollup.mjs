// 문서 Root와 일반 비업무 묶음 카드의 진행률 롤업 규칙.
// 각 후보 아래의 실제 isWork=true 업무만 동일 가중치로 집계하며,
// 중간 묶음 카드의 파생 진행률은 상위 집계에 다시 포함하지 않는다.

function isHierarchyEdge(edge) {
  return edge?.data?.relation !== 'knowledge'
}

function clampProgress(value) {
  const progress = Number(value)
  return Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0
}

function buildChildrenByParent(edges) {
  const childrenByParent = new Map()
  for (const edge of edges ?? []) {
    if (!isHierarchyEdge(edge)) continue
    const children = childrenByParent.get(edge.source) ?? []
    children.push(edge.target)
    childrenByParent.set(edge.source, children)
  }
  return childrenByParent
}

function collectDescendantIds(nodeId, childrenByParent) {
  const visited = new Set([nodeId])
  const descendants = []
  const stack = [...(childrenByParent.get(nodeId) ?? [])]
  while (stack.length > 0) {
    const currentId = stack.pop()
    if (visited.has(currentId)) continue
    visited.add(currentId)
    descendants.push(currentId)
    stack.push(...(childrenByParent.get(currentId) ?? []))
  }
  return descendants
}

function rollupStatus(targets) {
  if (targets.every((node) => clampProgress(node.data?.progress) >= 100)) return 'done'
  if (targets.some((node) => clampProgress(node.data?.progress) > 0
    || node.data?.status === 'in-progress'
    || node.data?.status === 'done')) return 'in-progress'
  return 'planned'
}

function canRollupNode(node, rootId) {
  if (!node) return false
  if (node.id === rootId) return true
  return node.data?.isWork !== true
    && node.data?.kind !== 'image'
    && !node.data?.reference
    && !node.data?.externalLink
}

export function findRollupRoot(nodes, edges) {
  const hierarchyTargets = new Set((edges ?? []).filter(isHierarchyEdge).map((edge) => edge.target))
  return (nodes ?? []).find((node) => node?.data?.kind === 'root' && !hierarchyTargets.has(node.id))
    ?? (nodes ?? []).find((node) => node?.data?.kind === 'root')
    ?? (nodes ?? []).find((node) => !hierarchyTargets.has(node?.id))
    ?? (nodes ?? [])[0]
    ?? null
}

export function computeProgressRollups(nodes, edges) {
  const root = findRollupRoot(nodes, edges)
  if (!root) return []

  const nodesById = new Map((nodes ?? []).map((node) => [node.id, node]))
  const childrenByParent = buildChildrenByParent(edges)
  return (nodes ?? []).flatMap((node) => {
    if (!canRollupNode(node, root.id)) return []
    const targets = collectDescendantIds(node.id, childrenByParent)
      .map((nodeId) => nodesById.get(nodeId))
      .filter((candidate) => candidate?.data?.isWork === true)
    if (targets.length === 0) return []

    const total = targets.reduce((sum, target) => sum + clampProgress(target.data?.progress), 0)
    return [{
      nodeId: node.id,
      targetCount: targets.length,
      progress: Math.round(total / targets.length),
      status: rollupStatus(targets),
    }]
  })
}

export function computeWorkRollup(nodes, edges) {
  const root = findRollupRoot(nodes, edges)
  if (!root) return null
  const rollup = computeProgressRollups(nodes, edges).find((candidate) => candidate.nodeId === root.id)
  return rollup ? {
    rootId: rollup.nodeId,
    targetCount: rollup.targetCount,
    progress: rollup.progress,
    status: rollup.status,
  } : null
}

export function applyProgressRollup(map) {
  if (!map || !Array.isArray(map.nodes) || map.nodes.length === 0) return map
  const root = findRollupRoot(map.nodes, map.edges)
  const rollups = new Map(computeProgressRollups(map.nodes, map.edges)
    .map((rollup) => [rollup.nodeId, rollup]))

  let changed = false
  const nodes = map.nodes.map((node) => {
    const rollup = rollups.get(node.id)
    if (rollup) {
      if (clampProgress(node.data?.progress) === rollup.progress && node.data?.status === rollup.status) return node
      changed = true
      return { ...node, data: { ...node.data, progress: rollup.progress, status: rollup.status } }
    }
    if (node.id !== root?.id && canRollupNode(node, root?.id) && clampProgress(node.data?.progress) !== 0) {
      changed = true
      return { ...node, data: { ...node.data, progress: 0 } }
    }
    return node
  })
  return changed ? { ...map, nodes } : map
}
