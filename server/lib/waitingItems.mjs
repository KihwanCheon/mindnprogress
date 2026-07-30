// 카드 저장 전후의 waitingItems를 비교해 해제(제거)된 외부 대기 항목을 찾는다.
// 카드 자체가 삭제된 경우는 대기 해제가 아니므로 제외한다.

function normalizedWaitingItems(node) {
  if (!Array.isArray(node?.data?.waitingItems)) return []
  return node.data.waitingItems.filter((item) => typeof item?.label === 'string' && item.label.trim())
}

function waitingItemKey(item) {
  return typeof item?.id === 'string' && item.id.trim() ? `id:${item.id}` : `label:${item.label.trim()}`
}

export function detectReleasedWaitingItems(previousNodes, nodes) {
  const currentNodes = new Map((nodes ?? []).map((node) => [node.id, node]))
  const released = []
  for (const previousNode of previousNodes ?? []) {
    const currentNode = currentNodes.get(previousNode.id)
    if (!currentNode) continue
    const previousItems = normalizedWaitingItems(previousNode)
    if (previousItems.length === 0) continue
    const unmatchedCurrentItems = [...normalizedWaitingItems(currentNode)]
    for (const item of previousItems) {
      const itemKey = waitingItemKey(item)
      let matchedIndex = unmatchedCurrentItems.findIndex((candidate) => waitingItemKey(candidate) === itemKey)
      if (matchedIndex < 0) {
        const label = item.label.trim()
        matchedIndex = unmatchedCurrentItems.findIndex((candidate) => candidate.label.trim() === label)
      }
      if (matchedIndex >= 0) {
        unmatchedCurrentItems.splice(matchedIndex, 1)
        continue
      }
      released.push({
        nodeId: currentNode.id,
        nodeLabel: String(currentNode.data?.label ?? previousNode.data?.label ?? ''),
        assigneeId: typeof currentNode.data?.assigneeId === 'string' ? currentNode.data.assigneeId : null,
        item,
      })
    }
  }
  return released
}
