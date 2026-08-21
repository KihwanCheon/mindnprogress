export const BOX_SELECTION_DRAG_THRESHOLD = 4

export function isBoxSelectionDrag(start, current, threshold = BOX_SELECTION_DRAG_THRESHOLD) {
  return Math.hypot(current.x - start.x, current.y - start.y) > threshold
}

export function boxSelectionRect(start, current) {
  return {
    x: Math.min(start.x, current.x),
    y: Math.min(start.y, current.y),
    width: Math.abs(current.x - start.x),
    height: Math.abs(current.y - start.y),
  }
}

export function boxSelectionNodeIds(candidates, rect, { mode = 'partial' } = {}) {
  const left = rect.x
  const top = rect.y
  const right = rect.x + rect.width
  const bottom = rect.y + rect.height

  return candidates
    .filter((candidate) => {
      if (candidate.selectable === false) return false
      const candidateRight = candidate.x + candidate.width
      const candidateBottom = candidate.y + candidate.height
      if (mode === 'full') {
        return candidate.x >= left && candidate.y >= top && candidateRight <= right && candidateBottom <= bottom
      }
      return candidate.x < right && candidateRight > left && candidate.y < bottom && candidateBottom > top
    })
    .map((candidate) => candidate.id)
}

/*
 * 박스에 걸친 카드가 모두 선택되어 있으면 그 카드만 선택을 해제하고,
 * 하나라도 선택되지 않은 카드가 있으면 박스에 걸친 카드를 모두 선택한다.
 * 박스 밖의 기존 선택은 유지한다.
 */
export function applyBoxSelection(baseSelectedIds, boxNodeIds) {
  const selected = new Set(baseSelectedIds)
  const boxIds = [...new Set(boxNodeIds)]
  if (boxIds.length === 0) return [...selected]

  if (boxIds.every((id) => selected.has(id))) {
    for (const id of boxIds) selected.delete(id)
    return [...selected]
  }

  for (const id of boxIds) selected.add(id)
  return [...selected]
}
