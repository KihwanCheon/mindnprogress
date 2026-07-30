function valuesEqual(first, second) {
  return JSON.stringify(first) === JSON.stringify(second)
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isIdentifiedArray(value) {
  return value.every((item) => isPlainObject(item) && typeof item.id === 'string')
}

export function mergeChangedValue(base, local, remote) {
  if (valuesEqual(local, remote)) return { value: structuredClone(local), conflicts: 0 }
  if (valuesEqual(local, base)) return { value: structuredClone(remote), conflicts: 0 }
  if (valuesEqual(remote, base)) return { value: structuredClone(local), conflicts: 0 }

  if (Array.isArray(base) && Array.isArray(local) && Array.isArray(remote)
    && isIdentifiedArray(base) && isIdentifiedArray(local) && isIdentifiedArray(remote)) {
    const baseById = new Map(base.map((item) => [item.id, item]))
    const localById = new Map(local.map((item) => [item.id, item]))
    const remoteById = new Map(remote.map((item) => [item.id, item]))
    const ids = [...new Set([...local.map((item) => item.id), ...remote.map((item) => item.id), ...base.map((item) => item.id)])]
    let conflicts = 0
    const value = ids.flatMap((id) => {
      const merged = mergeChangedValue(baseById.get(id), localById.get(id), remoteById.get(id))
      conflicts += merged.conflicts
      return merged.value === undefined ? [] : [merged.value]
    })
    return { value, conflicts }
  }

  if (isPlainObject(base) && isPlainObject(local) && isPlainObject(remote)) {
    const keys = [...new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])]
    let conflicts = 0
    const value = {}
    for (const key of keys) {
      const merged = mergeChangedValue(base[key], local[key], remote[key])
      conflicts += merged.conflicts
      if (merged.value !== undefined) value[key] = merged.value
    }
    return { value, conflicts }
  }

  if (local === undefined && remote !== undefined) return { value: structuredClone(remote), conflicts: 1 }
  return { value: structuredClone(local), conflicts: 1 }
}

export function mergeMapContent(base, local, remote) {
  const nodes = mergeChangedValue(base.nodes, local.nodes, remote.nodes)
  const edges = mergeChangedValue(base.edges, local.edges, remote.edges)
  return {
    nodes: nodes.value,
    edges: edges.value,
    conflicts: nodes.conflicts + edges.conflicts,
  }
}
