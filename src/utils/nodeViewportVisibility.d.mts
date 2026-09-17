type Viewport = { x: number; y: number; zoom: number }

export function viewportForNodeVisibility(input: {
  viewport: Viewport
  node: { x: number; y: number; width: number; height: number }
  viewportSize: { width: number; height: number }
  padding?: number
}): Viewport | null
