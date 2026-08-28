function isHierarchyEdge(edge) {
  return edge?.data?.relation !== 'knowledge'
}

export function rootDeletionPlan(nodes, edges, nodeId) {
  const target = (nodes ?? []).find((node) => node?.id === nodeId)
  if (!target) return { allowed: false, reason: 'not-found', promotedNodeId: null, message: '' }
  if (target.data?.kind !== 'root') {
    return { allowed: true, reason: null, promotedNodeId: null, message: '' }
  }

  const existingNodeIds = new Set((nodes ?? []).map((node) => node?.id).filter(Boolean))
  const childIds = [...new Set((edges ?? [])
    .filter((edge) => isHierarchyEdge(edge) && edge?.source === nodeId && existingNodeIds.has(edge?.target))
    .map((edge) => edge.target))]

  if (childIds.length === 1) {
    return { allowed: true, reason: null, promotedNodeId: childIds[0], message: '' }
  }
  if (childIds.length === 0) {
    return {
      allowed: false,
      reason: 'root-has-no-child',
      promotedNodeId: null,
      message: '최상위 카드에 승격할 자식 카드가 없어 삭제할 수 없습니다. 문서 전체를 삭제하려면 문서 메뉴에서 휴지통으로 이동해 주세요.',
    }
  }
  return {
    allowed: false,
    reason: 'root-has-multiple-children',
    promotedNodeId: null,
    message: `최상위 카드의 직계 자식이 ${childIds.length}개여서 삭제할 수 없습니다. 최상위로 승격할 카드 하나만 남긴 뒤 다시 시도해 주세요.`,
  }
}
