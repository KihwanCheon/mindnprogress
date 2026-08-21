export type BoxSelectionPoint = {
  x: number
  y: number
}

export type BoxSelectionRect = {
  x: number
  y: number
  width: number
  height: number
}

export type BoxSelectionCandidate = {
  id: string
  x: number
  y: number
  width: number
  height: number
  selectable?: boolean
}

export type BoxSelectionMode = 'partial' | 'full'

export const BOX_SELECTION_DRAG_THRESHOLD: number

export function isBoxSelectionDrag(start: BoxSelectionPoint, current: BoxSelectionPoint, threshold?: number): boolean
export function boxSelectionRect(start: BoxSelectionPoint, current: BoxSelectionPoint): BoxSelectionRect
export function boxSelectionNodeIds(
  candidates: BoxSelectionCandidate[],
  rect: BoxSelectionRect,
  options?: { mode?: BoxSelectionMode },
): string[]
export function applyBoxSelection(baseSelectedIds: Iterable<string>, boxNodeIds: Iterable<string>): string[]
