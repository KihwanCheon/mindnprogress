export type ResizeSnapAxis = 'width' | 'height' | 'both'

export type ResizeSnapRequest = {
  x: number
  y: number
  width: number
  height: number
  fromLeft: boolean
  fromTop: boolean
  snapAxis?: ResizeSnapAxis
}

export type ResizeSnapOptions = {
  gridSize: number
  minWidth: number
  minHeight: number
  maxWidth: number
  maxHeight: number
}

export function snapFreeResizeToGrid(resize: ResizeSnapRequest, options: ResizeSnapOptions): ResizeSnapRequest
export function snapAspectResizeToGrid(resize: ResizeSnapRequest, options: ResizeSnapOptions & { aspectRatio: number }): ResizeSnapRequest
