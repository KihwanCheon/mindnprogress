export function completedReplacementDelegations(delegation, delegations) {
  const parentMapId = delegation?.parentMapId ?? delegation?.mapId
  const failedCleanLimit = ['waiting-usage-limit', 'waiting-rate-limit', 'waiting-model-capacity'].includes(delegation?.state)
    && (!delegation?.workspaceLease?.leaseId
      || ['failed-clean', 'cancelled'].includes(delegation?.workspaceResult?.status))
  const completedReportFailure = !delegation?.groupId
    && delegation?.state === 'parent-wake-failed'
    && delegation?.workCompleted === true
  if (!failedCleanLimit && !completedReportFailure) return []
  return (Array.isArray(delegations) ? delegations : [])
    .filter((candidate) => candidate?.id !== delegation?.id
      && candidate?.state === 'completed'
      && candidate?.workCompleted === true
      && (candidate?.groupId ?? null) === (delegation?.groupId ?? null)
      && candidate?.mapId === delegation?.mapId
      && (candidate?.parentMapId ?? candidate?.mapId) === parentMapId
      && candidate?.parentCardId === delegation?.parentCardId
      && candidate?.targetCardId === delegation?.targetCardId
      && String(candidate?.createdAt ?? '') > String(delegation?.createdAt ?? ''))
    .sort((first, second) => String(first.createdAt ?? '').localeCompare(String(second.createdAt ?? '')))
}

export function delegationHierarchyPathNodeIds(parentCardId, targetCardId, hierarchyEdges) {
  const result = new Set([parentCardId, targetCardId].filter(Boolean))
  if (!parentCardId || !targetCardId || parentCardId === targetCardId) return result

  const childrenById = new Map()
  const parentsById = new Map()
  for (const edge of Array.isArray(hierarchyEdges) ? hierarchyEdges : []) {
    if (!edge?.source || !edge?.target) continue
    childrenById.set(edge.source, [...(childrenById.get(edge.source) ?? []), edge.target])
    parentsById.set(edge.target, [...(parentsById.get(edge.target) ?? []), edge.source])
  }

  const reachableFromParent = new Set()
  const descendants = [parentCardId]
  while (descendants.length > 0) {
    const nodeId = descendants.pop()
    if (reachableFromParent.has(nodeId)) continue
    reachableFromParent.add(nodeId)
    descendants.push(...(childrenById.get(nodeId) ?? []))
  }

  const reachesTarget = new Set()
  const ancestors = [targetCardId]
  while (ancestors.length > 0) {
    const nodeId = ancestors.pop()
    if (reachesTarget.has(nodeId)) continue
    reachesTarget.add(nodeId)
    ancestors.push(...(parentsById.get(nodeId) ?? []))
  }

  for (const nodeId of reachableFromParent) {
    if (reachesTarget.has(nodeId)) result.add(nodeId)
  }
  return result
}

export function delegationPreviewEdgeState(edge, pathNodeIds) {
  if (!(pathNodeIds instanceof Set)) return ''
  return edge?.data?.relation !== 'knowledge'
    && pathNodeIds.has(edge?.source)
    && pathNodeIds.has(edge?.target)
    ? 'edge-linked'
    : 'edge-dimmed'
}

export function delegationPreviewNodeRole(preview, activeMapId, nodeId) {
  if (!preview || preview.target?.mapId !== activeMapId) return undefined
  if (preview.target.cardId === nodeId) return 'target'
  if (preview.parent?.mapId === activeMapId && preview.parent.cardId === nodeId) return 'source'
  return undefined
}
