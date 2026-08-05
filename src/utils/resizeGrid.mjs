function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value))
}

function snapValueToGrid(value, gridSize, minimum, maximum) {
  const firstGridValue = Math.ceil(minimum / gridSize) * gridSize
  const lastGridValue = Math.floor(maximum / gridSize) * gridSize
  if (firstGridValue > lastGridValue) return clamp(value, minimum, maximum)
  return clamp(Math.round(value / gridSize) * gridSize, firstGridValue, lastGridValue)
}

function anchoredResize(resize, width, height) {
  return {
    ...resize,
    x: resize.fromLeft ? resize.x + resize.width - width : resize.x,
    y: resize.fromTop ? resize.y + resize.height - height : resize.y,
    width,
    height,
  }
}

export function snapFreeResizeToGrid(resize, { gridSize, minWidth, minHeight, maxWidth, maxHeight }) {
  const width = resize.snapAxis === 'width' || resize.snapAxis === 'both'
    ? snapValueToGrid(resize.width, gridSize, minWidth, maxWidth)
    : clamp(resize.width, minWidth, maxWidth)
  const height = resize.snapAxis === 'height' || resize.snapAxis === 'both'
    ? snapValueToGrid(resize.height, gridSize, minHeight, maxHeight)
    : clamp(resize.height, minHeight, maxHeight)
  return anchoredResize(resize, width, height)
}

export function snapAspectResizeToGrid(resize, { gridSize, aspectRatio, minWidth, minHeight, maxWidth, maxHeight }) {
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    return snapFreeResizeToGrid(resize, { gridSize, minWidth, minHeight, maxWidth, maxHeight })
  }

  const aspectMinWidth = Math.max(minWidth, minHeight * aspectRatio)
  const aspectMaxWidth = Math.min(maxWidth, maxHeight * aspectRatio)
  const aspectMinHeight = Math.max(minHeight, minWidth / aspectRatio)
  const aspectMaxHeight = Math.min(maxHeight, maxWidth / aspectRatio)
  const width = snapValueToGrid(resize.width, gridSize, aspectMinWidth, aspectMaxWidth)
  const height = snapValueToGrid(resize.height, gridSize, aspectMinHeight, aspectMaxHeight)
  const widthCandidate = { width, height: width / aspectRatio }
  const heightCandidate = { width: height * aspectRatio, height }
  const widthScaleDifference = Math.abs(widthCandidate.width / resize.width - 1)
  const heightScaleDifference = Math.abs(heightCandidate.height / resize.height - 1)
  const selected = resize.snapAxis === 'height'
    ? heightCandidate
    : resize.snapAxis === 'both' && heightScaleDifference < widthScaleDifference
      ? heightCandidate
      : widthCandidate
  return anchoredResize(resize, selected.width, selected.height)
}
