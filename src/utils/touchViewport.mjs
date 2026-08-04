export function touchPointCentroid(first, second) {
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  }
}

export function touchPointDistance(first, second) {
  return Math.hypot(second.x - first.x, second.y - first.y)
}

export function viewportForTouchGesture({
  startCentroid,
  currentCentroid,
  startDistance,
  currentDistance,
  viewport,
  minZoom,
  maxZoom,
}) {
  const safeStartDistance = Math.max(1, startDistance)
  const zoom = Math.min(maxZoom, Math.max(minZoom, viewport.zoom * currentDistance / safeStartDistance))
  const anchor = {
    x: (startCentroid.x - viewport.x) / viewport.zoom,
    y: (startCentroid.y - viewport.y) / viewport.zoom,
  }

  return {
    x: currentCentroid.x - anchor.x * zoom,
    y: currentCentroid.y - anchor.y * zoom,
    zoom,
  }
}
