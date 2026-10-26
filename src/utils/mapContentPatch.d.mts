export class MapContentPatchError extends Error {
  code: 'MAP_CONTENT_PATCH_INVALID'
}

export function createMapContentPatch<TNode extends { id: string }, TEdge extends { id: string }>(
  base: { nodes: TNode[]; edges: TEdge[] },
  next: { nodes: TNode[]; edges: TEdge[] },
): unknown

export function applyMapContentPatch<TNode extends { id: string }, TEdge extends { id: string }>(
  base: { nodes: TNode[]; edges: TEdge[] },
  patch: unknown,
): { nodes: TNode[]; edges: TEdge[] }
