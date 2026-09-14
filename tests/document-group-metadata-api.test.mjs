import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { expectedMcpToolNames } from './helpers/mcpToolNames.mjs'

test('HTTP·MCP에서 일반 그룹·총괄·이동·보관·휴지통과 원문 보존을 검증한다', { timeout: 60_000 }, async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'mnp-document-groups-'))
  const root = path.resolve(import.meta.dirname, '..')
  const fake = createServer((_request, response) => { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ conversations: [] })) })
  await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve))
  const probe = createServer(); await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port
  await new Promise((resolve) => probe.close(resolve))
  const base = `http://127.0.0.1:${port}`
  const env = { ...process.env, MNP_DATA_DIR: directory, MNP_TOKEN_FILE: path.join(directory, '_integration-token'),
    MNP_API_URL: base, MNP_API_HOST: '127.0.0.1', MNP_API_PORT: String(port), MNP_WEB_PORT: String(port),
    MNP_ADMIN_EMAIL: 'groups-test@mind.local', MNP_ADMIN_PASSWORD: 'TestOnly!2026', AIONUI_CONVERSATION_ID: '',
    MNP_MCP_USAGE_DISABLED: '1', MNP_WORKSPACE_POOL_REGISTRY: path.join(directory, 'no-pool.json'),
    MNP_AIONUI_URL: `http://127.0.0.1:${fake.address().port}`, MNP_AIONUI_DISCOVERY_FILE: path.join(directory, 'no-discovery.json') }
  let mcp, errors = ''
  const server = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
  server.stderr.on('data', (data) => { errors += data })
  t.after(async () => {
    await mcp?.close()
    if (server.exitCode === null) { const done = new Promise((resolve) => server.once('exit', resolve)); server.kill(); await done }
    await new Promise((resolve) => fake.close(resolve))
    assert.equal(path.dirname(directory), path.resolve(tmpdir())); assert.match(path.basename(directory), /^mnp-document-groups-/)
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  })
  let ready = false
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(base + '/api/health')).ok) { ready = true; break } } catch { /* 격리 서버 준비 */ }
    if (server.exitCode !== null) throw Error(errors)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.ok(ready, errors || '격리 서버 준비 실패')
  const headers = { Authorization: `Bearer ${(await readFile(env.MNP_TOKEN_FILE, 'utf8')).trim()}`, 'X-MNP-AI-Editor-Id': 'user-admin', 'Content-Type': 'application/json' }
  const api = async (url, method = 'GET', body) => {
    const response = await fetch(base + url, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const value = await response.json(); assert.ok(response.ok, JSON.stringify(value)); return value
  }
  assert.equal((await fetch(base + '/api/document-groups?mapId=map-test')).status, 401)
  assert.equal((await fetch(base + '/api/document-groups?mapId=../invalid', { headers })).status, 400)
  assert.equal((await fetch(base + '/api/document-groups?' + new URLSearchParams(Array.from({ length: 61 }, () => ['mapId', 'map-test'])), { headers })).status, 400)
  mcp = new Client({ name: 'document-group-test', version: '1' })
  await mcp.connect(new StdioClientTransport({ command: process.execPath, args: ['mcp/server.mjs'], cwd: root, env, stderr: 'pipe' }))
  assert.deepEqual((await mcp.listTools()).tools.map((tool) => tool.name).sort(), expectedMcpToolNames)
  const tool = async (suffix, args = {}) => {
    const result = await mcp.callTool({ name: 'mindnprogress_' + suffix, arguments: args })
    assert.equal(result.isError, undefined, JSON.stringify(result)); return JSON.parse(result.content[0].text)
  }
  const created = await tool('create_mindmap', {
    title: '그룹 검증 문서',
    cards: [{
      key: 'root',
      label: '검증 루트',
      kind: 'root',
      description: '보존할 사용자 요구사항',
      sharedKnowledge: '검토 후보를 만들기 위한 중복 테스트 지식입니다.\n'.repeat(2),
    }],
  })
  const mapId = created.document.id, cardId = created.rootCardId
  assert.equal(created.group, null); assert.equal(created.groupMembership, 'ungrouped')
  let library = await api('/api/maps')
  const group = { id: 'group-plain', name: '총괄 없는 일반 그룹', mapIds: [mapId] }
  await tool('save_document_layout', { documentLayout: { version: 1, groups: [group], items: [{ type: 'group', id: group.id }, ...library.maps.filter((map) => map.id !== mapId).map((map) => ({ type: 'map', id: map.id }))] } })
  const expectedGroup = { id: group.id, name: group.name }
  library = await tool('list_documents')
  assert.deepEqual(library.maps.find((map) => map.id === mapId).group, expectedGroup)
  assert.equal(library.maps.find((map) => map.id === mapId).groupProject, null)
  const original = await readFile(path.join(directory, mapId + '.json'))
  for (const [name, args] of [
    ['get_document', { mapId }], ['get_context', { mapId, cardId, aiType: 'TestFixture', aiModel: 'fixture-model' }],
    ['get_card', { mapId, cardId }], ['get_shared_knowledge_review_context', { mapId, cardId }],
    ['list_shared_knowledge_candidates', { mapId }],
    ['get_ai_work_states', { mapId }], ['list_ai_conversations', { mapId, cardId }], ['list_ai_delegations', { mapId }],
  ]) {
    const result = await tool(name, args)
    assert.deepEqual(result.group, expectedGroup, name); assert.equal(result.documentGroupsStatus, 'available', name)
    assert.equal(result.groupProject, null, name)
    if (result.document) assert.deepEqual(result.document.group, expectedGroup)
  }
  assert.deepEqual(await readFile(path.join(directory, mapId + '.json')), original, '그룹 조회는 카드·문서 원문을 저장하지 않는다')
  for (const responseMode of ['full', 'affected']) {
    const result = await tool('update_card', { mapId, cardId, data: { label: '검증 루트 ' + responseMode }, responseMode })
    assert.deepEqual((result.summary ?? result.document).group, expectedGroup)
    assert.equal(result.groupMembership, 'grouped')
  }
  const project = await tool('update_group_project', { groupId: group.id, baseVersion: 0, createCoordinator: true })
  const coordinatorId = project.coordinator.id
  assert.equal((await tool('get_document', { mapId: coordinatorId })).groupProject.role, 'coordinator')
  assert.equal((await tool('get_card', { mapId, cardId })).groupProject.role, 'document')
  const member = await tool('create_group_document', { groupId: group.id, baseVersion: project.project.version, title: '기능 문서', description: '승인된 테스트 범위' })
  assert.deepEqual(member.group, expectedGroup); assert.equal(member.groupProject.role, 'document')
  library = await api('/api/maps')
  const renamed = { ...library.documentLayout, groups: library.documentLayout.groups.map((item) => ({ ...item, name: '바뀐 그룹 이름' })) }
  await tool('save_document_layout', { documentLayout: renamed })
  assert.equal((await tool('get_card', { mapId, cardId })).group.name, '바뀐 그룹 이름')
  const memberPath = path.join(directory, member.map.id + '.json'), memberBefore = await readFile(memberPath)
  await tool('set_document_archive', { mapId: member.map.id, baseVersion: member.map.version, baseLifecycleVersion: 0, archived: true, reason: '테스트 보관' })
  const archived = (await tool('list_archived_documents')).maps.find((map) => map.id === member.map.id)
  assert.equal(archived.group, null); assert.equal(archived.groupMembership, 'archived')
  assert.equal(archived.previousGroupKnown, true); assert.deepEqual(archived.previousGroup, { id: group.id, name: null })
  assert.equal(archived.previousGroupSource, 'archive-origin')
  assert.deepEqual(await readFile(memberPath), memberBefore, '그룹 정보 제공을 위해 보관 원문을 다시 저장하지 않는다')
  await tool('set_document_archive', { mapId: member.map.id, baseVersion: member.map.version, baseLifecycleVersion: archived.lifecycleVersion, archived: false, reason: '테스트 복원' })
  assert.equal((await tool('get_document', { mapId: member.map.id })).group.id, group.id)
  await tool('set_document_trash_state', { mapId: member.map.id, state: 'trashed' })
  const trashed = (await tool('list_trash')).maps.find((map) => map.id === member.map.id)
  assert.equal(trashed.groupMembership, 'trashed'); assert.equal(trashed.previousGroupKnown, false, '휴지통 이동 당시 기록이 없으면 추측하지 않는다')
  await tool('set_document_trash_state', { mapId: member.map.id, state: 'active' })
  library = await api('/api/maps')
  await tool('save_document_layout', { documentLayout: { ...library.documentLayout,
    groups: library.documentLayout.groups.map((item) => ({ ...item, mapIds: item.mapIds.filter((id) => id !== mapId) })),
    items: [...library.documentLayout.items, { type: 'map', id: mapId }],
  } })
  const detached = await tool('get_document', { mapId })
  assert.equal(detached.group, null); assert.equal(detached.groupProject, null); assert.equal(detached.groupMembership, 'ungrouped')
  const missing = await api('/api/document-groups?mapId=map-no-document')
  assert.equal(missing.documentGroups[0].groupMembership, 'missing')
  const groupPath = path.join(directory, '_group-projects', group.id + '.json')
  const validProject = await readFile(groupPath)
  try {
    await writeFile(groupPath, '{invalid-test-json')
    const fallback = await api('/api/maps')
    assert.ok(fallback.maps.some((map) => map.id === coordinatorId), '그룹 설정 오류가 문서 목록을 차단하지 않는다')
    assert.equal(fallback.documentGroupsStatus, 'unavailable')
    assert.equal(Object.hasOwn(fallback.maps.find((map) => map.id === coordinatorId), 'group'), false)
    const mcpFallback = await tool('list_documents')
    assert.ok(mcpFallback.maps.some((map) => map.id === coordinatorId))
    assert.equal(mcpFallback.documentGroupsStatus, 'unavailable')
    assert.match(mcpFallback.documentGroupsWarning, /작업을 반복하지 말고/)
  } finally {
    await writeFile(groupPath, validProject)
  }
})
