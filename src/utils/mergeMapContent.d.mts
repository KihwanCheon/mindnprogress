export type MergeResult<T = unknown> = {
  value: T
  conflicts: number
}

export type MergeableMapContent<TNode, TEdge> = {
  nodes: TNode[]
  edges: TEdge[]
}

export function mergeChangedValue(base: unknown, local: unknown, remote: unknown): MergeResult

export function mergeMapContent<TNode, TEdge>(
  base: MergeableMapContent<TNode, TEdge>,
  local: MergeableMapContent<TNode, TEdge>,
  remote: MergeableMapContent<TNode, TEdge>,
): {
  nodes: TNode[]
  edges: TEdge[]
  conflicts: number
}
