import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const testDataDirectory = path.resolve(projectDirectory, '.mcp-test-data')
const expectedPrefix = `${projectDirectory}${path.sep}`
if (!testDataDirectory.startsWith(expectedPrefix) || path.basename(testDataDirectory) !== '.mcp-test-data') {
  throw new Error('MCP 테스트 데이터 경로가 프로젝트 내부의 전용 디렉터리가 아닙니다.')
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const probe = createNetServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address ? address.port : null
      probe.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

async function startMockAionUi({
  agentId = 'agent-claude-test',
  agentName = 'Claude Code',
  modelId = 'claude-test-model',
  modelName = 'Claude Test Model',
  conversationId = 'conversation-test',
  conversationCreatedAt = Date.parse('2026-07-20T00:00:00.000Z'),
  conversationModelId = `${modelId}[1m]`,
} = {}) {
  let conversationRuntimeState = 'running'
  const dispatchRequests = []
  const dispatches = new Map()
  const server = createHttpServer((request, response) => {
    const send = (data, status = 200) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ success: true, data }))
    }
    if (request.url === '/api/agents/management') {
      return send([{
        id: agentId,
        name: agentName,
        agent_type: 'acp',
        backend: 'claude',
        installed: true,
        enabled: true,
        available_models: {
          current_model_id: modelId,
          available_models: [{ value: modelId, name: modelName }],
        },
      }])
    }
    if (request.url === '/api/providers') return send([])
    if (request.url === '/api/skills') return send([])
    if (request.url === '/api/mcp/servers') return send([])
    if (request.url === '/api/internal/conversation-runtimes/active') {
      return send({
        schema_version: 1,
        generated_at: Date.now(),
        items: conversationRuntimeState === 'running'
          ? [{
              conversation_id: conversationId,
              runtime: {
                state: 'running',
                is_processing: true,
                task_status: 'running',
                pending_confirmations: 0,
                turn_id: 'turn-mcp-runtime-test',
              },
            }]
          : [],
      })
    }
    if (request.url === `/api/conversations/${conversationId}`) {
      return send({
        id: conversationId,
        name: 'MCP 전체 대화 조회 검증',
        type: 'acp',
        created_at: conversationCreatedAt,
        modified_at: conversationCreatedAt + 60_000,
        extra: { agent_id: agentId, current_model_id: conversationModelId, backend: 'claude' },
        runtime: {
          state: conversationRuntimeState,
          is_processing: conversationRuntimeState === 'running',
          task_status: conversationRuntimeState === 'running' ? 'running' : 'finished',
          can_send_message: conversationRuntimeState === 'idle',
          pending_confirmations: 0,
          turn_id: conversationRuntimeState === 'running' ? 'turn-mcp-runtime-test' : null,
        },
      })
    }
    if (request.url === '/api/conversations/conversation-delegated') {
      return send({
        id: 'conversation-delegated',
        name: '위임 하위 카드',
        type: 'acp',
        created_at: conversationCreatedAt + 120_000,
        modified_at: conversationCreatedAt + 180_000,
        extra: { agent_id: agentId, current_model_id: modelId, backend: 'claude' },
        runtime: {
          state: 'idle', is_processing: false, task_status: 'finished', can_send_message: true,
          pending_confirmations: 0, turn_id: null,
        },
      })
    }
    if (request.url === '/api/conversations/conversation-inspected-card') {
      return send({
        id: 'conversation-inspected-card',
        name: '추가 조회 카드 대화',
        type: 'acp',
        created_at: conversationCreatedAt + 90_000,
        modified_at: conversationCreatedAt + 100_000,
        extra: { agent_id: agentId, current_model_id: modelId, backend: 'claude' },
        runtime: {
          state: 'idle', is_processing: false, task_status: 'finished', can_send_message: true,
          pending_confirmations: 0, turn_id: null,
        },
      })
    }
    if (request.url === `/api/conversations/${conversationId}/messages?limit=10000&content_mode=full`) {
      return send({
        items: [
          { id: 'message-user', type: 'text', position: 'right', content: { content: '첫 사용자 요청' } },
          { id: 'message-tool', type: 'acp_tool_call', position: 'left', content: { name: 'internal_tool' } },
          { id: 'message-tip', type: 'tips', position: 'center', content: '중간 시스템 안내' },
          { id: 'message-assistant', type: 'text', position: 'left', content: '최종 어시스턴트 응답' },
        ],
        oldest_cursor: 'message-user',
        newest_cursor: 'message-assistant',
        has_more_before: false,
        has_more_after: false,
      })
    }
    if (request.url === '/api/conversations/conversation-delegated/messages?limit=100&content_mode=full') {
      return send({
        items: [
          { id: 'delegated-user', type: 'text', position: 'right', content: '하위 작업 지시' },
          { id: 'delegated-assistant', type: 'text', position: 'left', content: '하위 카드 작업을 완료하고 결과를 기록했습니다.' },
        ],
      })
    }
    if (request.method === 'POST' && request.url === '/api/internal/external-conversation-dispatches') {
      const chunks = []
      request.on('data', (chunk) => chunks.push(chunk))
      request.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        const existing = dispatches.get(body.operationId)
        if (existing) {
          send({ ...existing, repeated: true }, 200)
          return
        }
        dispatchRequests.push(body)
        const targetConversationId = body.strategy === 'new' ? 'conversation-delegated' : body.targetConversationId
        const stored = {
          operationId: body.operationId,
          conversationId: targetConversationId,
          state: body.operationId.endsWith('-wake') ? 'completed' : 'running',
          turnId: `turn-${body.operationId}`,
          repeated: false,
        }
        dispatches.set(body.operationId, stored)
        send({ ...stored, state: 'starting', turnId: null }, 202)
      })
      return
    }
    const dispatchStatusMatch = request.url?.match(/^\/api\/internal\/external-conversation-dispatches\/([^/?]+)$/)
    if (request.method === 'GET' && dispatchStatusMatch) {
      const dispatch = dispatches.get(decodeURIComponent(dispatchStatusMatch[1]))
      if (dispatch) return send(dispatch)
    }
    response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify({ success: false, error: 'not found' }))
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert.ok(typeof address === 'object' && address, '가짜 AionUi 포트를 할당하지 못했습니다.')
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    dispatchRequests,
    setConversationRuntimeState: (state) => { conversationRuntimeState = state },
    completeDispatch: (operationId) => {
      const dispatch = dispatches.get(operationId)
      assert.ok(dispatch, `완료할 위임 operation을 찾지 못했습니다: ${operationId}`)
      dispatches.set(operationId, { ...dispatch, state: 'completed' })
    },
    setDispatchState: (operationId, state, resource = null) => {
      const dispatch = dispatches.get(operationId)
      assert.ok(dispatch, `상태를 변경할 위임 operation을 찾지 못했습니다: ${operationId}`)
      dispatches.set(operationId, { ...dispatch, state, resource })
    },
  }
}

async function publishMockAionUiDiscovery(discoveryFile, mockAionUi) {
  const port = Number(new URL(mockAionUi.baseUrl).port)
  await writeFile(discoveryFile, `${JSON.stringify({
    schemaVersion: 1,
    host: '127.0.0.1',
    port,
    pid: process.pid,
    updatedAt: new Date().toISOString(),
  })}\n`, 'utf8')
}

