function axisPan(start, end, visibleStart, visibleEnd) {
  const size = end - start
  const visibleSize = visibleEnd - visibleStart
  if (size > visibleSize) return (visibleStart + visibleEnd) / 2 - (start + end) / 2
  if (start < visibleStart) return visibleStart - start
  if (end > visibleEnd) return visibleEnd - end
  return 0
}

export function viewportForNodeVisibility({ viewport, node, viewportSize, padding = 48 }) {
  const zoom = Number(viewport?.zoom)
  const viewportWidth = Number(viewportSize?.width)
  const viewportHeight = Number(viewportSize?.height)
  if (!Number.isFinite(zoom) || zoom <= 0 || !Number.isFinite(viewportWidth) || !Number.isFinite(viewportHeight)
    || viewportWidth <= 0 || viewportHeight <= 0) return null

  const horizontalPadding = Math.min(Math.max(0, padding), viewportWidth / 2)
  const verticalPadding = Math.min(Math.max(0, padding), viewportHeight / 2)
  const left = node.x * zoom + viewport.x
  const top = node.y * zoom + viewport.y
  const right = left + node.width * zoom
  const bottom = top + node.height * zoom
  const deltaX = axisPan(left, right, horizontalPadding, viewportWidth - horizontalPadding)
  const deltaY = axisPan(top, bottom, verticalPadding, viewportHeight - verticalPadding)
  if (Math.abs(deltaX) < .01 && Math.abs(deltaY) < .01) return null
  return { x: viewport.x + deltaX, y: viewport.y + deltaY, zoom }
}
