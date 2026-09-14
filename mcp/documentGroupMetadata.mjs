// 등록 도구 수는 유지하고 문서 탐색·편집 결과에만 읽기 전용 소속 메타데이터를 덧붙인다.
export const groupAwareToolNames = new Set([
  'list_documents', 'list_archived_documents', 'list_trash', 'get_document', 'get_context', 'get_card',
  'list_shared_knowledge_candidates', 'get_shared_knowledge_review_context', 'apply_shared_knowledge_review',
  'create_document', 'create_mindmap', 'create_group_document', 'save_document', 'update_document_info',
  'add_card', 'update_card', 'patch_card_text', 'move_card', 'delete_card',
  'get_ai_work_states', 'list_ai_conversations', 'get_ai_conversation_transcript', 'list_ai_delegations',
  'delegate_ai_work', 'complete_ai_delegation', 'recover_ai_delegation', 'refresh_ai_delegation',
  'retry_ai_delegation_report', 'finalize_ai_coordination', 'supersede_ai_delegation',
  'set_document_archive', 'restore_document', 'restore_history', 'move_document_to_trash',
  'delete_trashed_documents', 'empty_trash', 'reorder_documents', 'save_document_layout',
  'get_reconstruction_context', 'get_reconstruction_request', 'submit_reconstruction_proposal',
  'preview_reconstruction', 'apply_reconstruction', 'get_reconstructions', 'rollback_reconstruction',
  'get_card_layout_request', 'submit_card_layout_proposal', 'get_dooray_response_approval', 'list_notifications',
].map((name) => `mindnprogress_${name}`))

const mapIdPattern = /^map-[a-zA-Z0-9_-]+$/
const objectKeys = ['map', 'summary', 'document', 'maps', 'trash', 'documents', 'sources', 'targets',
  'candidates', 'notifications', 'card', 'coordinator', 'route', 'launchTarget', 'delegation', 'delegations', 'operation', 'operations']
const idKeys = ['mapId', 'parentMapId', 'targetMapId', 'trashedId']
const idListKeys = ['mapIds', 'sourceMapIds', 'targetMapIds', 'deletedIds']

export function resultDocumentIds(input, result) {
  const ids = new Set()
  const add = (id) => { if (typeof id === 'string' && id.length <= 120 && mapIdPattern.test(id)) ids.add(id) }
  const visit = (value, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 6) return
    if (Array.isArray(value)) { value.forEach((item) => visit(item, depth + 1)); return }
    add(value.id)
    idKeys.forEach((key) => add(value[key]))
    idListKeys.forEach((key) => { if (Array.isArray(value[key])) value[key].forEach(add) })
    objectKeys.forEach((key) => visit(value[key], depth + 1))
  }
  visit(result)
  // 새 문서는 결과에서 찾고 기존 문서의 작업 대상은 입력으로 보완한다. 본문·승인·계획은 탐색하지 않는다.
  idKeys.forEach((key) => add(input?.[key]))
  if (Array.isArray(input?.mapIds)) input.mapIds.forEach(add)
  return [...ids]
}

export async function withDocumentGroupMetadata(name, input, result, lookup) {
  if (!groupAwareToolNames.has(name) || !result || typeof result !== 'object' || Array.isArray(result)) return result
  const ids = resultDocumentIds(input, result)
  if (!ids.length) return result
  try {
    const known = new Map((result.documentGroups ?? []).map((entry) => [entry.mapId, entry]))
    const missing = ids.filter((id) => !known.has(id))
    // GET URL이 HTTP 헤더 한도를 넘지 않도록 최대 길이 ID도 안전한 개수로 나눈다.
    for (let offset = 0; offset < missing.length; offset += 60) {
      const entries = await lookup(missing.slice(offset, offset + 60))
      entries.forEach((entry) => known.set(entry.mapId, entry))
    }
    if (ids.some((id) => !known.has(id))) throw new Error('그룹 조회 결과에 문서가 누락되었습니다.')
    const enrich = (value) => {
      const context = known.get(value?.mapId ?? value?.id)
      if (!context) return value
      const { mapId: _mapId, ...fields } = context
      return { ...value, ...fields }
    }
    const next = { ...result, documentGroups: ids.map((id) => known.get(id)), documentGroupsStatus: 'available' }
    // 원본 map/nodes, 승인·계획·해시 대상은 수정하지 않는다. 문서 요약과 검색 결과만 확장한다.
    for (const key of ['document', 'summary']) if (result[key]) next[key] = enrich(result[key])
    for (const key of ['maps', 'trash', 'candidates', 'notifications']) if (Array.isArray(result[key])) next[key] = result[key].map(enrich)
    const primary = known.get(input?.mapId ?? result.map?.id ?? result.document?.id ?? result.summary?.id ?? result.mapId)
    if (primary) {
      next.group = primary.group
      next.groupMembership = primary.groupMembership
      // get_context의 총괄 전용 지침 등 기존 groupProject의 의미를 덮어쓰지 않는다.
      if (!Object.hasOwn(result, 'groupProject')) next.groupProject = primary.groupProject
    }
    return next
  } catch {
    // 저장·위임 성공 후 부가 정보 조회 실패를 작업 실패로 오인해 재실행하지 않도록 한다.
    return { ...result, documentGroupsStatus: 'unavailable',
      documentGroupsWarning: '그룹 정보만 확인하지 못했습니다. 원래 작업 결과는 유지됩니다. 작업을 반복하지 말고 mindnprogress_list_documents 또는 mindnprogress_get_document로 소속을 다시 확인하세요.' }
  }
}
