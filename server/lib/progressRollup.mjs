// 최상위 카드 진행률 롤업 규칙.
// 최상위 카드를 제외한 계층 안의 isWork=true 업무를 모두 동일 가중치로 평균해 반올림한다.
// 계층 안에서 단순히 업무를 묶는 카드는 branch 또는 isWork=false로 구성한다.
// 평균이 100이면 done, 1~99면 in-progress, 0이면 기존 상태를 유지하고,
// 집계 대상이 없으면 최상위 카드를 변경하지 않는다.

function isHierarchyEdge(edge) {
  return edge?.data?.relation !== 'knowledge'
}

function clampProgress(value) {
  const progress = Number(value)
  return Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0
}

export function findRollupRoot(nodes, edges) {
  const hierarchyTargets = new Set((edges ?? []).filter(isHierarchyEdge).map((edge) => edge.target))
  return (nodes ?? []).find((node) => node?.data?.kind === 'root' && !hierarchyTargets.has(node.id))
    ?? (nodes ?? []).find((node) => node?.data?.kind === 'root')
    ?? (nodes ?? []).find((node) => !hierarchyTargets.has(node?.id))
    ?? (nodes ?? [])[0]
    ?? null
}

function collectDescendantIds(rootId, edges) {
  const childrenByParent = new Map()
  for (const edge of edges ?? []) {
    if (!isHierarchyEdge(edge)) continue
    const children = childrenByParent.get(edge.source) ?? []
    children.push(edge.target)
    childrenByParent.set(edge.source, children)
  }
  const descendants = new Set()
  const stack = [...(childrenByParent.get(rootId) ?? [])]
  while (stack.length > 0) {
    const currentId = stack.pop()
    if (descendants.has(currentId)) continue
    descendants.add(currentId)
    stack.push(...(childrenByParent.get(currentId) ?? []))
  }
  return descendants
}

export function computeWorkRollup(nodes, edges) {
  const root = findRollupRoot(nodes, edges)
  if (!root) return null

  const descendants = collectDescendantIds(root.id, edges)
  const nodesById = new Map((nodes ?? []).map((node) => [node.id, node]))
  const targets = [...descendants]
    .map((nodeId) => nodesById.get(nodeId))
    .filter((node) => node?.data?.isWork === true)
  if (targets.length === 0) return null

  const total = targets.reduce((sum, node) => sum + clampProgress(node.data?.progress), 0)
  const progress = Math.round(total / targets.length)
  return {
    rootId: root.id,
    targetCount: targets.length,
    progress,
    status: progress >= 100 ? 'done' : progress > 0 ? 'in-progress' : null,
  }
}

export function applyProgressRollup(map) {
  if (!map || !Array.isArray(map.nodes) || map.nodes.length === 0) return map
  const rollup = computeWorkRollup(map.nodes, map.edges)
  if (!rollup) return map

  const root = map.nodes.find((node) => node.id === rollup.rootId)
  if (!root) return map
  const nextStatus = rollup.status ?? root.data?.status
  if (clampProgress(root.data?.progress) === rollup.progress && root.data?.status === nextStatus) return map

  return {
    ...map,
    nodes: map.nodes.map((node) => node.id === rollup.rootId
      ? { ...node, data: { ...node.data, progress: rollup.progress, ...(nextStatus ? { status: nextStatus } : {}) } }
      : node),
  }
}
