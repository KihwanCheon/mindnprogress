export type RootDeletionNode = {
  id: string
  data?: { kind?: string }
}

export type RootDeletionEdge = {
  source: string
  target: string
  data?: { relation?: string }
}

export type RootDeletionPlan = {
  allowed: boolean
  reason: 'not-found' | 'root-has-no-child' | 'root-has-multiple-children' | null
  promotedNodeId: string | null
  message: string
}

export function rootDeletionPlan(
  nodes: RootDeletionNode[],
  edges: RootDeletionEdge[],
  nodeId: string,
): RootDeletionPlan
