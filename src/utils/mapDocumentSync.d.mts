export type MapContent<TNode, TEdge> = {
  nodes: TNode[]
  edges: TEdge[]
}

export type ReconciledMapContent<TNode, TEdge> = MapContent<TNode, TEdge> & {
  hadLocalChanges: boolean
  needsSave: boolean
  conflicts: number
}

export function mapContentsEqual<TNode, TEdge>(
  first: MapContent<TNode, TEdge>,
  second: MapContent<TNode, TEdge>,
): boolean

export function reconcileRemoteMapContent<TNode, TEdge>(
  base: MapContent<TNode, TEdge> | null | undefined,
  local: MapContent<TNode, TEdge>,
  remote: MapContent<TNode, TEdge>,
): ReconciledMapContent<TNode, TEdge>
