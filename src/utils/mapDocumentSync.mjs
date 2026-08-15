import { mergeMapContent } from './mergeMapContent.mjs'

function mapContent(document) {
  return {
    nodes: document.nodes,
    edges: document.edges,
  }
}

export function mapContentsEqual(first, second) {
  return JSON.stringify(mapContent(first)) === JSON.stringify(mapContent(second))
}

export function reconcileRemoteMapContent(base, local, remote) {
  if (!base || mapContentsEqual(base, local)) {
    return {
      nodes: structuredClone(remote.nodes),
      edges: structuredClone(remote.edges),
      hadLocalChanges: false,
      needsSave: false,
      conflicts: 0,
    }
  }

  const merged = mergeMapContent(base, local, remote)
  const needsSave = !mapContentsEqual(merged, remote)
  return {
    nodes: merged.nodes,
    edges: merged.edges,
    hadLocalChanges: true,
    needsSave,
    conflicts: merged.conflicts,
  }
}
