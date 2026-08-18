export type ProgressRollup = {
  nodeId: string
  targetCount: number
  progress: number
  status: 'planned' | 'in-progress' | 'done'
}

type ProgressNode = {
  id: string
  data?: {
    kind?: string
    isWork?: boolean
    progress?: number
    status?: string
    reference?: unknown
    externalLink?: unknown
  }
}

type ProgressEdge = {
  source: string
  target: string
  data?: { relation?: string }
}

export function findRollupRoot<TNode extends ProgressNode>(nodes: readonly TNode[], edges: readonly ProgressEdge[]): TNode | null
export function computeProgressRollups(nodes: readonly ProgressNode[], edges: readonly ProgressEdge[]): ProgressRollup[]
export function computeWorkRollup(nodes: readonly ProgressNode[], edges: readonly ProgressEdge[]): (Omit<ProgressRollup, 'nodeId'> & { rootId: string }) | null
export function applyProgressRollup<TMap extends { nodes: ProgressNode[]; edges?: ProgressEdge[] }>(map: TMap): TMap
