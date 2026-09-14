import assert from 'node:assert/strict'
import test from 'node:test'
import { createDocumentGroupMetadata } from '../server/lib/documentGroupMetadata.mjs'
import { groupAwareToolNames, resultDocumentIds, withDocumentGroupMetadata } from '../mcp/documentGroupMetadata.mjs'
import { expectedMcpToolNames } from './helpers/mcpToolNames.mjs'

test('일반 그룹·총괄 역할·미소속과 과거 소속을 구분하며 그룹 설정은 한 번만 읽는다', async () => {
  const maps = [{ id: 'map-a' }, { id: 'map-b' }, { id: 'map-c' }, { id: 'map-d' }]
  const layout = { groups: [{ id: 'group-plain', name: '일반 그룹', mapIds: ['map-a'] }, { id: 'group-project', name: '개발 그룹', mapIds: ['map-b', 'map-c'] }] }
  const inactive = { 'map-archived': { archivedAt: 'now', originGroupId: 'group-deleted' }, 'map-archive-alone': { archivedAt: 'now', originGroupId: null }, 'map-trash': { trashedAt: 'now' }, 'map-pending': { reconstructionPending: true } }
  const reads = []
  const read = createDocumentGroupMetadata({ listMaps: async () => maps, readLayout: async () => layout, readMap: async (id) => inactive[id],
    readProject: async (id) => { reads.push(id); return { coordinatorMapId: id === 'group-project' ? 'map-b' : null, instructions: '응답에 포함하지 않는 장문' } } })
  const result = await read([...maps.map((map) => map.id), ...Object.keys(inactive), 'map-missing', 'map-a'])
  assert.equal(result.length, 9)
  assert.deepEqual(result[0].group, { id: 'group-plain', name: '일반 그룹' }); assert.equal(result[0].groupProject, null)
  assert.equal(result[1].groupProject.role, 'coordinator'); assert.equal(result[2].groupProject.role, 'document')
  assert.equal(result[3].groupMembership, 'ungrouped'); assert.equal(result[3].group, null)
  assert.equal(result[4].group, null); assert.equal(result[4].groupMembership, 'archived'); assert.equal(result[4].previousGroupKnown, true)
  assert.deepEqual(result[4].previousGroup, { id: 'group-deleted', name: null })
  assert.equal(result[4].previousGroupSource, 'archive-origin')
  assert.equal(result[5].previousGroupKnown, true); assert.equal(result[5].previousGroup, null)
  assert.equal(result[6].groupMembership, 'trashed'); assert.equal(result[6].previousGroupKnown, false)
  assert.equal(result[6].previousGroupSource, 'unknown')
  assert.equal(result[7].groupMembership, 'pending'); assert.equal(result[8].groupMembership, 'missing')
  assert.deepEqual(reads.sort(), ['group-plain', 'group-project'])
  assert.equal(JSON.stringify(result).includes('응답에 포함하지 않는 장문'), false)
  layout.groups[0].name = '변경한 이름'; layout.groups[0].mapIds = []
  assert.equal((await read(['map-a']))[0].groupMembership, 'ungrouped', '이전 요청의 소속 캐시를 재사용하지 않는다')
})

const context = (mapId) => ({ mapId, group: { id: 'group-current', name: '현재 그룹' }, groupMembership: 'grouped', groupProject: null })
test('현재 소속을 추가하되 원문·승인·재구성 계획·과거 위임을 변경하지 않는다', async () => {
  const map = { id: 'map-a', nodes: [{ data: { description: '사용자 요구사항', reference: { mapId: 'map-unrelated' } } }], edges: [] }
  const result = { map, document: { id: 'map-a', version: 3 }, groupProject: { instruction: '총괄 전용 지침' },
    delegation: { mapId: 'map-a', parentMapId: 'map-b', groupId: 'group-original' },
    plan: { sources: [{ mapId: 'map-not-target', sha256: 'original' }] }, approval: { mapId: 'map-approval', statement: '기존 승인' } }
  const before = structuredClone(result)
  const output = await withDocumentGroupMetadata('mindnprogress_delegate_ai_work', { mapId: 'map-b' }, result, async (ids) => ids.map(context))
  assert.deepEqual(result, before); assert.equal(output.map, map); assert.equal(output.plan, result.plan); assert.equal(output.approval, result.approval)
  assert.equal(output.delegation, result.delegation); assert.equal(output.delegation.groupId, 'group-original')
  assert.deepEqual(output.groupProject, result.groupProject); assert.deepEqual(output.document.group, context('map-a').group)
  assert.deepEqual(output.documentGroups.map((item) => item.mapId), ['map-a', 'map-b'])
})

test('조회 부가 정보 실패가 저장 성공을 뒤집지 않고 미소속으로 위장하지 않는다', async () => {
  const result = { summary: { id: 'map-a', version: 8 }, saved: true }
  const output = await withDocumentGroupMetadata('mindnprogress_save_document', { mapId: 'map-a' }, result, async () => { throw Error('조회 실패') })
  assert.equal(output.saved, true); assert.equal(output.summary.version, 8)
  assert.equal(output.documentGroupsStatus, 'unavailable'); assert.match(output.documentGroupsWarning, /작업을 반복하지 말고/)
  assert.equal(Object.hasOwn(output, 'group'), false); assert.equal(Object.hasOwn(output.summary, 'group'), false)
})

test('기존 메타데이터는 재사용하고 대량 조회는 제한된 GET 요청으로 나눈다', async () => {
  const result = { maps: Array.from({ length: 125 }, (_, i) => ({ id: 'map-' + i })), documentGroups: [context('map-0')] }
  const batches = []
  const output = await withDocumentGroupMetadata('mindnprogress_list_documents', {}, result, async (ids) => { batches.push(ids); return ids.map(context) })
  assert.deepEqual(batches.map((ids) => ids.length), [60, 60, 4])
  assert.equal(output.maps.every((map) => map.group.id === 'group-current'), true)
  assert.equal(output.documentGroups.length, 125)
  await withDocumentGroupMetadata('mindnprogress_list_documents', {}, output, async () => assert.fail('불필요한 재조회'))
})

test('신규 문서·재구성·원본과 대상 문서를 식별하되 본문 경로를 문서 ID로 해석하지 않는다', () => {
  assert.deepEqual(resultDocumentIds({ mapId: 'map-source', plan: { mapId: 'map-plan' } }, {
    operation: { sources: [{ mapId: 'map-source' }], targetMapIds: ['map-new'] },
    route: { mapId: 'map-route' }, nodes: [{ id: 'map-card' }], transcript: 'map-text', id: 'layout-request-123',
  }), ['map-route', 'map-new', 'map-source'])
})

test('70개 도구의 등록은 유지하고 불필요한 도구에는 그룹 조회를 추가하지 않는다', async () => {
  assert.equal(expectedMcpToolNames.length, 70)
  for (const name of groupAwareToolNames) assert.ok(expectedMcpToolNames.includes(name), name)
  for (const suffix of ['get_ai_workspace_pool', 'checkpoint_ai_workspace', 'confirm_ai_workspace_no_changes', 'list_users', 'list_comments', 'toggle_comment_reaction', 'add_knowledge_line']) {
    const result = { mapId: 'map-a', ok: true }
    assert.equal(await withDocumentGroupMetadata('mindnprogress_' + suffix, {}, result, async () => assert.fail('불필요한 조회')), result)
  }
})
