// 문서 소속은 목록 배치에서 읽는다. 총괄 설정 유무나 과거 위임의 groupId로 추측하지 않는다.
export function createDocumentGroupMetadata({ listMaps, readLayout, readMap, readProject }) {
  return async function readDocumentGroups(mapIds, supplied = {}) {
    const ids = [...new Set(mapIds)]
    if (!ids.length) return []
    const activeMaps = supplied.maps ?? await listMaps()
    const layout = supplied.layout ?? await readLayout(activeMaps.map((map) => map.id))
    const active = new Map(activeMaps.map((map) => [map.id, map]))
    const groups = new Map(layout.groups.flatMap((group) => group.mapIds.map((id) => [id, group])))
    const projects = new Map()
    const projectFor = (groupId) => {
      if (!projects.has(groupId)) projects.set(groupId, readProject(groupId))
      return projects.get(groupId)
    }
    return Promise.all(ids.map(async (mapId) => {
      const map = active.get(mapId) ?? await readMap(mapId)
      const membership = !map ? 'missing' : map.trashedAt ? 'trashed' : map.archivedAt ? 'archived'
        : map.reconstructionPending ? 'pending' : active.has(mapId) ? 'active' : 'unavailable'
      const group = membership === 'active' ? groups.get(mapId) : null
      const project = group ? await projectFor(group.id) : null
      const previousGroupKnown = membership === 'archived' && Object.hasOwn(map, 'originGroupId')
      return {
        mapId,
        group: group ? { id: group.id, name: group.name } : null,
        groupMembership: group ? 'grouped' : membership === 'active' ? 'ungrouped' : membership,
        groupProject: group && project.coordinatorMapId ? {
          groupId: group.id, name: group.name, coordinatorMapId: project.coordinatorMapId,
          role: project.coordinatorMapId === mapId ? 'coordinator' : 'document',
          contextTool: 'mindnprogress_get_group_context',
        } : null,
        ...(['archived', 'trashed', 'pending', 'missing'].includes(membership) ? {
          previousGroupKnown,
          previousGroupSource: previousGroupKnown ? 'archive-origin' : 'unknown',
          // 저장된 보관 원본 소속이며 가장 최근 보관 당시 소속을 보장하지 않는다. 과거 이름도 추측하지 않는다.
          previousGroup: previousGroupKnown && map.originGroupId ? { id: map.originGroupId, name: null } : null,
        } : {}),
      }
    }))
  }
}

export function documentGroupFields(context) {
  const { mapId: _mapId, ...fields } = context
  return fields
}
