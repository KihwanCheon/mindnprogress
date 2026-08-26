export type HierarchyDragEdge = {
  source: string
  target: string
}

export function dragRootIds(draggedNodeId: string, selectedNodeIds?: Iterable<string>): Set<string>
export function collectDragDescendantIds(
  rootIds: Iterable<string>,
  hierarchyEdges: HierarchyDragEdge[],
): Set<string>
