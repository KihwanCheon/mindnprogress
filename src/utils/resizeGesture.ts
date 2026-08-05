import type { ResizeDragEvent, ResizeParams } from '@xyflow/react'
import type { ResizeSnapAxis, ResizeSnapRequest } from './resizeGrid.mjs'

export type ResizeGesture = {
  start: ResizeParams
  snapAxis: ResizeSnapAxis
  snapActive: boolean
  fromLeft: boolean
  fromTop: boolean
}

export function beginResizeGesture(event: ResizeDragEvent, start: ResizeParams): ResizeGesture {
  const target = event.sourceEvent?.target
  const control = target instanceof Element ? target.closest('.react-flow__resize-control') : null
  const changesWidth = Boolean(control?.classList.contains('left') || control?.classList.contains('right'))
  const changesHeight = Boolean(control?.classList.contains('top') || control?.classList.contains('bottom'))
  return {
    start: { ...start },
    snapAxis: changesWidth && changesHeight ? 'both' : changesHeight ? 'height' : 'width',
    snapActive: Boolean(event.sourceEvent && 'altKey' in event.sourceEvent && event.sourceEvent.altKey),
    fromLeft: Boolean(control?.classList.contains('left')),
    fromTop: Boolean(control?.classList.contains('top')),
  }
}

function resizeGestureRequest(resize: ResizeParams, gesture: ResizeGesture | null, snapActive: boolean): ResizeSnapRequest {
  const start = gesture?.start
  return {
    ...resize,
    fromLeft: Boolean(gesture?.fromLeft || start && Math.abs(resize.x - start.x) > 0.01),
    fromTop: Boolean(gesture?.fromTop || start && Math.abs(resize.y - start.y) > 0.01),
    ...(snapActive ? { snapAxis: gesture?.snapAxis ?? 'both' } : {}),
  }
}

export function updateResizeGesture(event: ResizeDragEvent, resize: ResizeParams, gesture: ResizeGesture | null): ResizeSnapRequest {
  const altKey = Boolean(event.sourceEvent && 'altKey' in event.sourceEvent && event.sourceEvent.altKey)
  if (gesture) gesture.snapActive = altKey
  return resizeGestureRequest(resize, gesture, altKey)
}

export function finishResizeGesture(event: ResizeDragEvent, resize: ResizeParams, gesture: ResizeGesture | null): ResizeSnapRequest {
  const altKey = Boolean(event.sourceEvent && 'altKey' in event.sourceEvent && event.sourceEvent.altKey)
  return resizeGestureRequest(resize, gesture, altKey || gesture?.snapActive === true)
}