async function waitForServer(baseUrl, child, logs) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 10_000) {
    if (child.exitCode !== null) throw new Error(`격리 API 서버가 종료되었습니다.\n${logs.join('')}`)
    try {
      const response = await fetch(`${baseUrl}/api/health`)
      if (response.ok) return
    } catch {
      // 서버가 수신 준비를 마칠 때까지 재시도합니다.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`격리 API 서버 시작 시간이 초과되었습니다.\n${logs.join('')}`)
}

function parseToolResult(name, result) {
  const text = result.content?.find((item) => item.type === 'text')?.text ?? ''
  if (result.isError) throw new Error(`${name}: ${text || '알 수 없는 MCP 오류'}`)
  assert.ok(text, `${name}: 텍스트 결과가 없습니다.`)
  return JSON.parse(text)
}

async function main() {
  await rm(testDataDirectory, { recursive: true, force: true })
  await mkdir(testDataDirectory, { recursive: true })
  const port = await availablePort()
  assert.ok(port, '테스트 포트를 할당하지 못했습니다.')
  const apiBaseUrl = `http://127.0.0.1:${port}`
  let mockAionUi = await startMockAionUi()
  const aionUiDiscoveryFile = path.join(testDataDirectory, '_aionui-backend.json')
  await publishMockAionUiDiscovery(aionUiDiscoveryFile, mockAionUi)
  const environment = {
    ...process.env,
    MNP_API_HOST: '127.0.0.1',
    MNP_API_PORT: String(port),
    MNP_API_URL: apiBaseUrl,
    MNP_PUBLIC_URL: 'https://mindnprogress.test',
    MNP_DATA_DIR: testDataDirectory,
    MNP_AIONUI_URL: '',
    MNP_AIONUI_DISCOVERY_FILE: aionUiDiscoveryFile,
    MNP_ADMIN_EMAIL: 'mcp-test-admin@mind.local',
    MNP_ADMIN_PASSWORD: 'McpTest!2026',
    MNP_AI_ATTRIBUTION_DURATION_MS: '10000',
    MNP_AI_DELEGATION_POLL_INTERVAL_MS: '100',
  }
  const serverLogs = []
  const startApiServer = () => {
    const child = spawn(process.execPath, ['server/index.mjs'], {
      cwd: projectDirectory,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.on('data', (chunk) => serverLogs.push(chunk.toString()))
    child.stderr.on('data', (chunk) => serverLogs.push(chunk.toString()))
    return child
  }
  let apiServer = startApiServer()

  let client = null
  const calledTools = new Map()
  try {
    await waitForServer(apiBaseUrl, apiServer, serverLogs)
    await access(path.join(testDataDirectory, '_integration-token'))
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['mcp/server.mjs'],
      cwd: projectDirectory,
      env: environment,
      stderr: 'pipe',
    })
    client = new Client({ name: 'mindnprogress-full-regression', version: '1.0.0' })
    await client.connect(transport)
    const listedTools = await client.listTools()
    const registeredToolNames = listedTools.tools.map((tool) => tool.name).sort()
    assert.equal(registeredToolNames.length, 40, `예상과 다른 MCP 도구 수: ${registeredToolNames.length}`)
    const toolSchema = (name) => listedTools.tools.find((tool) => tool.name === name)?.inputSchema
    for (const name of ['mindnprogress_update_card', 'mindnprogress_move_card', 'mindnprogress_delete_card', 'mindnprogress_list_comments', 'mindnprogress_add_comment']) {
      assert.ok(toolSchema(name)?.properties?.cardId, `${name}: cardId 공개 인자가 없습니다.`)
      assert.match(toolSchema(name)?.properties?.nodeId?.description ?? '', /기존 대화 호환용/)
    }
    assert.ok(toolSchema('mindnprogress_add_card')?.properties?.parentCardId)
    assert.ok(toolSchema('mindnprogress_move_card')?.properties?.newParentCardId)
    assert.ok(toolSchema('mindnprogress_add_comment')?.properties?.parentCommentId)

    const invoke = async (name, args = {}) => {
      calledTools.set(name, (calledTools.get(name) ?? 0) + 1)
      return parseToolResult(name, await client.callTool({ name, arguments: args }))
    }
    const invokeExpectError = async (name, args, expectedText) => {
      calledTools.set(name, (calledTools.get(name) ?? 0) + 1)
      const result = await client.callTool({ name, arguments: args })
      const text = result.content?.find((item) => item.type === 'text')?.text ?? ''
      assert.equal(result.isError, true, `${name}: 실패해야 하는 요청이 성공했습니다.`)
      assert.match(text, expectedText, `${name}: 예상한 오류가 아닙니다. ${text}`)
    }

    const guide = await invoke('mindnprogress_read_me_first')
    assert.equal(guide.guide.product.name, 'MindNProgress')
    assert.equal(guide.guide.version, '2.5')
    assert.match(guide.guide.dataModel.cardContent.sharedKnowledge, /재사용/)
    assert.match(guide.guide.authoringRules.join('\n'), /모든 isWork=true 업무 진행률을 동일 가중치 평균/)
    assert.match(guide.guide.authoringRules.join('\n'), /확정된 결과를 직접 작업 근거.*주요 지식선.*단순 관련성이나 일회성 참조에는 연결하지 않음/)
    assert.match(guide.guide.operationRules.join('\n'), /변경할 필드만 보내고/)
    assert.match(guide.guide.operationRules.join('\n'), /cardId.*nodeId.*기존 대화 호환용/)
    assert.match(guide.guide.operationRules.join('\n'), /조회 도구는 문서 version을 변경하지 않으며/)
    assert.match(guide.guide.operationRules.join('\n'), /mindnprogress_get_ai_work_states.*동시에 수정하지 않음/)
    assert.match(guide.guide.operationRules.join('\n'), /기존 AI 대화를 이어갈지 새로 시작할지.*mindnprogress_list_ai_conversations/)
    assert.match(guide.guide.operationRules.join('\n'), /복수의 독립적인 완료 조건.*필요한 최소한의 결과 중심 체크리스트.*억지로 나누지 않고.*계획 카드에는 생략 가능/)
    assert.match(guide.guide.operationRules.join('\n'), /위임 기준.*최초로 get_context.*모든 깊이/)
    assert.match(guide.guide.operationRules.join('\n'), /자동 재개된 턴.*mindnprogress_delegate_ai_work.*미래형 약속/)
    assert.match(guide.guide.operationRules.join('\n'), /unityMCP.*waiting-resource/)
    assert.match(guide.guide.operationRules.join('\n'), /댓글 summary는 \[진행\].*\[차단\].*\[결과\]/)
    assert.match(guide.guide.commentRules.detail, /작업을 이어가거나 결과를 검증/)
    assert.match(guide.guide.commentRules.legacy, /자동 분리하거나 다시 쓰지 않음/)
    assert.match(guide.guide.operationRules.join('\n'), /waitingItems가 해제되면 서버가 관련 사용자에게 알림/)
    assert.match(guide.guide.operationRules.join('\n'), /kind=image.*imageAccess\.localPath.*로컬 이미지 열람 도구/)

    const createdMindmap = await invoke('mindnprogress_create_mindmap', {
      title: 'MCP 전체 회귀 문서',
      color: 'blue',
      cards: [
        { key: 'root', label: '전체 회귀', kind: 'root', description: '루트 업무 https://example.com/root', taskUrl: 'https://example.com/root' },
        { key: 'branch-a', parentKey: 'root', label: '기능 A', kind: 'branch', sharedKnowledge: '기능 A의 재사용 가능한 결정과 결과' },
        { key: 'branch-b', parentKey: 'root', label: '기능 B', kind: 'branch', sharedKnowledge: '현재 선택과 무관한 장문 지식 '.repeat(300) },
        {
          key: 'task-a',
          parentKey: 'branch-a',
          label: '업무 A',
          kind: 'task',
          isWork: true,
          status: 'in-progress',
          progress: 30,
          taskUrl: 'https://example.com/task-a',
          waitingItems: [{ label: '서버 API 완료', note: '응답 형식 확정 필요', resumeCondition: '개발 서버 배포' }],
        },
      ],
    })
    const mapId = createdMindmap.document.id
    assert.equal(createdMindmap.cardCount, 4)

    const createdSingle = await invoke('mindnprogress_create_document', {
      title: 'MCP 단일 문서', color: 'green', rootLabel: '단일 루트', rootDescription: '삭제 및 복원 검증',
    })
    const secondaryMapId = createdSingle.map.id
    const secondaryRootId = createdSingle.map.nodes[0].id

    const documents = await invoke('mindnprogress_list_documents')
    assert.deepEqual(documents.maps.map((map) => map.id).sort(), [mapId, secondaryMapId].sort())
    assert.equal(documents.maps.find((map) => map.id === mapId)?.waitingCount, 1)

    let documentResult = await invoke('mindnprogress_get_document', { mapId })
    assert.equal(documentResult.map.nodes.length, 4)
    assert.equal(documentResult.map.nodes.find((node) => node.id === 'branch-a')?.data.sharedKnowledge, '기능 A의 재사용 가능한 결정과 결과')
    const createdWaitingItem = documentResult.map.nodes.find((node) => node.id === 'task-a')?.data.waitingItems?.[0]
    assert.equal(createdWaitingItem?.label, '서버 API 완료')
    assert.ok(createdWaitingItem?.id)
    assert.ok(createdWaitingItem?.since)
    assert.equal(documentResult.map.nodes.find((node) => node.id === 'root')?.data.progress, 30)
    assert.equal(documentResult.map.nodes.find((node) => node.id === 'root')?.data.status, 'in-progress')
    assert.equal(documentResult.access.documentUrl, `https://mindnprogress.test/mindmap/${mapId}`)
    assert.equal(documentResult.access.cards.find((card) => card.cardId === 'task-a')?.accessUrl, `https://mindnprogress.test/mindmap/${mapId}/task-a`)
    let loginResponse = await fetch(`${apiBaseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'mcp-test-admin@mind.local', password: 'McpTest!2026' }),
    })
    assert.equal(loginResponse.status, 200)
    let sessionCookie = loginResponse.headers.get('set-cookie')?.split(';')[0]
    assert.ok(sessionCookie, '테스트 관리자 세션 쿠키가 없습니다.')
    const editorCreateResponse = await fetch(`${apiBaseUrl}/api/admin/editors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
      body: JSON.stringify({
        name: 'MCP 테스트 편집자',
        email: 'mcp-test-editor@mind.local',
        password: 'McpEditor!2026',
      }),
    })
    assert.equal(editorCreateResponse.status, 201)
    const testEditor = (await editorCreateResponse.json()).editor
    assert.equal(testEditor.role, 'editor')
    const editorLoginResponse = await fetch(`${apiBaseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'mcp-test-editor@mind.local', password: 'McpEditor!2026' }),
    })
    assert.equal(editorLoginResponse.status, 200)
    let editorSessionCookie = editorLoginResponse.headers.get('set-cookie')?.split(';')[0]
    assert.ok(editorSessionCookie, '테스트 편집자 세션 쿠키가 없습니다.')
    const referencedCommentResponse = await fetch(`${apiBaseUrl}/api/maps/${encodeURIComponent(mapId)}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
      body: JSON.stringify({ nodeId: 'branch-b', text: '참조 노드 초기 댓글 통계 검증' }),
    })
    assert.equal(referencedCommentResponse.status, 201)
    const updatedReferenceSource = await invoke('mindnprogress_update_card', {
      mapId,
      nodeId: 'branch-b',
      data: {
        description: '원본에서 변경된 최신 업무 설명',
        progress: 65,
        status: 'in-progress',
      },
    })
    assert.equal(updatedReferenceSource.map.nodes.find((node) => node.id === 'branch-b')?.data.description, '원본에서 변경된 최신 업무 설명')
    const referencedRootResult = await invoke('mindnprogress_update_card', {
      mapId: secondaryMapId,
      nodeId: secondaryRootId,
      data: { reference: { mapId, nodeId: 'branch-b' } },
    })
    assert.deepEqual(
      referencedRootResult.map.nodes.find((node) => node.id === secondaryRootId)?.data.reference,
      { mapId, nodeId: 'branch-b' },
    )
    const referencedDocumentResponse = await fetch(`${apiBaseUrl}/api/maps/${encodeURIComponent(secondaryMapId)}`, {
      headers: { Cookie: sessionCookie },
    })
    assert.equal(referencedDocumentResponse.status, 200)
    const referencedDocument = await referencedDocumentResponse.json()
    const resolvedReferenceNode = referencedDocument.map.nodes.find((node) => node.id === secondaryRootId)
    assert.equal(resolvedReferenceNode.data.label, '기능 B (ref)')
    assert.equal(resolvedReferenceNode.data.description, '원본에서 변경된 최신 업무 설명')
    assert.equal(resolvedReferenceNode.data.progress, 65)
    assert.equal(resolvedReferenceNode.data.status, 'in-progress')
    assert.match(resolvedReferenceNode.data.sharedKnowledge, /현재 선택과 무관한 장문 지식/)
    assert.deepEqual(
      referencedDocument.referenceCommentStats[secondaryRootId],
      { total: 1, unresolved: 1 },
      '참조 노드 댓글 통계가 문서 초기 응답에 포함되지 않았습니다.',
    )
    assert.deepEqual(referencedDocument.unresolvedReferenceNodeIds, [])
    const referencedDocumentSecondResponse = await fetch(`${apiBaseUrl}/api/maps/${encodeURIComponent(secondaryMapId)}`, {
      headers: { Cookie: sessionCookie },
    })
    assert.equal(referencedDocumentSecondResponse.status, 200)
    const referencedDocumentSecond = await referencedDocumentSecondResponse.json()
    assert.equal(
      referencedDocumentSecond.map.version,
      referencedRootResult.map.version,
      'Ref 원본 내용을 투영하는 조회가 대상 문서 버전을 변경했습니다.',
    )
    documentResult = await invoke('mindnprogress_get_document', { mapId })
    const versionBeforeReadOnlyTools = documentResult.map.version
    const transientOnlyMap = structuredClone(documentResult.map)
    transientOnlyMap.nodes[0].selected = true
    transientOnlyMap.nodes[0].dragging = false
    transientOnlyMap.nodes[0].measured = { width: 218, height: 141 }
    transientOnlyMap.nodes[0].width = 218
    transientOnlyMap.nodes[0].height = 141
    const transientOnlySaveResponse = await fetch(`${apiBaseUrl}/api/maps/${encodeURIComponent(mapId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
      body: JSON.stringify({
        map: { nodes: transientOnlyMap.nodes, edges: transientOnlyMap.edges },
        baseVersion: documentResult.map.version,
      }),
    })
    assert.equal(transientOnlySaveResponse.status, 200)
    const transientOnlySave = await transientOnlySaveResponse.json()
    assert.equal(transientOnlySave.map.version, documentResult.map.version, '화면 전용 노드 상태가 문서 버전을 변경했습니다.')
    assert.equal(transientOnlySave.map.nodes[0].selected, undefined)
    assert.equal(transientOnlySave.map.nodes[0].dragging, undefined)
    assert.equal(transientOnlySave.map.nodes[0].measured, undefined)
    assert.equal(transientOnlySave.map.nodes[0].width, undefined)
    assert.equal(transientOnlySave.map.nodes[0].height, undefined)
    const layoutResponse = await fetch(`${apiBaseUrl}/api/maps/layout`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
      body: JSON.stringify({
        documentLayout: {
          version: 1,
          items: [
            { type: 'map', id: secondaryMapId },
            { type: 'group', id: 'group-mcp-regression' },
          ],
          groups: [{
            id: 'group-mcp-regression',
            name: 'JP-매니저',
            mapIds: [mapId],
          }],
        },
      }),
    })
    assert.equal(layoutResponse.status, 200)
    const groupedLibrary = await layoutResponse.json()
    assert.deepEqual(groupedLibrary.documentLayout.items, [
      { type: 'map', id: secondaryMapId },
      { type: 'group', id: 'group-mcp-regression' },
    ])
    assert.deepEqual(groupedLibrary.documentLayout.groups[0].mapIds, [mapId])
    assert.deepEqual(groupedLibrary.maps.map((map) => map.id), [secondaryMapId, mapId])
    const integrationToken = (await readFile(path.join(testDataDirectory, '_integration-token'), 'utf8')).trim()
    const unspecifiedCommentResponse = await fetch(`${apiBaseUrl}/api/maps/${encodeURIComponent(mapId)}/comments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${integrationToken}`,
        'Content-Type': 'application/json',
        'X-MNP-AI-Map-Id': mapId,
        'X-MNP-AI-Card-Id': 'task-a',
      },
      body: JSON.stringify({ nodeId: 'task-a', text: '대화 귀속 복구 전 모델 미지정 댓글' }),
    })
    assert.equal(unspecifiedCommentResponse.status, 201)
    const unspecifiedComment = await unspecifiedCommentResponse.json()
    assert.equal(unspecifiedComment.comment.author.name, 'AI(모델 미지정)')
    const attributionResponse = await fetch(`${apiBaseUrl}/api/integrations/aionui/attributions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: editorSessionCookie },
      body: JSON.stringify({
        agentId: 'agent-claude-test',
        modelId: 'claude-test-model',
        mapId,
        cardId: 'task-a',
      }),
    })
    assert.equal(attributionResponse.status, 201)
    const attribution = await attributionResponse.json()
    assert.equal(attribution.authorName, 'Claude Code(Claude Test Model)')
    assert.ok(attribution.attributionToken)
    assert.equal(attribution.editorId, testEditor.id)

    const mismatchedEditorCommentResponse = await fetch(`${apiBaseUrl}/api/maps/${encodeURIComponent(mapId)}/comments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${integrationToken}`,
        'Content-Type': 'application/json',
        'X-MNP-AI-Map-Id': mapId,
        'X-MNP-AI-Card-Id': 'branch-b',
        'X-MNP-AI-Editor-Id': 'user-admin',
      },
      body: JSON.stringify({ nodeId: 'branch-b', text: '다른 편집자의 AI 귀속을 사용하지 않는지 검증' }),
    })
    assert.equal(mismatchedEditorCommentResponse.status, 201)
    const mismatchedEditorComment = await mismatchedEditorCommentResponse.json()
    assert.equal(mismatchedEditorComment.comment.author.id, 'user-admin')
    assert.notEqual(mismatchedEditorComment.comment.author.name, attribution.authorName)

    const context = await invoke('mindnprogress_get_context', {
      mapId,
      cardId: 'task-a',
      editorId: attribution.editorId,
      attributionToken: attribution.attributionToken,
    })
    assert.equal(context.contextSchemaVersion, '2.5')
    assert.equal(context.detailLevel, 'focused')
    assert.equal(context.document.nodes, undefined)
    assert.equal(context.document.outline.length, 4)
    assert.equal(context.document.outline.find((card) => card.id === 'task-a')?.parentId, 'branch-a')
    assert.equal(context.document.outline.find((card) => card.id === 'task-a')?.waitingItems[0].resumeCondition, '개발 서버 배포')
    assert.equal(context.selection.card.id, 'task-a')
    assert.equal(context.selection.card.data.waitingItems[0].note, '응답 형식 확정 필요')
    assert.equal(context.selection.card.position, undefined)
    assert.equal(context.selection.taskLinks.available.length, 2)
    assert.equal(context.selection.taskLinks.startupInspection.mode, 'default')
    assert.equal(context.selection.taskLinks.startupInspection.conversationInspection.mode, 'not-applicable')
    assert.deepEqual(context.selection.taskLinks.startupInspection.conversationInspection.sources, [])
    assert.equal(context.selection.knowledgeSources.all, undefined)
    assert.equal(context.selection.aiWorkCoordination.tool, 'mindnprogress_get_ai_work_states')
    assert.equal(context.selection.aiWorkCoordination.childDelegation.delegateTool, 'mindnprogress_delegate_ai_work')
    assert.deepEqual(context.selection.aiWorkCoordination.siblingCardIds, [])
    assert.equal(context.selection.aiWorkCoordination.toolArguments, null)
    assert.equal(context.selection.accessUrl, `https://mindnprogress.test/mindmap/${mapId}/task-a`)
    assert.equal(context.selection.commentsPage.total, 1)
    assert.equal(context.selection.commentsPage.hasMore, false)
    assert.ok(context.teamMembers.every((member) => member.lastLoginAt === undefined))

    const fullContext = await invoke('mindnprogress_get_context', {
      mapId,
      cardId: 'task-a',
      editorId: attribution.editorId,
      attributionToken: attribution.attributionToken,
      detailLevel: 'full',
    })
    assert.equal(fullContext.detailLevel, 'full')
    assert.equal(fullContext.document.nodes.length, 4)
    assert.equal(fullContext.document.outline, undefined)
    assert.equal(fullContext.selection.knowledgeSources.all.length, 0)
    assert.ok(JSON.stringify(context).length < JSON.stringify(fullContext).length)
    assert.ok(JSON.stringify(context).length < 25_000, 'focused 컨텍스트가 크기 회귀 기준을 초과했습니다.')
    documentResult = await invoke('mindnprogress_get_document', { mapId })
    assert.equal(documentResult.map.version, versionBeforeReadOnlyTools, '조회 도구가 문서 버전을 변경했습니다.')

    const knowledgeLineAdded = await invoke('mindnprogress_add_knowledge_line', {
      mapId,
      sourceCardId: 'branch-a',
      targetCardId: 'task-a',
      knowledgePolicy: 'reuse-first',
    })
    assert.equal(knowledgeLineAdded.knowledgeLine.knowledgePolicy, 'reuse-first')
    assert.equal(knowledgeLineAdded.knowledgeLine.sourceCardId, 'branch-a')
    assert.equal(knowledgeLineAdded.knowledgeLine.targetCardId, 'task-a')
    assert.equal(knowledgeLineAdded.version, documentResult.map.version + 1, '지식선 추가가 문서 버전을 한 번 증가시키지 않았습니다.')
    await invokeExpectError('mindnprogress_add_knowledge_line', {
      mapId,
      sourceCardId: 'branch-a',
      targetCardId: 'task-a',
      knowledgePolicy: 'reuse-first',
    }, /이미 연결된 지식선/)
    const knowledgeLineUpdated = await invoke('mindnprogress_update_knowledge_line', {
      mapId,
      sourceCardId: 'branch-a',
      targetCardId: 'task-a',
      knowledgePolicy: 'inspect-if-insufficient',
    })
    assert.equal(knowledgeLineUpdated.knowledgeLine.knowledgePolicy, 'inspect-if-insufficient')
    assert.equal(knowledgeLineUpdated.version, knowledgeLineAdded.version + 1, '지식선 정책 변경이 문서 버전을 한 번 증가시키지 않았습니다.')
    await invokeExpectError('mindnprogress_add_knowledge_line', {
      mapId,
      sourceCardId: 'task-a',
      targetCardId: 'branch-a',
      knowledgePolicy: 'reuse-first',
    }, /순환 지식선/)
    const knowledgeLineDeleted = await invoke('mindnprogress_delete_knowledge_line', {
      mapId,
      sourceCardId: 'branch-a',
      targetCardId: 'task-a',
    })
    assert.equal(knowledgeLineDeleted.deletedKnowledgeLineIds.length, 1)
    assert.equal(knowledgeLineDeleted.version, knowledgeLineUpdated.version + 1, '지식선 삭제가 문서 버전을 한 번 증가시키지 않았습니다.')
    documentResult = await invoke('mindnprogress_get_document', { mapId })
    assert.ok(!documentResult.map.edges.some((edge) => edge.data?.relation === 'knowledge'
      && edge.source === 'branch-a' && edge.target === 'task-a'))
    const versionBeforeConversationLink = documentResult.map.version

    const completionResponse = await fetch(attribution.completionUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: 'conversation-test' }),
    })
    assert.equal(completionResponse.status, 200)
    await access(path.join(testDataDirectory, '_ai-conversation-attributions.json'))
    const repairedCommentsResponse = await fetch(`${apiBaseUrl}/api/maps/${encodeURIComponent(mapId)}/comments?nodeId=task-a`, {
      headers: { Cookie: sessionCookie },
    })
    assert.equal(repairedCommentsResponse.status, 200)
    const repairedComments = await repairedCommentsResponse.json()
    assert.equal(
      repairedComments.comments.find((comment) => comment.id === unspecifiedComment.comment.id)?.author.name,
      'Claude Code(Claude Test Model)',
    )
    const repairedNotificationsResponse = await fetch(`${apiBaseUrl}/api/notifications`, {
      headers: { Cookie: sessionCookie },
    })
    assert.equal(repairedNotificationsResponse.status, 200)
    const repairedNotifications = await repairedNotificationsResponse.json()
    assert.equal(
      repairedNotifications.notifications.find((notification) => notification.commentId === unspecifiedComment.comment.id)?.actor.name,
      'Claude Code(Claude Test Model)',
    )
    const repairedAuthorNotificationsResponse = await fetch(`${apiBaseUrl}/api/notifications`, {
      headers: { Cookie: editorSessionCookie },
    })
    assert.equal(repairedAuthorNotificationsResponse.status, 200)
    const repairedAuthorNotifications = await repairedAuthorNotificationsResponse.json()
    assert.ok(
      !repairedAuthorNotifications.notifications.some((notification) => notification.commentId === unspecifiedComment.comment.id),
      '댓글 작성자 귀속을 복구한 뒤 작성자 본인의 알림이 남았습니다.',
    )
    documentResult = await invoke('mindnprogress_get_document', { mapId })
    assert.equal(documentResult.map.version, versionBeforeConversationLink + 1, 'AI 대화 ID 연결은 문서 버전을 한 번 증가시켜야 합니다.')
    assert.equal(documentResult.map.nodes.find((node) => node.id === 'task-a')?.data.aiConversationId, 'conversation-test')
    const linkedConversations = documentResult.map.nodes.find((node) => node.id === 'task-a')?.data.aiConversations
    assert.equal(linkedConversations.length, 1)
    assert.equal(linkedConversations[0].conversationId, 'conversation-test')
    assert.equal(linkedConversations[0].agent.label, 'Claude Code')
    assert.equal(linkedConversations[0].model.label, 'Claude Test Model')
    assert.equal(linkedConversations[0].startedBy.label, 'MCP 테스트 편집자')
    const conversationListResponse = await fetch(`${apiBaseUrl}/api/maps/${encodeURIComponent(mapId)}/cards/task-a/ai-conversations`, {
      headers: { Cookie: editorSessionCookie },
    })
    assert.equal(conversationListResponse.status, 200)
    const conversationList = await conversationListResponse.json()
    assert.equal(conversationList.latestConversationId, 'conversation-test')
    assert.equal(conversationList.conversations.length, 1)
    assert.equal(conversationList.conversations[0].runtime.state, 'running')
    assert.equal(conversationList.conversations[0].available, true)
    const conversationCandidates = await invoke('mindnprogress_list_ai_conversations', { mapId, cardId: 'task-a' })
    assert.equal(conversationCandidates.latestConversationId, 'conversation-test')
    assert.equal(conversationCandidates.conversations.length, 1)
    assert.equal(conversationCandidates.conversations[0].agent.label, 'Claude Code')
    assert.equal(conversationCandidates.conversations[0].model.label, 'Claude Test Model')
    assert.equal(conversationCandidates.conversations[0].runtime.state, 'running')
    assert.match(conversationCandidates.selectionRule.exclude, /running.*waiting-confirmation/)
    const emptyDelegations = await invoke('mindnprogress_list_ai_delegations', { mapId, parentCardId: 'task-a' })
    assert.deepEqual(emptyDelegations.delegations, [])
    await invokeExpectError('mindnprogress_delegate_ai_work', {
      mapId,
      targetCardId: 'branch-a',
      strategy: 'new',
      instruction: '하위 카드 작업을 실제로 수행하세요.',
      decisionReason: '회귀 테스트에서 상위-하위 범위 검증',
      sourceRevision: documentResult.map.version,
      idempotencyKey: 'mcp-regression-invalid-parent',
    }, /하위 카드에만 AI 작업을 위임/)
    const versionBeforeAiWorkStateRead = documentResult.map.version
    const aiWorkStates = await invoke('mindnprogress_get_ai_work_states', {
      mapId,
      cardIds: ['task-a', 'branch-a'],
    })
    assert.equal(aiWorkStates.mapVersion, versionBeforeAiWorkStateRead)
    assert.deepEqual(aiWorkStates.activeCardIds, ['task-a'])
    assert.equal(aiWorkStates.cards.find((card) => card.cardId === 'task-a')?.state, 'running')
    assert.equal(aiWorkStates.cards.find((card) => card.cardId === 'task-a')?.isActive, true)
    assert.equal(aiWorkStates.cards.find((card) => card.cardId === 'task-a')?.conversationCount, 1)
    assert.deepEqual(aiWorkStates.cards.find((card) => card.cardId === 'task-a')?.activeConversationIds, ['conversation-test'])
    assert.equal(aiWorkStates.cards.find((card) => card.cardId === 'task-a')?.turnId, 'turn-mcp-runtime-test')
    assert.equal(aiWorkStates.cards.find((card) => card.cardId === 'branch-a')?.state, 'unlinked')
    assert.equal(aiWorkStates.cards.find((card) => card.cardId === 'branch-a')?.isActive, false)
    assert.match(aiWorkStates.coordinationRule, /동시에 수정하지 마세요/)
    const afterAiWorkStateRead = await invoke('mindnprogress_get_document', { mapId })
    assert.equal(afterAiWorkStateRead.map.version, versionBeforeAiWorkStateRead, 'AI 작업 상태 조회가 문서 버전을 변경했습니다.')
    await invokeExpectError('mindnprogress_get_ai_work_states', {
      mapId,
      cardIds: ['missing-card'],
    }, /카드를 찾을 수 없습니다/)
    const conversationTranscript = await invoke('mindnprogress_get_ai_conversation_transcript', { mapId, cardId: 'task-a' })
    assert.equal(conversationTranscript.conversation.id, 'conversation-test')
    assert.equal(conversationTranscript.card.cardId, 'task-a')
    assert.equal(conversationTranscript.messageCount, 4)
    assert.equal(conversationTranscript.exportedMessageCount, 3)
    assert.equal(conversationTranscript.truncated, false)
    assert.match(conversationTranscript.transcript, /^대화: MCP 전체 대화 조회 검증\n대화 ID: conversation-test\n내보낸 시각: .+\n유형: acp/)
    assert.match(conversationTranscript.transcript, /사용자:\n첫 사용자 요청/)
    assert.match(conversationTranscript.transcript, /시스템:\n중간 시스템 안내/)
    assert.match(conversationTranscript.transcript, /어시스턴트:\n최종 어시스턴트 응답/)
    assert.doesNotMatch(conversationTranscript.transcript, /internal_tool|acp_tool_call/)
    await invokeExpectError('mindnprogress_get_ai_conversation_transcript', {
      mapId, cardId: 'branch-a',
    }, /카드에 연결된 AI 대화가 없습니다/)

    const delegatedChildCreated = await invoke('mindnprogress_add_card', {
      mapId,
      parentId: 'task-a',
      data: { label: '위임 하위 카드', kind: 'task', isWork: false, status: 'planned', progress: 0 },
    })
    const delegatedChild = delegatedChildCreated.map.nodes.find((node) => node.data?.label === '위임 하위 카드')
    assert.ok(delegatedChild)
    const inspectedCardAttributionResponse = await fetch(`${apiBaseUrl}/api/integrations/aionui/attributions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: editorSessionCookie },
      body: JSON.stringify({
        agentId: 'agent-claude-test',
        modelId: 'claude-test-model',
        mapId,
        cardId: delegatedChild.id,
      }),
    })
    assert.equal(inspectedCardAttributionResponse.status, 201)
    const inspectedCardAttribution = await inspectedCardAttributionResponse.json()
    const inspectedCardCompletionResponse = await fetch(inspectedCardAttribution.completionUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: 'conversation-inspected-card' }),
    })
    assert.equal(inspectedCardCompletionResponse.status, 200)
    const delegationSourceDocument = await invoke('mindnprogress_get_document', { mapId })
    const delegationArguments = {
      mapId,
      targetCardId: delegatedChild.id,
      strategy: 'new',
      instruction: '하위 카드의 요구사항을 확인하고 구현과 검증을 완료한 뒤 결과를 기록하세요.',
      decisionReason: '기존 대화가 없어 상위 대화와 같은 실행 환경으로 새 대화를 시작합니다.',
      sourceRevision: delegationSourceDocument.map.version,
      idempotencyKey: `mcp-regression:${delegatedChild.id}:${delegationSourceDocument.map.version}`,
    }
    const [inspectedChildContext, inspectedUnrelatedContext] = await Promise.all([
      invoke('mindnprogress_get_context', {
        mapId,
        cardId: delegatedChild.id,
        editorId: attribution.editorId,
        attributionToken: attribution.attributionToken,
      }),
      invoke('mindnprogress_get_context', {
        mapId,
        cardId: 'branch-b',
        editorId: attribution.editorId,
        attributionToken: attribution.attributionToken,
      }),
    ])
    assert.equal(inspectedChildContext.selection.card.id, delegatedChild.id)
    assert.equal(inspectedUnrelatedContext.selection.card.id, 'branch-b')
    const delegated = await invoke('mindnprogress_delegate_ai_work', delegationArguments)
    assert.equal(delegated.delegation.targetConversationId, 'conversation-delegated')
    assert.equal(delegated.delegation.parentConversationId, 'conversation-test')
    assert.equal(delegated.delegation.parentCardId, 'task-a', '다른 카드 get_context 조회가 위임 기준 카드를 변경했습니다.')
    assert.equal(delegated.delegation.strategy, 'new')
    assert.equal(delegated.mapVersion, delegationArguments.sourceRevision + 1)
    const delegatedRepeat = await invoke('mindnprogress_delegate_ai_work', delegationArguments)
    assert.equal(delegatedRepeat.repeated, true)
    assert.equal(mockAionUi.dispatchRequests.length, 1, '멱등 재호출이 하위 대화를 중복 실행했습니다.')
    const delegatedDocument = await invoke('mindnprogress_get_document', { mapId })
    documentResult = delegatedDocument
    assert.equal(
      delegatedDocument.map.nodes.find((node) => node.id === delegatedChild.id)?.data.aiConversationId,
      'conversation-delegated',
    )
    assert.match(mockAionUi.dispatchRequests[0].instruction, /MindNProgress 하위 카드 위임 작업 요청/)
    assert.match(mockAionUi.dispatchRequests[0].instruction, /실제로 수행/)

    mockAionUi.setDispatchState(delegationArguments.idempotencyKey, 'waiting_resource', {
      kind: 'unity_project',
      key: 'unity:test-project',
      projectRoot: 'C:/Git/Test/UnityProject',
    })
    let waitingDelegation = null
    const resourceWaitStartedAt = Date.now()
    while (Date.now() - resourceWaitStartedAt < 6_000) {
      const delegationList = await invoke('mindnprogress_list_ai_delegations', {
        mapId,
        parentCardId: 'task-a',
        targetCardId: delegatedChild.id,
      })
      waitingDelegation = delegationList.delegations[0] ?? null
      if (waitingDelegation?.state === 'waiting-resource') break
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    assert.equal(waitingDelegation?.state, 'waiting-resource')
    assert.equal(waitingDelegation?.resource?.key, 'unity:test-project')
    assert.equal(mockAionUi.dispatchRequests.length, 1, 'Unity 자원 대기를 완료로 오인해 상위 대화를 재개했습니다.')

    apiServer.kill()
    await new Promise((resolve) => apiServer.once('exit', resolve))
    apiServer = startApiServer()
    await waitForServer(apiBaseUrl, apiServer, serverLogs)
    const restartedEditorLoginResponse = await fetch(`${apiBaseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'mcp-test-editor@mind.local', password: 'McpEditor!2026' }),
    })
    assert.equal(restartedEditorLoginResponse.status, 200)
    editorSessionCookie = restartedEditorLoginResponse.headers.get('set-cookie')?.split(';')[0]
    assert.ok(editorSessionCookie, '재시작 후 테스트 편집자 세션 쿠키가 없습니다.')
    const restoredDelegationList = await invoke('mindnprogress_list_ai_delegations', {
      mapId,
      parentCardId: 'task-a',
      targetCardId: delegatedChild.id,
    })
    assert.equal(restoredDelegationList.delegations[0]?.id, delegationArguments.idempotencyKey)
    assert.equal(restoredDelegationList.delegations[0]?.state, 'waiting-resource')

    apiServer.kill()
    await new Promise((resolve) => apiServer.once('exit', resolve))
    await writeFile(path.join(testDataDirectory, '_ai-delegations.json'), '[]\n', 'utf8')
    mockAionUi.completeDispatch(delegationArguments.idempotencyKey)
    apiServer = startApiServer()
    await waitForServer(apiBaseUrl, apiServer, serverLogs)
    const recoveryEditorLoginResponse = await fetch(`${apiBaseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'mcp-test-editor@mind.local', password: 'McpEditor!2026' }),
    })
    assert.equal(recoveryEditorLoginResponse.status, 200)
    editorSessionCookie = recoveryEditorLoginResponse.headers.get('set-cookie')?.split(';')[0]
    assert.ok(editorSessionCookie, '위임 복구 후 테스트 편집자 세션 쿠키가 없습니다.')
    const recoveredDelegation = await invoke('mindnprogress_delegate_ai_work', delegationArguments)
    assert.equal(recoveredDelegation.recovered, true)
    assert.equal(recoveredDelegation.repeated, true)
    assert.equal(recoveredDelegation.delegation.state, 'waiting-parent')

    mockAionUi.setConversationRuntimeState('idle')
    let completedDelegation = null
    const delegationWaitStartedAt = Date.now()
    while (Date.now() - delegationWaitStartedAt < 12_000) {
      const delegationList = await invoke('mindnprogress_list_ai_delegations', {
        mapId,
        parentCardId: 'task-a',
        targetCardId: delegatedChild.id,
      })
      completedDelegation = delegationList.delegations[0] ?? null
      if (completedDelegation?.state === 'completed') break
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    assert.equal(completedDelegation?.state, 'completed')
    assert.equal(completedDelegation?.childStatus, 'completed')
    assert.equal(mockAionUi.dispatchRequests.length, 2)
    assert.equal(mockAionUi.dispatchRequests[1].targetConversationId, 'conversation-test')
    assert.match(mockAionUi.dispatchRequests[1].instruction, /하위 카드 작업을 완료하고 결과를 기록했습니다/)

    const unlinkedAttributionResponse = await fetch(`${apiBaseUrl}/api/integrations/aionui/attributions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: editorSessionCookie },
      body: JSON.stringify({
        agentId: 'agent-claude-test',
        modelId: 'claude-test-model',
        mapId: secondaryMapId,
        cardId: secondaryRootId,
      }),
    })
    assert.equal(unlinkedAttributionResponse.status, 201)

    apiServer.kill()
    await new Promise((resolve) => apiServer.once('exit', resolve))
    apiServer = startApiServer()
    await waitForServer(apiBaseUrl, apiServer, serverLogs)
    loginResponse = await fetch(`${apiBaseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'mcp-test-admin@mind.local', password: 'McpTest!2026' }),
    })
    assert.equal(loginResponse.status, 200)
    sessionCookie = loginResponse.headers.get('set-cookie')?.split(';')[0]
    assert.ok(sessionCookie, '재시작 후 테스트 관리자 세션 쿠키가 없습니다.')

    const persistedTokenComment = await invoke('mindnprogress_add_comment', {
      mapId,
      nodeId: 'task-a',
      text: 'API 서버 재시작 후 기존 MCP 토큰 귀속 검증',
    })
    assert.equal(persistedTokenComment.comment.author.name, 'Claude Code(Claude Test Model)')

    const freshTransport = new StdioClientTransport({
      command: process.execPath,
      args: ['mcp/server.mjs'],
      cwd: projectDirectory,
      env: environment,
      stderr: 'pipe',
    })
    const freshClient = new Client({ name: 'mindnprogress-attribution-reconnect', version: '1.0.0' })
    await freshClient.connect(freshTransport)
    try {
      const unlinkedCardComment = parseToolResult('mindnprogress_add_comment', await freshClient.callTool({
        name: 'mindnprogress_add_comment',
        arguments: { mapId: secondaryMapId, nodeId: secondaryRootId, text: '연결 완료 전 카드 귀속의 요청 한정 적용 검증' },
      }))
      assert.equal(unlinkedCardComment.comment.author.name, 'Claude Code(Claude Test Model)')

      parseToolResult('mindnprogress_update_card', await freshClient.callTool({
        name: 'mindnprogress_update_card',
        arguments: { mapId, nodeId: 'task-a', data: { label: '업무 A' } },
      }))

      const mapScopedComment = parseToolResult('mindnprogress_add_comment', await freshClient.callTool({
        name: 'mindnprogress_add_comment',
        arguments: { mapId, nodeId: 'branch-b', text: '댓글 전 카드 작업의 세션 오귀속 방지 검증' },
      }))
      assert.equal(mapScopedComment.comment.author.name, 'AI(모델 미지정)')

      const [reconnectedResult, continuedResult] = await Promise.all([
        freshClient.callTool({
          name: 'mindnprogress_add_comment',
          arguments: { mapId, nodeId: 'task-a', text: 'MCP 재연결 후 연결 대화 모델 귀속 검증' },
        }),
        freshClient.callTool({
          name: 'mindnprogress_add_comment',
          arguments: { mapId, nodeId: 'branch-b', text: '첫 댓글에서 복구한 AI 귀속의 병렬 카드 연속 적용 검증' },
        }),
      ])
      const reconnectedComment = parseToolResult('mindnprogress_add_comment', reconnectedResult)
      assert.equal(reconnectedComment.comment.author.name, 'Claude Code(Claude Test Model)')

      const continuedComment = parseToolResult('mindnprogress_add_comment', continuedResult)
      assert.equal(continuedComment.comment.author.name, 'Claude Code(Claude Test Model)')

      parseToolResult('mindnprogress_get_context', await freshClient.callTool({
        name: 'mindnprogress_get_context',
        arguments: {
          mapId,
          cardId: 'task-a',
          editorId: attribution.editorId,
          aiType: 'Codex CLI',
          aiModel: 'GPT-5.6-Sol',
        },
      }))
      const selfDeclaredComment = parseToolResult('mindnprogress_add_comment', await freshClient.callTool({
        name: 'mindnprogress_add_comment',
        arguments: { mapId, nodeId: 'task-a', text: '외부 MCP 세션의 명시적 AI 종류와 모델 귀속 검증' },
      }))
      assert.equal(selfDeclaredComment.comment.author.id, attribution.editorId)
      assert.equal(selfDeclaredComment.comment.author.name, 'Codex CLI(GPT-5.6-Sol)')

      parseToolResult('mindnprogress_get_context', await freshClient.callTool({
        name: 'mindnprogress_get_context',
        arguments: { mapId, cardId: 'task-a', editorId: attribution.editorId },
      }))
      const contextContinuedComment = parseToolResult('mindnprogress_add_comment', await freshClient.callTool({
        name: 'mindnprogress_add_comment',
        arguments: { mapId, nodeId: 'branch-b', text: '컨텍스트에서 복구한 AI 귀속의 다른 카드 연속 적용 검증' },
      }))
      assert.equal(contextContinuedComment.comment.author.name, 'Claude Code(Claude Test Model)')
      const clearedIdentityComment = parseToolResult('mindnprogress_add_comment', await freshClient.callTool({
        name: 'mindnprogress_add_comment',
        arguments: { mapId, nodeId: 'task-a', text: '자기 식별 해제 후 연결 대화 귀속 복원 검증' },
      }))
      assert.equal(clearedIdentityComment.comment.author.name, 'Claude Code(Claude Test Model)')
    } finally {
      await freshClient.close()
    }

    const idFallbackContext = await invoke('mindnprogress_get_context', {
      mapId,
      cardId: 'task-a',
      editorId: attribution.editorId,
      attributionToken: 'expired-attribution-token-00000000',
    })
    assert.equal(idFallbackContext.selection.card.id, 'task-a')

    await new Promise((resolve) => mockAionUi.server.close(resolve))
    mockAionUi = await startMockAionUi({
      agentId: 'agent-codex-restarted',
      agentName: 'Codex',
      modelId: 'gpt-restarted',
      modelName: 'GPT Restarted',
    })
    await publishMockAionUiDiscovery(aionUiDiscoveryFile, mockAionUi)
    const restartedOptionsResponse = await fetch(`${apiBaseUrl}/api/integrations/aionui/options`, {
      headers: { Cookie: sessionCookie },
    })
    assert.equal(restartedOptionsResponse.status, 200)
    const restartedOptions = await restartedOptionsResponse.json()
    assert.equal(restartedOptions.aionUiUrl, mockAionUi.baseUrl)
    assert.equal(restartedOptions.agents[0].id, 'agent-codex-restarted')

    const users = await invoke('mindnprogress_list_users')
    assert.ok(Array.isArray(users.users))

    documentResult.map.nodes[0].data.description = '전체 저장 회귀 변경'
    const saved = await invoke('mindnprogress_save_document', {
      mapId,
      baseVersion: documentResult.map.version,
      nodes: documentResult.map.nodes,
      edges: documentResult.map.edges,
    })
    assert.ok(saved.map.version > documentResult.map.version)
    assert.equal(saved.map.updatedBy.id, attribution.editorId)
    assert.equal(saved.map.updatedBy.name, 'Claude Code(Claude Test Model)')
    assert.ok(saved.map.edges.every((edge) => edge.type === 'default'))

    const knowledgeComment = await invoke('mindnprogress_add_comment', {
      mapId,
      nodeId: 'branch-a',
      summary: '[결과] 선행 분석 결과를 재사용할 수 있습니다.',
      detail: '검증된 결정과 적용 범위를 공유 지식과 함께 확인했습니다.',
    })
    const knowledgeSaved = await invoke('mindnprogress_save_document', {
      mapId,
      baseVersion: saved.map.version,
      nodes: saved.map.nodes.map((node) => node.id === 'branch-a'
        ? { ...node, data: { ...node.data, aiConversationId: 'conversation-test' } }
        : node),
      edges: [
        ...saved.map.edges,
        {
          id: 'knowledge-branch-a-task-a', source: 'branch-a', target: 'task-a', type: 'bezier',
          data: { relation: 'knowledge', knowledgePolicy: 'reuse-first' },
        },
        {
          id: 'knowledge-root-task-a', source: 'root', target: 'task-a', type: 'bezier',
          data: { relation: 'knowledge', knowledgePolicy: 'inspect-if-insufficient' },
        },
      ],
    })
    assert.ok(knowledgeSaved.map.edges.some((edge) => edge.data?.relation === 'knowledge'))
    assert.ok(knowledgeSaved.map.edges.every((edge) => edge.type === 'default'))

    const knowledgeContext = await invoke('mindnprogress_get_context', {
      mapId,
      cardId: 'task-a',
      editorId: attribution.editorId,
      attributionToken: attribution.attributionToken,
    })
    assert.equal(knowledgeContext.selection.taskLinks.startupInspection.mode, 'knowledge-guided')
    assert.deepEqual(knowledgeContext.selection.parents.map((card) => card.id), ['branch-a'])
    assert.deepEqual(knowledgeContext.selection.knowledgeSources.primary.map((source) => source.card.id), ['branch-a'])
    assert.deepEqual(knowledgeContext.selection.knowledgeSources.fallback.map((source) => source.card.id), ['root'])
    assert.equal(knowledgeContext.selection.knowledgeSources.primary[0].card.data.sharedKnowledge, '기능 A의 재사용 가능한 결정과 결과')
    assert.equal(knowledgeContext.selection.knowledgeSources.primary[0].comments[0].id, knowledgeComment.comment.id)
    assert.equal(knowledgeContext.selection.knowledgeSources.primary[0].comments[0].detail, undefined)
    assert.equal(knowledgeContext.selection.knowledgeSources.primary[0].comments[0].hasDetail, true)
    assert.equal(knowledgeContext.selection.knowledgeSources.primary[0].commentsPage.total, 1)
    assert.deepEqual(knowledgeContext.selection.knowledgeSources.primary[0].commentsPage.detailToolArguments, {
      mapId,
      cardId: 'branch-a',
      offset: 0,
      limit: 1,
      order: 'desc',
      includeDetail: true,
    })
    assert.equal(knowledgeContext.selection.knowledgeSources.fallback[0].card.data, undefined)
    assert.deepEqual(knowledgeContext.selection.knowledgeSources.fallback[0].detailToolArguments, {
      mapId,
      cardId: 'root',
      includeCommentDetail: true,
    })
    assert.equal(knowledgeContext.selection.knowledgeSources.all, undefined)
    assert.deepEqual(knowledgeContext.selection.taskLinks.startupInspection.targets.map((target) => target.url), ['https://example.com/task-a'])
    assert.deepEqual(knowledgeContext.selection.taskLinks.startupInspection.fallbackTargets.map((target) => target.url), ['https://example.com/root'])
    assert.deepEqual(knowledgeContext.selection.taskLinks.startupInspection.conversationInspection, {
      mode: 'on-demand',
      required: false,
      tool: 'mindnprogress_get_ai_conversation_transcript',
      sources: [{
        cardId: 'branch-a',
        label: '기능 A',
        conversationAvailable: true,
        toolArguments: { mapId, cardId: 'branch-a' },
      }],
      triggers: [
        '공유 지식, 설명과 댓글만으로 현재 작업에 필요한 결정 근거가 부족함',
        '예외 조건 또는 이전 실패 원인을 확인해야 함',
        '공유 지식과 댓글이 서로 충돌하여 원래 대화 맥락이 필요함',
        '사용자가 과거 AI 대화를 직접 확인하도록 요청함',
      ],
      instruction: 'primarySources의 sharedKnowledge, 설명과 댓글을 먼저 사용하세요. 그래도 현재 작업에 필요한 결정 근거, 예외 조건 또는 이전 실패 원인이 구체적으로 부족할 때만 sources 중 필요한 카드의 toolArguments로 대화 기록을 조회하세요.',
      evidenceRule: '대화 내용은 보조 근거로 취급합니다. 실제 코드와 산출물로 검증하고, 대화 전문을 댓글이나 sharedKnowledge에 복사하지 말며, 검증된 재사용 가능 결론만 sharedKnowledge에 요약하세요.',
    })

    const sourceImage = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const imageUploadResponse = await fetch(`${apiBaseUrl}/api/maps/${encodeURIComponent(mapId)}/images`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png', Cookie: sessionCookie },
      body: sourceImage,
    })
    assert.equal(imageUploadResponse.status, 201)
    const uploadedImage = (await imageUploadResponse.json()).image
    const imageCardId = 'image-primary-knowledge'
    const imageNode = {
      id: imageCardId,
      type: 'mind',
      position: { x: 700, y: 500 },
      data: {
        label: 'image.png',
        description: '화면 기획 원본',
        progress: 0,
        status: 'planned',
        kind: 'image',
        image: {
          assetId: uploadedImage.assetId,
          fileName: 'image.png',
          mimeType: uploadedImage.mimeType,
          naturalWidth: 1920,
          naturalHeight: 1080,
          displayWidth: 640,
          displayHeight: 360,
        },
      },
    }
    await invoke('mindnprogress_save_document', {
      mapId,
      baseVersion: knowledgeSaved.map.version,
      nodes: [...knowledgeSaved.map.nodes, imageNode],
      edges: [
        ...knowledgeSaved.map.edges,
        {
          id: 'knowledge-image-task-a',
          source: imageCardId,
          target: 'task-a',
          data: { relation: 'knowledge', knowledgePolicy: 'reuse-first' },
        },
      ],
    })

    const expectedImageLocalPath = path.resolve(testDataDirectory, '_assets', mapId, uploadedImage.assetId)
    await access(expectedImageLocalPath)
    const imageKnowledgeContext = await invoke('mindnprogress_get_context', {
      mapId,
      cardId: 'task-a',
      editorId: attribution.editorId,
      attributionToken: attribution.attributionToken,
    })
    const primaryImageSource = imageKnowledgeContext.selection.knowledgeSources.primary
      .find((source) => source.card.id === imageCardId)
    assert.equal(primaryImageSource.imageAccess.mode, 'local-file')
    assert.equal(primaryImageSource.imageAccess.localPath, expectedImageLocalPath)
    assert.equal(primaryImageSource.imageAccess.mimeType, 'image/png')
    const startupImageSource = imageKnowledgeContext.selection.taskLinks.startupInspection.primarySources
      .find((source) => source.cardId === imageCardId)
    assert.equal(startupImageSource.kind, 'image')
    assert.equal(startupImageSource.imageAccess.localPath, expectedImageLocalPath)
    assert.match(imageKnowledgeContext.selection.taskLinks.startupInspection.instruction, /imageAccess\.localPath.*로컬 이미지 열람 도구/)

    const imageCardDetail = await invoke('mindnprogress_get_card', { mapId, cardId: imageCardId })
    assert.equal(imageCardDetail.card.imageAccess.localPath, expectedImageLocalPath)
    assert.equal(imageCardDetail.card.data.description, '화면 기획 원본')
    const imageDocument = await invoke('mindnprogress_get_document', { mapId })
    assert.equal(
      imageDocument.access.cards.find((card) => card.cardId === imageCardId)?.imageAccess.localPath,
      expectedImageLocalPath,
    )

    const cardDetail = await invoke('mindnprogress_get_card', {
      mapId,
      cardId: 'task-a',
      commentLimit: 1,
      commentOrder: 'desc',
    })
    assert.equal(cardDetail.card.id, 'task-a')
    assert.equal(cardDetail.card.position, undefined)
    assert.equal(cardDetail.comments.length, 1)
    assert.ok(cardDetail.commentsPage.total >= 2)
    assert.equal(cardDetail.commentsPage.hasMore, true)
    assert.equal(cardDetail.accessUrl, `https://mindnprogress.test/mindmap/${mapId}/task-a`)

    const commentPage = await invoke('mindnprogress_list_comments', {
      mapId,
      cardId: 'task-a',
      offset: 0,
      limit: 1,
      order: 'desc',
    })
    assert.equal(commentPage.comments.length, 1)
    assert.ok(commentPage.total >= 2)
    assert.equal(commentPage.hasMore, true)
    assert.equal(commentPage.nextOffset, 1)
    const knowledgeCommentDetail = await invoke('mindnprogress_list_comments', {
      mapId,
      cardId: 'branch-a',
      includeDetail: true,
    })
    assert.equal(knowledgeCommentDetail.comments[0].detail, '검증된 결정과 적용 범위를 공유 지식과 함께 확인했습니다.')
    await invokeExpectError('mindnprogress_update_card', {
      mapId,
      cardId: 'task-a',
      nodeId: 'branch-a',
      data: {},
    }, /cardId와 호환용 nodeId의 값이 서로 다릅니다/)
    await invokeExpectError('mindnprogress_update_card', { mapId, data: {} }, /cardId를 입력해 주세요/)

    const history = await invoke('mindnprogress_list_history', { mapId, limit: 1 })
    assert.equal(history.revisions.length, 1)
    assert.equal(history.hasMore, true)
    assert.equal(history.nextOffset, 1)
    const nextHistory = await invoke('mindnprogress_list_history', { mapId, offset: history.nextOffset, limit: 1 })
    assert.equal(nextHistory.revisions.length, 1)
    assert.notEqual(nextHistory.revisions[0].id, history.revisions[0].id)
    const restoredHistory = await invoke('mindnprogress_restore_history', { mapId, revisionId: history.revisions[0].id })
    assert.equal(restoredHistory.map.id, mapId)

    const addedCardResult = await invoke('mindnprogress_add_card', {
      mapId,
      parentCardId: 'root',
      data: { label: '추가 카드', description: '', kind: 'branch', status: 'planned', progress: 0 },
    })
    const addedCard = addedCardResult.map.nodes.find((node) => node.data.label === '추가 카드')
    assert.ok(addedCard)
    assert.equal(addedCard.data.sharedKnowledge, '')
    assert.equal(addedCard.position.x % 24, 0)
    assert.equal(addedCard.position.y % 24, 0)

    const secondAddedCardResult = await invoke('mindnprogress_add_card', {
      mapId,
      parentId: 'root',
      data: { label: '두 번째 추가 카드', description: '', kind: 'branch', status: 'planned', progress: 0 },
    })
    const secondAddedCard = secondAddedCardResult.map.nodes.find((node) => node.data.label === '두 번째 추가 카드')
    assert.ok(secondAddedCard)
    assert.equal(secondAddedCard.position.x, addedCard.position.x)
    assert.equal(secondAddedCard.position.y - addedCard.position.y, 144)

    const waitingCardResult = await invoke('mindnprogress_update_card', {
      mapId,
      cardId: addedCard.id,
      data: {
        description: '부분 병합 보존 설명',
        kind: 'task',
        isWork: true,
        status: 'in-progress',
        progress: 40,
        taskUrl: 'https://example.com/partial-merge',
        assigneeId: attribution.editorId,
        dueDate: '2026-07-30',
        checklist: [{ id: 'check-partial-merge', text: '부분 병합 보존', done: false }],
        blockedBy: ['task-a'],
        aiConversationId: 'conversation-partial-merge',
        waitingItems: [{ label: '캐릭터 아트 전달', resumeCondition: '최종 PNG 수령' }],
      },
    })
    const waitingCard = waitingCardResult.map.nodes.find((node) => node.id === addedCard.id)
    assert.equal(waitingCard.data.label, '추가 카드')
    assert.equal(waitingCard.data.waitingItems[0].label, '캐릭터 아트 전달')
    assert.ok(waitingCard.data.waitingItems[0].id)
    assert.ok(waitingCard.data.waitingItems[0].since)
    assert.equal(waitingCardResult.map.nodes.find((node) => node.id === 'root')?.data.progress, 35)
    assert.equal(waitingCardResult.map.nodes.find((node) => node.id === 'root')?.data.status, 'in-progress')

    const partialMergePreservedFields = [
      'label',
      'description',
      'progress',
      'status',
      'kind',
      'taskUrl',
      'isWork',
      'assigneeId',
      'dueDate',
      'checklist',
      'blockedBy',
      'waitingItems',
      'aiConversationId',
    ]
    const preservedCardData = Object.fromEntries(
      partialMergePreservedFields.map((field) => [field, waitingCard.data[field]]),
    )
    const partialUpdateResult = await invoke('mindnprogress_update_card', {
      mapId,
      cardId: addedCard.id,
      data: { sharedKnowledge: '공유 지식만 부분 수정' },
    })
    const partiallyUpdatedCard = partialUpdateResult.map.nodes.find((node) => node.id === addedCard.id)
    assert.equal(partiallyUpdatedCard.data.sharedKnowledge, '공유 지식만 부분 수정')
    assert.deepEqual(
      Object.fromEntries(partialMergePreservedFields.map((field) => [field, partiallyUpdatedCard.data[field]])),
      preservedCardData,
    )
    assert.deepEqual(partiallyUpdatedCard.position, waitingCard.position)

    const updatedCardResult = await invoke('mindnprogress_update_card', {
      mapId,
      cardId: addedCard.id,
      data: {
        label: '수정된 업무 카드', description: '업데이트 검증', sharedKnowledge: '후속 카드가 재사용할 완료 결과', kind: 'task', isWork: true,
        status: 'done', progress: 100, dueDate: '2026-07-31', checklist: [{ id: 'check-regression', text: '완료 조건', done: true }],
      },
      position: { x: 700, y: 220 },
    })
    const updatedCard = updatedCardResult.map.nodes.find((node) => node.id === addedCard.id)
    assert.equal(updatedCard.data.progress, 100)
    assert.deepEqual(updatedCard.data.waitingItems, [])
    assert.equal(updatedCard.data.sharedKnowledge, '후속 카드가 재사용할 완료 결과')
    assert.equal(updatedCard.data.sharedKnowledgeUpdatedBy.name, 'Claude Code(Claude Test Model)')
    assert.ok(updatedCard.data.sharedKnowledgeUpdatedAt)
    assert.equal(updatedCardResult.map.nodes.find((node) => node.id === 'root')?.data.progress, 65)
    assert.equal(updatedCardResult.map.nodes.find((node) => node.id === 'root')?.data.status, 'in-progress')

    const waitingReleaseNotifications = await invoke('mindnprogress_list_notifications')
    const waitingReleaseNotification = waitingReleaseNotifications.notifications.find((notification) =>
      notification.type === 'waiting-released' && notification.nodeId === addedCard.id)
    assert.ok(waitingReleaseNotification, 'AI가 담당자 본인의 대기를 해제했을 때 알림이 생성되지 않았습니다.')
    assert.equal(waitingReleaseNotification.userId, attribution.editorId)
    assert.equal(waitingReleaseNotification.actor.id, attribution.editorId)
    assert.equal(waitingReleaseNotification.actor.name, 'Claude Code(Claude Test Model)')

    const movedCardResult = await invoke('mindnprogress_move_card', { mapId, cardId: addedCard.id, newParentCardId: 'branch-b' })
    assert.ok(movedCardResult.map.edges.some((edge) => edge.source === 'branch-b' && edge.target === addedCard.id))

    const deletedCardResult = await invoke('mindnprogress_delete_card', { mapId, cardId: addedCard.id, includeDescendants: true })
    assert.ok(!deletedCardResult.map.nodes.some((node) => node.id === addedCard.id))
    assert.equal(deletedCardResult.map.nodes.find((node) => node.id === 'root')?.data.progress, 30)
    await invoke('mindnprogress_delete_card', { mapId, nodeId: secondAddedCard.id, includeDescendants: true })

    documentResult = await invoke('mindnprogress_get_document', { mapId })
    const metadataResult = await invoke('mindnprogress_update_document_info', {
      mapId, baseVersion: documentResult.map.version, title: 'MCP 전체 회귀 문서 수정', color: 'red',
    })
    assert.equal(metadataResult.summary.color, 'red')

    const savedDocumentLayout = await invoke('mindnprogress_save_document_layout', {
      documentLayout: {
        version: 1,
        items: [
          { type: 'group', id: 'group-mcp-regression' },
          { type: 'map', id: secondaryMapId },
        ],
        groups: [{
          id: 'group-mcp-regression',
          name: 'JP-매니저 문서',
          mapIds: [mapId],
        }],
      },
    })
    assert.deepEqual(savedDocumentLayout.documentLayout.items, [
      { type: 'group', id: 'group-mcp-regression' },
      { type: 'map', id: secondaryMapId },
    ])
    assert.deepEqual(savedDocumentLayout.maps.map((map) => map.id), [mapId, secondaryMapId])

    const reordered = await invoke('mindnprogress_reorder_documents', { mapIds: [secondaryMapId, mapId] })
    assert.deepEqual(reordered.maps.map((map) => map.id), [secondaryMapId, mapId])
    assert.equal(reordered.documentLayout.groups[0].id, 'group-mcp-regression')
    assert.deepEqual(reordered.documentLayout.groups[0].mapIds, [mapId])

    const notificationsPath = path.join(testDataDirectory, '_notifications')
    await rm(notificationsPath, { recursive: true, force: true })
    await writeFile(notificationsPath, '알림 디렉터리 접근 실패 회귀 조건', 'utf8')
    const commentWithFailedNotification = await invoke('mindnprogress_add_comment', {
      mapId, cardId: 'root', text: '알림 실패와 무관하게 한 번만 생성되어야 합니다.',
    })
    assert.equal(commentWithFailedNotification.comment.author.name, 'Claude Code(Claude Test Model)')
    let commentList = await invoke('mindnprogress_list_comments', { mapId, nodeId: 'root' })
    assert.equal(commentList.comments.filter((comment) => comment.id === commentWithFailedNotification.comment.id).length, 1)
    const deletedWithFailedNotification = await invoke('mindnprogress_delete_comment', {
      mapId, commentId: commentWithFailedNotification.comment.id,
    })
    assert.deepEqual(deletedWithFailedNotification.deletedIds, [commentWithFailedNotification.comment.id])
    await rm(notificationsPath, { force: true })
    await mkdir(notificationsPath, { recursive: true })

    await writeFile(path.join(notificationsPath, `${attribution.editorId}.json`), '{', 'utf8')
    const parentComment = await invoke('mindnprogress_add_comment', {
      mapId,
      cardId: 'root',
      summary: '[진행] 댓글 상태와 반응을 검증합니다.',
      detail: '답글, 해결 상태, 반응과 수정 후 메타데이터 보존을 순서대로 확인합니다.',
    })
    const replyComment = await invoke('mindnprogress_add_comment', {
      mapId, cardId: 'root', parentCommentId: parentComment.comment.id, text: '답글 검증',
    })
    assert.equal(replyComment.comment.parentId, parentComment.comment.id)
    const resolved = await invoke('mindnprogress_set_comment_resolved', {
      mapId, commentId: parentComment.comment.id, resolved: true,
    })
    assert.ok(resolved.comment.resolvedAt)
    const reacted = await invoke('mindnprogress_toggle_comment_reaction', {
      mapId, commentId: parentComment.comment.id, emoji: '👍',
    })
    assert.ok(reacted.comment.reactions['👍'].includes(attribution.editorId))
    const updatedComment = await invoke('mindnprogress_update_comment', {
      mapId,
      commentId: parentComment.comment.id,
      expectedText: parentComment.comment.text,
      summary: '[결과] 댓글 수정과 메타데이터 보존을 검증했습니다.',
      detail: '작성자, 생성 시각, 해결 상태와 이모지 반응이 수정 뒤에도 유지됩니다.',
    })
    assert.equal(updatedComment.comment.id, parentComment.comment.id)
    assert.equal(updatedComment.comment.text, '[결과] 댓글 수정과 메타데이터 보존을 검증했습니다.')
    assert.equal(updatedComment.comment.summary, updatedComment.comment.text)
    assert.equal(updatedComment.comment.detail, '작성자, 생성 시각, 해결 상태와 이모지 반응이 수정 뒤에도 유지됩니다.')
    assert.equal(updatedComment.comment.contentFormat, 'summary-detail')
    assert.equal(updatedComment.comment.createdAt, parentComment.comment.createdAt)
    assert.equal(updatedComment.comment.author.name, parentComment.comment.author.name)
    assert.equal(updatedComment.comment.resolvedAt, resolved.comment.resolvedAt)
    assert.ok(updatedComment.comment.reactions['👍'].includes(attribution.editorId))
    assert.ok(updatedComment.comment.updatedAt)
    commentList = await invoke('mindnprogress_list_comments', { mapId, nodeId: 'root' })
    assert.equal(commentList.comments.length, 2)
    assert.equal(commentList.comments.find((comment) => comment.id === parentComment.comment.id)?.detail, undefined)
    assert.equal(commentList.comments.find((comment) => comment.id === parentComment.comment.id)?.hasDetail, true)
    assert.equal(commentList.comments.find((comment) => comment.id === replyComment.comment.id)?.parentId, parentComment.comment.id)
    const deletedThread = await invoke('mindnprogress_delete_comment', { mapId, commentId: parentComment.comment.id })
    assert.equal(deletedThread.deletedIds.length, 2)

    const integrationNotifications = [
      { id: 'notification-regression-1', userId: attribution.editorId, createdAt: '2026-07-17T00:00:00.000Z', readAt: null, message: '첫 알림' },
      { id: 'notification-regression-2', userId: attribution.editorId, createdAt: '2026-07-17T00:01:00.000Z', readAt: null, message: '둘째 알림' },
    ]
    await writeFile(path.join(notificationsPath, `${attribution.editorId}.json`), `${JSON.stringify(integrationNotifications, null, 2)}\n`, 'utf8')
    const notificationList = await invoke('mindnprogress_list_notifications')
    assert.equal(notificationList.notifications.length, 2)
    const readOne = await invoke('mindnprogress_mark_notification_read', { notificationId: 'notification-regression-1' })
    assert.ok(readOne.notification.readAt)
    const readAll = await invoke('mindnprogress_mark_all_notifications_read')
    assert.ok(readAll.notifications.every((notification) => notification.readAt))

    const trashed = await invoke('mindnprogress_move_document_to_trash', { mapId: secondaryMapId })
    assert.equal(trashed.trashedId, secondaryMapId)
    let trash = await invoke('mindnprogress_list_trash')
    assert.ok(trash.maps.some((map) => map.id === secondaryMapId))
    const restored = await invoke('mindnprogress_restore_document', { mapId: secondaryMapId })
    assert.equal(restored.map.id, secondaryMapId)
    await invoke('mindnprogress_move_document_to_trash', { mapId: secondaryMapId })
    const permanentlyDeleted = await invoke('mindnprogress_delete_trashed_documents', {
      mapIds: [secondaryMapId], confirmPermanentDeletion: true,
    })
    assert.deepEqual(permanentlyDeleted.deletedIds, [secondaryMapId])

    const emptyTarget = await invoke('mindnprogress_create_document', {
      title: '전체 비우기 대상', color: 'amber', rootLabel: '비우기 대상', rootDescription: '',
    })
    await invoke('mindnprogress_move_document_to_trash', { mapId: emptyTarget.map.id })
    const emptied = await invoke('mindnprogress_empty_trash', { confirmPermanentDeletion: true })
    assert.ok(emptied.deletedIds.includes(emptyTarget.map.id))
    trash = await invoke('mindnprogress_list_trash')
    assert.equal(trash.maps.length, 0)

    const finalDocument = await invoke('mindnprogress_get_document', { mapId })
    assert.equal(finalDocument.map.id, mapId)
    assert.ok(!finalDocument.map.nodes.some((node) => node.id === secondaryRootId))

    await invokeExpectError('mindnprogress_create_mindmap', {
      title: '잘못된 다중 루트',
      cards: [
        { key: 'root-a', label: '루트 A', kind: 'root' },
        { key: 'root-b', label: '루트 B', kind: 'root' },
      ],
    }, /루트 카드는 정확히 하나/)
    await invokeExpectError('mindnprogress_create_mindmap', {
      title: '잘못된 하위 루트',
      cards: [
        { key: 'root', label: '루트', kind: 'root' },
        { key: 'nested-root', parentKey: 'root', label: '하위 루트', kind: 'root' },
      ],
    }, /하위 카드는 kind=root/)
    await invokeExpectError('mindnprogress_save_document', {
      mapId,
      baseVersion: Math.max(1, finalDocument.map.version - 1),
      nodes: finalDocument.map.nodes,
      edges: finalDocument.map.edges,
    }, /다른 사용자가 먼저/)
    await invokeExpectError('mindnprogress_move_card', {
      mapId, nodeId: 'branch-a', newParentId: 'task-a',
    }, /자기 자신이나 하위 카드/)
    await invokeExpectError('mindnprogress_delete_card', {
      mapId, nodeId: 'root', includeDescendants: true,
    }, /루트 카드는 삭제할 수 없습니다/)
    await invokeExpectError('mindnprogress_add_comment', {
      mapId, nodeId: 'missing-card', text: '존재하지 않는 카드',
    }, /댓글을 남길 노드를 찾을 수 없습니다/)
    await invokeExpectError('mindnprogress_update_comment', {
      mapId, commentId: 'missing-comment', text: '존재하지 않는 댓글',
    }, /댓글을 찾을 수 없습니다/)
    await invokeExpectError('mindnprogress_restore_history', {
      mapId, revisionId: 'missing-revision',
    }, /변경 이력을 찾을 수 없습니다/)
    await invokeExpectError('mindnprogress_delete_trashed_documents', {
      mapIds: [mapId], confirmPermanentDeletion: false,
    }, /Invalid literal value|Invalid input/)
    await invokeExpectError('mindnprogress_empty_trash', {
      confirmPermanentDeletion: false,
    }, /Invalid literal value|Invalid input/)
    await invokeExpectError('mindnprogress_save_document_layout', {
      documentLayout: {
        version: 1,
        items: [],
        groups: [],
      },
    }, /문서 그룹과 순서 데이터가 올바르지 않습니다/)
    await invokeExpectError('mindnprogress_mark_notification_read', {
      notificationId: 'missing-notification',
    }, /알림을 찾을 수 없습니다/)
    await invokeExpectError('mindnprogress_move_document_to_trash', { mapId }, /마지막 문서/)

    const afterRejectedOperations = await invoke('mindnprogress_get_document', { mapId })
    assert.equal(afterRejectedOperations.map.version, finalDocument.map.version)

    const attributionExpiresAt = Number(attribution.expiresAt)
    assert.ok(Number.isFinite(attributionExpiresAt), 'AI 귀속 만료 시각이 숫자가 아닙니다.')
    const attributionExpiryDelay = Math.max(0, attributionExpiresAt - Date.now() + 100)
    await new Promise((resolve) => setTimeout(resolve, attributionExpiryDelay))
    const postExpiryTransport = new StdioClientTransport({
      command: process.execPath,
      args: ['mcp/server.mjs'],
      cwd: projectDirectory,
      env: environment,
      stderr: 'pipe',
    })
    const postExpiryClient = new Client({ name: 'mindnprogress-post-expiry-without-token', version: '1.0.0' })
    await postExpiryClient.connect(postExpiryTransport)
    try {
      const persistedComment = parseToolResult('mindnprogress_add_comment', await postExpiryClient.callTool({
        name: 'mindnprogress_add_comment',
        arguments: { mapId, nodeId: 'task-a', text: '토큰 만료 후 새 MCP 세션의 연결 대화 귀속 검증' },
      }))
      assert.equal(persistedComment.comment.author.name, 'Claude Code(Claude Test Model)')
    } finally {
      await postExpiryClient.close()
    }

    const deleteLinkEditorLoginResponse = await fetch(`${apiBaseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'mcp-test-editor@mind.local', password: 'McpEditor!2026' }),
    })
    assert.equal(deleteLinkEditorLoginResponse.status, 200)
    editorSessionCookie = deleteLinkEditorLoginResponse.headers.get('set-cookie')?.split(';')[0]
    assert.ok(editorSessionCookie, '대화 연결 삭제용 테스트 편집자 세션 쿠키가 없습니다.')
    const deleteConversationLinkResponse = await fetch(`${apiBaseUrl}/api/maps/${encodeURIComponent(mapId)}/cards/task-a/ai-conversations/conversation-test`, {
      method: 'DELETE',
      headers: { Cookie: editorSessionCookie, 'X-MNP-Client': 'mcp-test-client' },
    })
    assert.equal(deleteConversationLinkResponse.status, 200)
    const deletedConversationLink = await deleteConversationLinkResponse.json()
    assert.equal(deletedConversationLink.removedConversationId, 'conversation-test')
    assert.equal(deletedConversationLink.latestConversationId, null)
    assert.equal(deletedConversationLink.card.data.aiConversationId, undefined)
    assert.equal(deletedConversationLink.card.data.aiConversations, undefined)
    const emptyConversationListResponse = await fetch(`${apiBaseUrl}/api/maps/${encodeURIComponent(mapId)}/cards/task-a/ai-conversations`, {
      headers: { Cookie: editorSessionCookie },
    })
    assert.equal(emptyConversationListResponse.status, 200)
    const emptyConversationList = await emptyConversationListResponse.json()
    assert.equal(emptyConversationList.latestConversationId, null)
    assert.deepEqual(emptyConversationList.conversations, [])
    const repeatedDeleteConversationLinkResponse = await fetch(`${apiBaseUrl}/api/maps/${encodeURIComponent(mapId)}/cards/task-a/ai-conversations/conversation-test`, {
      method: 'DELETE',
      headers: { Cookie: editorSessionCookie },
    })
    assert.equal(repeatedDeleteConversationLinkResponse.status, 404)

    const uncalledTools = registeredToolNames.filter((name) => !calledTools.has(name))
    assert.deepEqual(uncalledTools, [], `호출되지 않은 MCP 도구: ${uncalledTools.join(', ')}`)
    console.log(JSON.stringify({
      registeredTools: registeredToolNames.length,
      calledTools: calledTools.size,
      totalCalls: [...calledTools.values()].reduce((sum, count) => sum + count, 0),
      status: 'passed',
    }, null, 2))
  } catch (error) {
    if (serverLogs.length > 0) console.error(serverLogs.join(''))
    throw error
  } finally {
    if (client) await client.close().catch(() => undefined)
    if (apiServer.exitCode === null) {
      apiServer.kill()
      await new Promise((resolve) => apiServer.once('exit', resolve))
    }
    await new Promise((resolve) => mockAionUi.server.close(resolve))
    await rm(testDataDirectory, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
