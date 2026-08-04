export type TouchPoint = { x: number; y: number }
export type TouchViewport = { x: number; y: number; zoom: number }

export function touchPointCentroid(first: TouchPoint, second: TouchPoint): TouchPoint
export function touchPointDistance(first: TouchPoint, second: TouchPoint): number
export function viewportForTouchGesture(options: {
  startCentroid: TouchPoint
  currentCentroid: TouchPoint
  startDistance: number
  currentDistance: number
  viewport: TouchViewport
  minZoom: number
  maxZoom: number
}): TouchViewport
