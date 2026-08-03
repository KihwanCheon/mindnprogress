import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataDirectory = path.resolve(String(process.env.MNP_DATA_DIR ?? '').trim() || path.join(projectDirectory, 'server', 'data'))
const tokenFile = path.resolve(String(process.env.MNP_TOKEN_FILE ?? '').trim() || path.join(dataDirectory, '_integration-token'))
const apiBaseUrl = String(process.env.MNP_API_URL ?? 'http://127.0.0.1:4176').replace(/\/+$/, '')
const contextSchemaVersion = '2.0'
const contextCommentLimit = 20
const mindMapGridSize = 24
const mindMapChildHorizontalOffset = mindMapGridSize * 13
const mindMapWorkNodeVerticalStep = mindMapGridSize * 6
let activeAttributionToken = ''
let activeEditorId = ''
let activeAiType = ''
let activeAiModel = ''
let activeMapId = ''
let activeCardId = ''

function snapMindMapPosition(position) {
  return {
    x: Math.round(position.x / mindMapGridSize) * mindMapGridSize,
    y: Math.round(position.y / mindMapGridSize) * mindMapGridSize,
  }
}

function defaultChildMindMapPosition(parentPosition, siblingPositions) {
  const alignedParentPosition = snapMindMapPosition(parentPosition)
  const nextY = siblingPositions.length > 0
    ? Math.max(...siblingPositions.map((position) => snapMindMapPosition(position).y)) + mindMapWorkNodeVerticalStep
    : alignedParentPosition.y
  return {
    x: alignedParentPosition.x + mindMapChildHorizontalOffset,
    y: nextY,
  }
}

const serverInstructions = `MindNProgress는 마인드맵과 업무 진행 관리를 결합한 웹 서비스입니다. MindNProgress 밖에서 시작해 문서 ID나 카드 ID가 없다면 mindnprogress_read_me_first를 먼저 호출하세요. 선택 문서와 카드가 있다면 mindnprogress_get_context로 제품 규칙과 최신 문서 구조를 먼저 확인하세요. AionUi가 발급한 attributionToken이 없는 외부 MCP 세션은 자신이 현재 AI 종류와 모델을 정확히 알고 있을 때 get_context의 aiType과 aiModel에 함께 전달하고, 알지 못하면 추측하지 마세요. get_context의 selection.taskLinks.startupInspection을 따르세요. mode가 knowledge-guided이면 primary 선행 지식의 sharedKnowledge를 먼저 재사용하고 설명과 댓글로 보완하며, fallbackSources와 fallbackTargets는 정보가 부족할 때만 선택적으로 조사합니다. mode가 default이고 required가 true이면 targets의 업무 본문, 댓글, 첨부파일 목록과 관련 링크를 조사하세요. 진행 과정과 결과는 댓글에 기록하고, 다른 카드나 후속 세션이 재사용할 안정적인 사실·결정·제약은 카드의 sharedKnowledge에 요약하세요. AI 댓글은 1~2문장의 summary와 작업을 이어가거나 검증하는 데 필요한 사실을 충실히 담은 detail로 작성하며, 요약 때문에 상세를 축약하지 마세요. 외부 전달물이나 결정 대기는 waitingItems로 기록하고 제목에 대기 문구를 붙이지 마세요. 대기를 등록할 때는 [차단], 해제할 때는 [진행] 댓글로 이유와 재개 상태를 기록하세요. 카드 일부 필드만 변경할 때는 mindnprogress_update_card의 data에 변경할 필드만 보내고 현재 카드 전체 데이터를 재전송하지 마세요. 일반 카드에서 생략한 필드와 위치는 보존되지만 완료 상태 또는 진행률 100 적용 시 waitingItems는 자동으로 해제되며, Ref 카드는 원본 관리 필드가 최신 원본 값으로 동기화될 수 있습니다. 지식선만 변경할 때는 전체 문서를 다시 보내지 말고 지식선 전용 도구를 사용하세요. 조회 도구는 문서 버전을 변경하지 않지만 카드·관계 편집과 AI 대화 ID 연결은 버전을 증가시킬 수 있습니다. 특정 자료가 있다고 가정하지 마세요. 여러 카드로 구성된 새 문서는 mindnprogress_create_mindmap으로 한 번에 생성하고, 변경 후에는 최신 문서를 다시 조회해 결과를 검증하세요. 비밀번호 변경과 계정 관리 작업은 지원하지 않습니다.`
const productGuide = {
  version: '1.6',
  product: {
    name: 'MindNProgress',
    purpose: '아이디어를 계층형 마인드맵으로 구조화하고 실행 업무의 진행 상황을 같은 문서에서 관리하는 웹 서비스',
    roles: {
      editor: '문서, 카드, 업무, 관계, 체크리스트와 댓글을 생성·변경할 수 있음',
      viewer: '내용과 링크를 열람할 수 있지만 문서를 변경할 수 없음',
    },
  },
  dataModel: {
    document: '하나의 마인드맵. 제목, 아이콘 색상, 버전, 카드(nodes), 계층선과 지식선(edges)을 가짐',
    documentLayout: '좌측 목록에서 개별 문서와 1단계 그룹을 섞어 배치하는 구조. 그룹 안에는 문서 ID와 순서를 저장하며 그룹 중첩은 지원하지 않음',
    hierarchy: 'data.relation이 knowledge가 아닌 edge에서 source가 상위 카드이고 target이 하위 카드임. 루트 카드는 문서당 하나를 권장',
    knowledgeLine: 'data.relation=knowledge인 edge는 source 카드의 결과를 target 카드가 선행 지식으로 사용함. knowledgePolicy는 reuse-first 또는 inspect-if-insufficient',
    cardContent: {
      description: '업무의 목적, 범위, 요구사항과 완료 조건. 사용자가 작성한 원래 맥락을 보존함',
      sharedKnowledge: '다른 카드나 후속 AI 세션에서 재사용할 안정적인 사실, 결정, 제약, 조사 결과와 사용 방법',
      comments: '시간순 진행 과정, 검증 결과, 차단 사유와 완료 기록. 새 댓글은 요약과 접을 수 있는 상세 내용으로 구분',
    },
    cardKinds: {
      root: '문서의 최상위 주제',
      branch: '주제나 영역을 묶는 중간 분류',
      task: '구체적인 실행 항목. 실제 업무라면 isWork=true로 설정',
    },
    workFields: {
      progress: '0~100의 진행률. 100이면 완료로 표시. 최상위 카드의 진행률·상태는 저장 시 서버가 계층 안의 모든 isWork=true 업무 진행률을 동일 가중치로 평균해 자동 재계산함',
      status: 'planned, in-progress, done. done은 progress=100과 함께 사용',
      assigneeId: '담당자 사용자 ID. 담당자가 없으면 생략',
      dueDate: '마감일. 없는 업무는 생략',
      taskUrl: '관련 업무 링크. 링크가 없는 경우 생략',
      taskUrlContext: 'AI 대화 문맥에서는 선택 카드와 해당 계층의 최상위 카드 링크를 별도로 제공하며, 하위 카드에 링크를 상속하거나 덮어쓰지 않음',
      checklist: '세부 실행 항목. 체크 상태에 따라 진행률을 계산할 수 있음',
      blockedBy: '현재 업무보다 먼저 완료되어야 하는 카드 ID 목록. 계층 관계를 표현하는 용도로 사용하지 않음',
      waitingItems: '서버·아트·기획 등 외부 전달물이나 결정 대기 목록. label은 자유 입력하며 note, resumeCondition, since를 함께 기록할 수 있음. 상태와 진행률에는 영향을 주지 않음',
    },
  },
  views: {
    mindmap: '모든 카드의 계층과 연결 관계를 공간적으로 표시',
    kanban: 'isWork=true인 업무 카드를 상태별로 표시',
    timeline: 'isWork=true인 업무 중 일정 정보를 기준으로 표시',
    dashboard: '업무 진행률, 완료 상태와 병목을 요약',
  },
  commentRules: {
    summary: '현재 상태와 핵심 결과를 1~2문장으로 전달. [진행], [차단], [결과] 중 알맞은 머리말로 시작',
    detail: '다른 AI 세션이나 편집자가 댓글만 읽어도 작업을 이어가거나 결과를 검증할 수 있도록 현재 작업에 해당하는 수행 내용, 중요한 판단, 변경 범위, 검증 방법과 실제 결과, 산출물, 제한사항, 다음 단계 또는 재개 조건을 구체적으로 기록',
    detailRequired: '코드·문서·카드 변경, 외부 시스템 처리, 검증, 중요한 결정, 실패 또는 차단이 발생하면 상세를 작성. 새로운 사실이 없는 단순 상태 알림만 상세 생략 가능',
    omit: '해당하지 않는 빈 항목, 개별 도구 호출 목록, 의미 없는 반복, 원문 로그 전체와 카드 본문의 단순 복사는 제외',
    legacy: 'contentFormat이 summary-detail이 아닌 기존 댓글은 마이그레이션 전 원문이므로 요청 없이 자동 분리하거나 다시 쓰지 않음',
  },
  authoringRules: [
    '루트는 전체 목적이나 프로젝트 이름으로 작성',
    '루트 아래에는 보통 3~7개의 핵심 영역을 branch로 구성',
    '실행 가능한 단위는 task로 만들고 실제 추적 대상이면 isWork=true로 지정',
    '계층 깊이는 보통 2~4단계로 유지하고 중복되는 카드는 합침',
    '제목은 짧고 명확하게, description에는 목적·범위·요구사항·완료 조건을 기록',
    '다른 카드나 후속 세션이 재사용할 내용은 sharedKnowledge에 요약하고 진행 과정은 댓글에 기록',
    'sharedKnowledge를 수정할 때 기존 description의 사용자 요청과 배경을 임의로 덮어쓰지 않음',
    '존재하지 않는 담당자, 불필요한 업무 링크와 임의의 선행 관계를 만들지 않음',
    '문서 내부 선행 업무는 blockedBy, 외부 전달물·결정 대기는 waitingItems로 구분하고 제목에 “(서버 대기)” 같은 문구를 붙이지 않음',
    '진행률이 100이면 status=done, 완료가 아니면 progress를 100 미만으로 유지',
    '최상위 카드의 진행률과 상태는 저장 시 서버가 자동 재계산(최상위 카드를 제외한 계층 안의 모든 isWork=true 업무 진행률을 동일 가중치 평균 후 반올림, 100이면 done, 1~99면 in-progress, 0이면 기존 상태 유지, 집계 대상이 없으면 변경 없음)하므로 수동으로 계산해 덮어쓰지 않음. 단순 묶음 카드는 branch 또는 isWork=false로 구성',
  ],
  operationRules: [
    '분석과 편집 전에 mindnprogress_get_context로 최신 버전과 제품 규칙을 확인',
    'get_context의 startupInspection.mode가 knowledge-guided이면 주요 선행 지식을 먼저 활용하고 fallback은 정보가 부족할 때만 조사',
    'startupInspection.mode가 default이고 조사가 요구되면 실제 작업 전에 선택 카드와 최상위 카드의 업무 링크를 조사하되 특정 첨부나 자료가 있다고 가정하지 않음',
    '여러 카드로 새 문서를 만들 때 mindnprogress_create_mindmap을 한 번만 호출',
    '문서 그룹이나 혼합 순서를 변경할 때 먼저 전체 문서와 documentLayout을 조회하고 모든 활성 문서를 정확히 한 번 유지',
    'create_document 후 save_document를 연속 호출해 전체 구조를 만들지 않음',
    '지식선 추가·정책 변경·삭제는 전체 save_document 대신 지식선 전용 도구를 사용',
    '카드 일부 필드만 변경할 때 mindnprogress_update_card의 data에는 변경할 필드만 보내고 현재 카드 전체 데이터를 재전송하지 않음. 일반 카드에서 생략한 필드와 위치는 보존되지만 완료 상태 또는 진행률 100 적용 시 waitingItems가 자동으로 해제되며 Ref 카드는 원본 관리 필드가 최신 원본 값으로 동기화될 수 있음',
    '조회 도구는 문서 version을 변경하지 않으며 카드·관계 편집과 AI 대화 ID 연결 같은 저장 작업만 version을 증가시킴',
    '기존 문서 변경은 최신 version을 기준으로 수행하고 버전 충돌 시 최신 상태를 다시 조회',
    '변경 후 mindnprogress_get_document로 저장 결과를 검증하고 실제 변경 내용을 요약',
    '의미 있는 진행·차단·완료는 요약과 상세로 구분한 댓글로 기록하고, 재사용할 결론은 sharedKnowledge에도 반영',
    '댓글 summary는 [진행](수행 내용·현재 상태·다음 단계), [차단](차단 원인·재개 조건), [결과](완료 내용·검증 결과·산출물) 머리말로 시작하는 1~2문장으로 작성하고, 등록 전에 최근 댓글을 확인해 같은 내용을 반복하지 않음',
    '댓글 detail은 다른 세션이 작업을 이어가거나 결과를 검증하는 데 필요한 수행 내용, 판단, 변경 범위, 검증 방법과 실제 결과, 산출물, 제한사항, 다음 단계 또는 재개 조건 중 해당 내용을 구체적으로 기록하며 summary가 있다는 이유로 상세를 축약하지 않음',
    '코드·문서·카드 변경, 외부 시스템 처리, 검증, 중요한 결정, 실패 또는 차단이 있으면 detail을 작성하고, 새로운 사실이 없는 단순 상태 알림에만 생략. 개별 도구 호출 목록, 의미 없는 반복, 원문 로그 전체와 카드 본문의 단순 복사는 제외',
    'waitingItems가 해제되면 서버가 관련 사용자에게 알림을 자동 생성하므로 별도 알림 요청은 불필요',
    'waitingItems를 등록할 때는 [차단] 댓글에 대기 이유와 재개 조건을, 해제할 때는 [진행] 댓글에 해제 사실과 다음 단계를 기록',
    '문서나 카드 접근 링크를 기록할 때 localhost나 127.0.0.1 주소를 만들지 말고 MCP 응답의 accessUrl을 사용',
    '삭제는 문서를 휴지통으로 이동하는 방식으로 처리',
    '비밀번호 변경이나 관리자 계정 관리는 MCP 범위에 포함하지 않음',
  ],
}

async function integrationToken() {
  const token = (await readFile(tokenFile, 'utf8')).trim()
  if (token.length < 32) throw new Error('MindNProgress 연동 토큰이 준비되지 않았습니다. API 서버를 다시 시작해 주세요.')
  return token
}

async function apiRequest(pathname, init = {}) {
  const token = await integrationToken()
  const { aiMapId, aiCardId, ...requestInit } = init
  const pathnameMapId = pathname.match(/^\/api\/maps\/([^/?]+)/)?.[1]
  const scopedMapId = String(aiMapId ?? (pathnameMapId ? decodeURIComponent(pathnameMapId) : '')).trim()
  const scopedCardId = String(aiCardId ?? (scopedMapId && scopedMapId === activeMapId ? activeCardId : '')).trim()
  const response = await fetch(`${apiBaseUrl}${pathname}`, {
    ...requestInit,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(activeAttributionToken ? { 'X-MNP-AI-Attribution': activeAttributionToken } : {}),
      ...(activeEditorId ? { 'X-MNP-AI-Editor-Id': activeEditorId } : {}),
      ...(!activeAttributionToken && activeAiType && activeAiModel
        ? { 'X-MNP-AI-Type': activeAiType, 'X-MNP-AI-Model': activeAiModel }
        : {}),
      ...(scopedMapId ? { 'X-MNP-AI-Map-Id': scopedMapId } : {}),
      ...(scopedCardId ? { 'X-MNP-AI-Card-Id': scopedCardId } : {}),
      ...(requestInit.body ? { 'Content-Type': 'application/json' } : {}),
      ...requestInit.headers,
    },
    signal: AbortSignal.timeout(10_000),
  })
  const responseText = await response.text()
  let body = null
  if (responseText) {
    try {
      body = JSON.parse(responseText)
    } catch {
      if (!response.ok) throw new Error(`MindNProgress 요청 실패 (${response.status})`)
      return { ok: true, status: response.status }
    }
  }
  if (!response.ok) {
    const error = new Error(body?.error ?? `MindNProgress 요청 실패 (${response.status})`)
    error.status = response.status
    error.code = body?.code
    throw error
  }
  return body ?? { ok: true, status: response.status }
}

function toolResult(value, compact = false) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, compact ? 0 : 2) }] }
}

function documentAccessUrl(publicBaseUrl, mapId) {
  return `${String(publicBaseUrl).replace(/\/+$/, '')}/mindmap/${encodeURIComponent(mapId)}`
}

function cardAccessUrl(publicBaseUrl, mapId, cardId) {
  return `${documentAccessUrl(publicBaseUrl, mapId)}/${encodeURIComponent(cardId)}`
}

function registerTool(server, name, description, schema, handler, options = {}) {
  server.tool(name, description, schema, async (input) => {
    try {
      return toolResult(await handler(input), options.compactResult === true)
    } catch (error) {
      return {
        content: [{ type: 'text', text: error instanceof Error ? error.message : '요청을 처리하지 못했습니다.' }],
        isError: true,
      }
    }
  })
}

async function getDocument(mapId) {
  return (await apiRequest(`/api/maps/${encodeURIComponent(mapId)}`)).map
}

async function saveDocument(map, force = false, aiCardId = '') {
  return apiRequest(`/api/maps/${encodeURIComponent(map.id)}`, {
    method: 'PUT',
    aiCardId,
    body: JSON.stringify({
      map: { nodes: map.nodes, edges: map.edges },
      baseVersion: map.version,
      force,
    }),
  })
}

async function mutateDocument(mapId, aiCardId, mutation, maxAttempts = 3) {
  let lastError = null
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const map = await getDocument(mapId)
    const result = mutation(map)
    try {
      const saved = await saveDocument(map, false, aiCardId)
      return { saved, result }
    } catch (error) {
      lastError = error
      if (error?.code !== 'VERSION_CONFLICT' || attempt === maxAttempts - 1) throw error
    }
  }
  throw lastError ?? new Error('문서를 변경하지 못했습니다.')
}

function isKnowledgeEdge(edge) {
  return edge?.data?.relation === 'knowledge'
}

function isHierarchyEdge(edge) {
  return !isKnowledgeEdge(edge)
}

function knowledgePolicyOf(edge) {
  return edge?.data?.knowledgePolicy === 'inspect-if-insufficient' ? 'inspect-if-insufficient' : 'reuse-first'
}

function createsKnowledgeCycle(sourceId, targetId, edges) {
  if (sourceId === targetId) return true
  const knowledgeEdges = edges.filter(isKnowledgeEdge)
  const visited = new Set()
  const stack = [targetId]
  while (stack.length > 0) {
    const currentId = stack.pop()
    if (!currentId || visited.has(currentId)) continue
    if (currentId === sourceId) return true
    visited.add(currentId)
    knowledgeEdges
      .filter((edge) => edge.source === currentId)
      .forEach((edge) => stack.push(edge.target))
  }
  return false
}

function descendantsOf(nodeId, edges) {
  const hierarchyEdges = edges.filter(isHierarchyEdge)
  const result = new Set()
  const stack = hierarchyEdges.filter((edge) => edge.source === nodeId).map((edge) => edge.target)
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current || result.has(current)) continue
    result.add(current)
    hierarchyEdges.filter((edge) => edge.source === current).forEach((edge) => stack.push(edge.target))
  }
  return result
}

function relatedCards(ids, nodes) {
  const idSet = new Set(ids)
  return nodes.filter((node) => idSet.has(node.id)).map((node) => ({
    id: node.id,
    label: node.data?.label ?? node.id,
    kind: node.data?.kind,
    status: node.data?.progress >= 100 ? 'done' : node.data?.status,
    progress: node.data?.progress ?? 0,
    isWork: Boolean(node.data?.isWork),
    sharedKnowledge: node.data?.sharedKnowledge ?? '',
    waitingItems: Array.isArray(node.data?.waitingItems) ? node.data.waitingItems : [],
  }))
}

function compactCard(node) {
  return {
    id: node.id,
    label: node.data?.label ?? node.id,
    kind: node.data?.kind,
    status: node.data?.progress >= 100 ? 'done' : node.data?.status,
    progress: node.data?.progress ?? 0,
    isWork: Boolean(node.data?.isWork),
    waitingItems: Array.isArray(node.data?.waitingItems)
      ? node.data.waitingItems.map(({ id, label, resumeCondition, since }) => ({ id, label, resumeCondition, since }))
      : [],
  }
}

function compactRelatedCards(ids, nodes) {
  const idSet = new Set(ids)
  return nodes.filter((node) => idSet.has(node.id)).map(compactCard)
}

function contentCard(node) {
  return {
    id: node.id,
    type: node.type ?? 'mind',
    data: node.data ?? {},
  }
}

function focusedDocument(map, publicBaseUrl) {
  const hierarchyEdges = map.edges.filter(isHierarchyEdge)
  const knowledgeEdges = map.edges.filter(isKnowledgeEdge)
  return {
    id: map.id,
    title: map.title,
    color: map.color,
    version: map.version,
    updatedAt: map.updatedAt,
    updatedBy: map.updatedBy,
    accessUrl: documentAccessUrl(publicBaseUrl, map.id),
    stats: {
      cardCount: map.nodes.length,
      hierarchyEdgeCount: hierarchyEdges.length,
      knowledgeEdgeCount: knowledgeEdges.length,
    },
    outline: map.nodes.map((node) => {
      const parentId = hierarchyEdges.find((edge) => edge.target === node.id)?.source ?? null
      return {
        ...compactCard(node),
        parentId,
        childCount: hierarchyEdges.filter((edge) => edge.source === node.id).length,
        blockedByIds: Array.isArray(node.data?.blockedBy) ? node.data.blockedBy : [],
      }
    }),
    knowledgeLinks: knowledgeEdges.map((edge) => ({
      sourceId: edge.source,
      targetId: edge.target,
      policy: knowledgePolicyOf(edge),
    })),
  }
}

function paginateComments(comments, { offset = 0, limit = 50, order = 'desc' } = {}) {
  const ordered = order === 'asc' ? comments : [...comments].reverse()
  const items = ordered.slice(offset, offset + limit)
  const nextOffset = offset + items.length
  return {
    items,
    page: {
      total: comments.length,
      offset,
      limit,
      order,
      hasMore: nextOffset < comments.length,
      nextOffset: nextOffset < comments.length ? nextOffset : null,
    },
  }
}

function focusedCommentWindow(comments, mapId, nodeId) {
  const items = comments.slice(-contextCommentLimit)
  const hasMore = comments.length > items.length
  const hasDetail = items.some((comment) => comment.hasDetail === true)
  return {
    comments: items,
    commentsPage: {
      total: comments.length,
      included: items.length,
      order: 'asc',
      hasMore,
      tool: 'mindnprogress_list_comments',
      detailToolArguments: hasDetail ? {
        mapId,
        nodeId,
        offset: 0,
        limit: Math.max(1, items.length),
        order: 'desc',
        includeDetail: true,
      } : null,
      nextToolArguments: hasMore ? {
        mapId,
        nodeId,
        offset: items.length,
        limit: 50,
        order: 'desc',
        includeDetail: false,
      } : null,
    },
  }
}

function compactTeamMember(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    active: user.active !== false,
  }
}

const mapIdSchema = { mapId: z.string().min(1).describe('문서 ID') }
const documentColor = z.enum(['violet', 'indigo', 'blue', 'cyan', 'teal', 'green', 'amber', 'orange', 'red', 'pink'])
const knowledgePolicySchema = z.enum(['reuse-first', 'inspect-if-insufficient'])
const outlineKey = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/, '카드 key는 영문, 숫자, 밑줄, 하이픈만 사용할 수 있습니다.')
const waitingItemSchema = z.object({
  id: z.string().min(1).max(120).optional(),
  label: z.string().min(1).max(120),
  note: z.string().max(1000).optional(),
  resumeCondition: z.string().max(500).optional(),
  since: z.string().datetime().optional(),
})
const documentLayoutSchema = z.object({
  version: z.literal(1),
  items: z.array(z.discriminatedUnion('type', [
    z.object({ type: z.literal('map'), id: z.string().min(1) }),
    z.object({ type: z.literal('group'), id: z.string().regex(/^group-[a-zA-Z0-9_-]{1,100}$/) }),
  ])).max(1100),
  groups: z.array(z.object({
    id: z.string().regex(/^group-[a-zA-Z0-9_-]{1,100}$/),
    name: z.string().min(1).max(80),
    mapIds: z.array(z.string().min(1)).max(1000),
  })).max(100),
})
const nodeDataSchema = z.object({
  label: z.string().min(1),
  description: z.string().default(''),
  sharedKnowledge: z.string().max(10_000).default(''),
  progress: z.number().min(0).max(100).default(0),
  status: z.enum(['planned', 'in-progress', 'done']).default('planned'),
  kind: z.enum(['root', 'branch', 'task']).default('branch'),
  taskUrl: z.string().optional(),
  isWork: z.boolean().optional(),
  assigneeId: z.string().optional(),
  dueDate: z.string().optional(),
  checklist: z.array(z.object({ id: z.string(), text: z.string(), done: z.boolean() })).optional(),
  blockedBy: z.array(z.string()).optional(),
  waitingItems: z.array(waitingItemSchema).max(20).optional(),
}).passthrough()

const outlineCardSchema = z.object({
  key: outlineKey.describe('문서 안에서 고유한 카드 key'),
  parentKey: outlineKey.optional().describe('상위 카드 key. 루트 카드는 생략'),
  label: z.string().min(1).max(200),
  description: z.string().max(5000).default(''),
  sharedKnowledge: z.string().max(10_000).default(''),
  progress: z.number().min(0).max(100).default(0),
  status: z.enum(['planned', 'in-progress', 'done']).optional(),
  kind: z.enum(['root', 'branch', 'task']).optional(),
  taskUrl: z.string().optional(),
  isWork: z.boolean().optional(),
  assigneeId: z.string().optional(),
  dueDate: z.string().optional(),
  checklist: z.array(z.object({
    text: z.string().min(1).max(500),
    done: z.boolean().default(false),
  })).max(50).optional(),
  blockedBy: z.array(outlineKey).optional().describe('선행 카드 key 목록'),
  waitingItems: z.array(waitingItemSchema.omit({ id: true })).max(20).optional().describe('외부 전달물이나 결정을 기다리는 자유 입력 대기 목록'),
})

function normalizeWaitingItems(items) {
  if (!Array.isArray(items)) return items
  const now = new Date().toISOString()
  return items.map((item) => ({
    ...item,
    id: item.id || `wait-${randomBytes(8).toString('hex')}`,
    since: item.since || now,
  }))
}

function buildMapFromOutline(cards) {
  const cardsByKey = new Map()
  cards.forEach((card) => {
    if (cardsByKey.has(card.key)) throw new Error(`카드 key가 중복되었습니다: ${card.key}`)
    cardsByKey.set(card.key, card)
  })

  const roots = cards.filter((card) => !card.parentKey)
  if (roots.length !== 1) throw new Error('상위 카드가 없는 루트 카드는 정확히 하나여야 합니다.')
  if (roots[0].kind && roots[0].kind !== 'root') throw new Error('상위 카드가 없는 카드는 kind=root이거나 kind를 생략해야 합니다.')
  const nestedRoot = cards.find((card) => card.parentKey && card.kind === 'root')
  if (nestedRoot) throw new Error(`하위 카드는 kind=root으로 지정할 수 없습니다: ${nestedRoot.key}`)

  const childrenByKey = new Map(cards.map((card) => [card.key, []]))
  cards.forEach((card) => {
    if (card.parentKey) {
      if (!cardsByKey.has(card.parentKey)) throw new Error(`상위 카드 key를 찾을 수 없습니다: ${card.parentKey}`)
      if (card.parentKey === card.key) throw new Error(`카드는 자기 자신을 상위 카드로 지정할 수 없습니다: ${card.key}`)
      childrenByKey.get(card.parentKey).push(card.key)
    }
    for (const blockedByKey of card.blockedBy ?? []) {
      if (!cardsByKey.has(blockedByKey)) throw new Error(`선행 카드 key를 찾을 수 없습니다: ${blockedByKey}`)
      if (blockedByKey === card.key) throw new Error(`카드는 자기 자신을 선행 카드로 지정할 수 없습니다: ${card.key}`)
    }
  })

  cards.forEach((card) => {
    const path = new Set()
    let current = card
    while (current.parentKey) {
      if (path.has(current.key)) throw new Error(`카드 계층에 순환 관계가 있습니다: ${card.key}`)
      path.add(current.key)
      current = cardsByKey.get(current.parentKey)
    }
    if (current.key !== roots[0].key) throw new Error(`루트 카드에 연결되지 않은 카드가 있습니다: ${card.key}`)
  })

  let nextLeafRow = 0
  const positions = new Map()
  const layout = (key, depth) => {
    const childKeys = childrenByKey.get(key)
    const childRows = childKeys.map((childKey) => layout(childKey, depth + 1))
    const row = childRows.length > 0
      ? (childRows[0] + childRows[childRows.length - 1]) / 2
      : nextLeafRow++
    positions.set(key, { x: depth * 340, y: row * 180 })
    return row
  }
  layout(roots[0].key, 0)
  const rootY = positions.get(roots[0].key).y

  const nodes = cards.map((card) => {
    const hasChildren = childrenByKey.get(card.key).length > 0
    const kind = card.parentKey ? (card.kind ?? (hasChildren ? 'branch' : 'task')) : 'root'
    const status = card.status ?? (card.progress >= 100 ? 'done' : card.progress > 0 ? 'in-progress' : 'planned')
    const position = positions.get(card.key)
    return {
      id: card.key,
      type: 'mind',
      position: { x: position.x, y: position.y - rootY },
      data: {
        label: card.label,
        description: card.description,
        sharedKnowledge: card.sharedKnowledge,
        progress: card.progress,
        status,
        kind,
        ...(card.taskUrl ? { taskUrl: card.taskUrl } : {}),
        ...(kind === 'task' || card.isWork !== undefined ? { isWork: card.isWork ?? true } : {}),
        ...(card.assigneeId ? { assigneeId: card.assigneeId } : {}),
        ...(card.dueDate ? { dueDate: card.dueDate } : {}),
        ...(card.checklist ? {
          checklist: card.checklist.map((item, index) => ({ id: `check-${card.key}-${index + 1}`, ...item })),
        } : {}),
        ...(card.blockedBy?.length ? { blockedBy: card.blockedBy } : {}),
        ...(card.waitingItems?.length && status !== 'done' ? { waitingItems: normalizeWaitingItems(card.waitingItems) } : {}),
      },
    }
  })
  const edges = cards.filter((card) => card.parentKey).map((card) => ({
    id: `edge-${card.parentKey}-${card.key}`,
    source: card.parentKey,
    target: card.key,
    type: 'default',
    data: { relation: 'hierarchy' },
    markerEnd: { type: 'arrowclosed', width: 16, height: 16 },
  }))
  return { nodes, edges, rootKey: roots[0].key }
}

async function main() {
  const server = new McpServer({ name: 'MindNProgress', version: '1.0.0' }, { instructions: serverInstructions })

  registerTool(server, 'mindnprogress_list_documents', '활성 문서 목록과 버전, 완료 현황 및 좌측 목록의 문서 그룹·혼합 순서를 조회합니다.', {}, async () =>
    apiRequest('/api/maps'))

  registerTool(server, 'mindnprogress_read_me_first', 'MindNProgress를 처음 사용하거나 MindNProgress 밖에서 대화를 시작했다면 가장 먼저 읽어야 하는 제품 가이드입니다. 문서 ID 없이 호출할 수 있으며 마인드맵 작성 규칙과 안전한 도구 사용 순서를 알려줍니다.', {}, async () => ({
    guide: productGuide,
    recommendedWorkflows: {
      exploreWithoutSelection: [
        'mindnprogress_list_documents로 문서 목록 확인',
        'mindnprogress_get_document로 대상 문서의 전체 구조 확인',
        '특정 카드를 정하면 이후 mindnprogress_get_context로 제품 규칙과 선택 카드 관계를 함께 확인',
      ],
      createMindmap: [
        '사용자 자료를 분석하고 루트 1개, 핵심 branch, 실행 task로 계층 구성',
        'mindnprogress_create_mindmap을 한 번 호출해 문서와 전체 구조를 원자적으로 생성',
        '반환된 문서 ID로 mindnprogress_get_document를 호출해 생성 결과 검증',
      ],
      editExistingDocument: [
        'mindnprogress_get_context로 최신 버전과 선택 카드 관계 확인',
        '목적에 맞는 카드 또는 문서 편집 도구 호출',
        'mindnprogress_get_document로 실제 저장 결과 검증',
      ],
    },
    important: [
      '여러 카드의 새 문서는 create_document와 save_document 조합이 아니라 mindnprogress_create_mindmap으로 생성',
      '업무로 추적할 task만 isWork=true로 설정',
      'description은 업무 요청과 완료 조건, sharedKnowledge는 다른 카드가 재사용할 안정적인 결론에 사용',
      '진행 과정과 완료 사실은 짧은 summary와 충실한 detail 댓글로 기록하고 재사용할 결과는 sharedKnowledge에도 요약',
      '외부 전달물이나 결정 대기는 waitingItems에 기록하고 카드 제목에는 대기 문구를 추가하지 않음',
      '카드 일부 필드만 변경할 때는 mindnprogress_update_card에 변경할 필드만 전달하고 현재 카드 전체 데이터를 재전송하지 않음',
      '지식선만 변경할 때는 전체 문서를 다시 보내지 않고 지식선 전용 도구를 사용',
      '조회 도구는 문서 version을 올리지 않지만 편집 도구와 AI 대화 ID 연결은 version을 올릴 수 있음',
      '업무 링크, 담당자와 마감일은 실제 값이 있을 때만 지정',
      '비밀번호 변경과 관리자 계정 관리는 MCP에서 지원하지 않음',
    ],
  }))

  registerTool(server, 'mindnprogress_get_context', 'MindNProgress의 제품 개념과 작성 규칙, 최신 문서 개요, 선택 카드와 업무 링크, 계층·의존성·댓글·담당자 정보를 한 번에 조회합니다. focused는 작업 관련 원문과 문서 개요를, full은 전체 문서 원문을 반환합니다. 대화를 시작한 뒤 다른 MindNProgress 도구보다 먼저 호출하세요. attributionToken이 없고 현재 AI 종류와 모델을 정확히 알고 있다면 aiType과 aiModel을 함께 전달하세요.', {
    mapId: z.string().min(1).describe('현재 문서 ID'),
    cardId: z.string().min(1).describe('편집자가 선택한 카드 ID'),
    editorId: z.string().min(1).max(120).optional().describe('AI 대화를 시작한 MindNProgress 편집자 계정 ID'),
    attributionToken: z.string().min(32).max(200).optional().describe('MindNProgress의 AI 대화 시작 화면에서 전달된 작성자 귀속 토큰'),
    aiType: z.string().min(1).max(120).optional().describe('attributionToken이 없는 외부 MCP 세션에서 현재 AI가 직접 밝히는 AI 종류(예: Codex CLI)'),
    aiModel: z.string().min(1).max(160).optional().describe('attributionToken이 없는 외부 MCP 세션에서 현재 AI가 직접 밝히는 모델(예: GPT-5.6-Sol)'),
    detailLevel: z.enum(['focused', 'full']).default('focused').describe('focused는 선택 카드와 주요 지식 원문 및 문서 개요, full은 현재의 전체 문서 원문을 반환'),
  }, async ({ mapId, cardId, editorId, attributionToken, aiType, aiModel, detailLevel }) => {
    if ((aiType && !aiModel) || (!aiType && aiModel)) {
      throw new Error('AI 종류와 모델은 함께 지정해 주세요.')
    }
    activeMapId = mapId
    activeCardId = cardId
    activeEditorId = editorId ?? ''
    activeAttributionToken = attributionToken ?? ''
    activeAiType = attributionToken ? '' : (aiType ?? '')
    activeAiModel = attributionToken ? '' : (aiModel ?? '')
    const [documentResult, commentsResult, usersResult, health] = await Promise.all([
      apiRequest(`/api/maps/${encodeURIComponent(mapId)}`),
      apiRequest(`/api/maps/${encodeURIComponent(mapId)}/comments?includeDetail=false`),
      apiRequest('/api/assignees'),
      apiRequest('/api/health'),
    ])
    const map = documentResult.map
    const selectedCard = map.nodes.find((node) => node.id === cardId)
    if (!selectedCard) throw new Error(`선택 카드를 찾을 수 없습니다: ${cardId}`)

    const hierarchyEdges = map.edges.filter(isHierarchyEdge)
    const knowledgeEdges = map.edges.filter(isKnowledgeEdge)
    const parentIds = hierarchyEdges.filter((edge) => edge.target === cardId).map((edge) => edge.source)
    const childIds = hierarchyEdges.filter((edge) => edge.source === cardId).map((edge) => edge.target)
    const siblingIds = [...new Set(parentIds.flatMap((parentId) => hierarchyEdges
      .filter((edge) => edge.source === parentId && edge.target !== cardId)
      .map((edge) => edge.target)))]
    const ancestorIds = new Set()
    const ancestorStack = [...parentIds]
    while (ancestorStack.length > 0) {
      const currentId = ancestorStack.pop()
      if (!currentId || ancestorIds.has(currentId)) continue
      ancestorIds.add(currentId)
      hierarchyEdges.filter((edge) => edge.target === currentId).forEach((edge) => ancestorStack.push(edge.source))
    }
    const descendantIds = descendantsOf(cardId, hierarchyEdges)
    const blockedByIds = selectedCard.data?.blockedBy ?? []
    const blockingIds = map.nodes.filter((node) => (node.data?.blockedBy ?? []).includes(cardId)).map((node) => node.id)
    const selectedHierarchyIds = new Set([cardId, ...ancestorIds])
    const topLevelCard = map.nodes.find((node) => selectedHierarchyIds.has(node.id)
      && node.data?.kind === 'root'
      && !hierarchyEdges.some((edge) => edge.target === node.id))
      ?? map.nodes.find((node) => selectedHierarchyIds.has(node.id)
        && !hierarchyEdges.some((edge) => edge.target === node.id))
      ?? selectedCard
    const taskLinkFor = (card) => {
      const url = typeof card?.data?.taskUrl === 'string' ? card.data.taskUrl.trim() : ''
      return url ? { cardId: card.id, label: card.data?.label ?? card.id, url } : null
    }
    const selectedTaskLink = taskLinkFor(selectedCard)
    const topLevelTaskLink = taskLinkFor(topLevelCard)
    const availableTaskLinks = [
      ...(selectedTaskLink ? [{ scope: selectedCard.id === topLevelCard.id ? 'selected-and-top-level' : 'selected-card', ...selectedTaskLink }] : []),
      ...(topLevelTaskLink && topLevelCard.id !== selectedCard.id ? [{ scope: 'top-level-card', ...topLevelTaskLink }] : []),
    ]
    const startupInspectionTargets = availableTaskLinks.filter((link, index, links) =>
      links.findIndex((candidate) => candidate.url === link.url) === index)
    const allComments = commentsResult.comments ?? []
    const incomingKnowledge = knowledgeEdges
      .filter((edge) => edge.target === cardId)
      .map((edge) => {
        const sourceCard = map.nodes.find((node) => node.id === edge.source)
        if (!sourceCard) return null
        return {
          policy: knowledgePolicyOf(edge),
          card: sourceCard,
          accessUrl: cardAccessUrl(health.publicBaseUrl, map.id, sourceCard.id),
          comments: allComments.filter((comment) => comment.nodeId === sourceCard.id),
          taskLink: taskLinkFor(sourceCard),
        }
      })
      .filter(Boolean)
    const primaryKnowledge = incomingKnowledge.filter((source) => source.policy === 'reuse-first')
    const fallbackKnowledge = incomingKnowledge.filter((source) => source.policy === 'inspect-if-insufficient')
    const hasKnowledgeGuidance = incomingKnowledge.length > 0
    const conversationInspectionSources = primaryKnowledge
      .filter((source) => typeof source.card.data?.aiConversationId === 'string' && source.card.data.aiConversationId.trim())
      .map((source) => ({
        cardId: source.card.id,
        label: source.card.data?.label ?? source.card.id,
        conversationAvailable: true,
        toolArguments: { mapId, cardId: source.card.id },
      }))
    const conversationInspection = {
      mode: conversationInspectionSources.length > 0 ? 'on-demand' : 'unavailable',
      required: false,
      tool: 'mindnprogress_get_ai_conversation_transcript',
      sources: conversationInspectionSources,
      triggers: [
        '공유 지식, 설명과 댓글만으로 현재 작업에 필요한 결정 근거가 부족함',
        '예외 조건 또는 이전 실패 원인을 확인해야 함',
        '공유 지식과 댓글이 서로 충돌하여 원래 대화 맥락이 필요함',
        '사용자가 과거 AI 대화를 직접 확인하도록 요청함',
      ],
      instruction: conversationInspectionSources.length > 0
        ? 'primarySources의 sharedKnowledge, 설명과 댓글을 먼저 사용하세요. 그래도 현재 작업에 필요한 결정 근거, 예외 조건 또는 이전 실패 원인이 구체적으로 부족할 때만 sources 중 필요한 카드의 toolArguments로 대화 기록을 조회하세요.'
        : '대화가 연결된 주요 선행 지식 카드가 없습니다. 공유 지식, 설명과 댓글을 사용하고 대화 기록 도구를 호출하지 마세요.',
      evidenceRule: '대화 내용은 보조 근거로 취급합니다. 실제 코드와 산출물로 검증하고, 대화 전문을 댓글이나 sharedKnowledge에 복사하지 말며, 검증된 재사용 가능 결론만 sharedKnowledge에 요약하세요.',
    }
    const knowledgePrimaryTargets = selectedTaskLink ? [{
      scope: selectedCard.id === topLevelCard.id ? 'selected-and-top-level' : 'selected-card',
      reason: '현재 카드에 직접 연결된 업무 요구사항 확인',
      ...selectedTaskLink,
    }] : []
    const knowledgeFallbackTargets = [
      ...incomingKnowledge.flatMap((source) => source.taskLink ? [{
        scope: source.policy === 'reuse-first' ? 'primary-knowledge-source' : 'fallback-knowledge-source',
        reason: source.policy === 'reuse-first' ? '카드 결과와 댓글만으로 부족할 때 원본 확인' : '주요 지식만으로 부족할 때 확인',
        ...source.taskLink,
      }] : []),
      ...(topLevelTaskLink && topLevelCard.id !== selectedCard.id ? [{
        scope: 'top-level-card',
        reason: '선행 지식과 현재 카드 업무만으로 전체 배경이 부족할 때 확인',
        ...topLevelTaskLink,
      }] : []),
    ].filter((link, index, links) =>
      !knowledgePrimaryTargets.some((candidate) => candidate.url === link.url)
      && links.findIndex((candidate) => candidate.url === link.url) === index)
    const startupInspection = hasKnowledgeGuidance ? {
      mode: 'knowledge-guided',
      required: knowledgePrimaryTargets.length > 0,
      targets: knowledgePrimaryTargets,
      primarySources: primaryKnowledge.map((source) => ({ cardId: source.card.id, label: source.card.data?.label ?? source.card.id })),
      fallbackSources: fallbackKnowledge.map((source) => ({ cardId: source.card.id, label: source.card.data?.label ?? source.card.id })),
      fallbackTargets: knowledgeFallbackTargets,
      conversationInspection,
      checks: ['현재 카드에 직접 연결된 업무 요구사항', '선행 지식 카드의 공유 지식과 설명', '선행 지식 카드의 댓글'],
      instruction: 'primarySources의 sharedKnowledge를 먼저 재사용하고 카드 설명과 댓글로 보완하세요. targets는 현재 카드에 직접 연결된 업무가 있을 때만 조사합니다. 최상위 업무와 선행 지식 원본을 처음부터 다시 조사하지 마세요.',
      fallback: '현재 작업에 필요한 정보가 구체적으로 부족할 때만 fallbackSources와 fallbackTargets에서 필요한 범위를 선택적으로 확인하세요. 외부 업무 도구가 없거나 조회에 실패하면 확인된 카드와 댓글로 가능한 작업은 계속 진행하세요.',
    } : {
      mode: 'default',
      required: startupInspectionTargets.length > 0,
      targets: startupInspectionTargets,
      fallbackTargets: [],
      conversationInspection: {
        mode: 'not-applicable',
        required: false,
        tool: 'mindnprogress_get_ai_conversation_transcript',
        sources: [],
        instruction: '선행 지식선이 없어 대화 기록을 주요 지식으로 조회하지 않습니다.',
      },
      checks: ['업무 제목과 본문', '댓글과 대화 내용', '첨부파일 목록', '본문과 댓글에 포함된 관련 링크'],
      instruction: '선택 카드의 작업을 수행하기 전에 targets의 업무를 조사하여 배경, 목적, 요구사항, 제약과 관련 자료를 파악하세요. 기획서나 첨부파일이 있다고 가정하지 말고 본문에 간략한 요구사항만 있을 가능성도 고려하세요.',
      fallback: 'targets가 없으면 MindNProgress 카드 정보로 진행합니다. 외부 업무 시스템 도구가 없거나 조회에 실패하면 임의로 추측하지 말고 조회하지 못한 대상과 원인을 알린 뒤, 확인된 카드 정보만으로 가능한 작업은 계속 진행하세요.',
    }

    const selectedComments = allComments.filter((comment) => comment.nodeId === cardId)
    const focusedSelectedComments = focusedCommentWindow(selectedComments, mapId, cardId)
    const focusedPrimaryKnowledge = primaryKnowledge.map((source) => ({
      policy: source.policy,
      card: contentCard(source.card),
      accessUrl: source.accessUrl,
      ...focusedCommentWindow(source.comments, mapId, source.card.id),
      taskLink: source.taskLink,
      detailTool: 'mindnprogress_get_card',
      detailToolArguments: { mapId, cardId: source.card.id, includeCommentDetail: true },
    }))
    const focusedFallbackKnowledge = fallbackKnowledge.map((source) => ({
      policy: source.policy,
      card: compactCard(source.card),
      accessUrl: source.accessUrl,
      comments: [],
      commentsPage: {
        total: source.comments.length,
        included: 0,
        order: 'asc',
        hasMore: source.comments.length > 0,
        tool: 'mindnprogress_list_comments',
        nextToolArguments: source.comments.length > 0
          ? { mapId, nodeId: source.card.id, offset: 0, limit: 50, order: 'desc', includeDetail: true }
          : null,
      },
      taskLink: source.taskLink,
      detailTool: 'mindnprogress_get_card',
      detailToolArguments: { mapId, cardId: source.card.id, includeCommentDetail: true },
    }))
    const taskLinks = {
      selectedCard: selectedTaskLink,
      topLevelCard: topLevelTaskLink,
      available: availableTaskLinks,
      startupInspection,
      rule: hasKnowledgeGuidance
        ? '지식선이 있으므로 현재 카드의 직접 업무와 선행 지식을 우선합니다. 최상위 업무와 지식 원본 링크는 부족할 때만 선택적으로 조사하며 링크를 다른 카드 데이터에 상속하거나 복사하지 않습니다.'
        : '선택 카드와 최상위 카드의 업무 링크를 독립적으로 유지합니다. 작업 시작 전에 startupInspection을 따르며, 두 링크가 모두 있으면 중복 URL을 제외하고 모두 조사합니다. 링크를 다른 카드 데이터에 상속하거나 복사하지 않습니다.',
    }
    const knowledgeRule = hasKnowledgeGuidance
      ? 'primary의 sharedKnowledge를 먼저 사용하고 설명과 댓글로 보완합니다. fallback 및 각 source의 taskLink는 현재 작업에 필요한 정보가 부족할 때만 확인합니다.'
      : '들어오는 지식선이 없어 기본 업무 조사 절차를 사용합니다.'
    const full = detailLevel === 'full'

    return {
      contextSchemaVersion,
      detailLevel,
      guide: productGuide,
      document: full ? {
        id: map.id,
        title: map.title,
        color: map.color,
        version: map.version,
        updatedAt: map.updatedAt,
        updatedBy: map.updatedBy,
        nodes: map.nodes,
        edges: map.edges,
        accessUrl: documentAccessUrl(health.publicBaseUrl, map.id),
      } : focusedDocument(map, health.publicBaseUrl),
      selection: {
        card: full ? selectedCard : contentCard(selectedCard),
        accessUrl: cardAccessUrl(health.publicBaseUrl, map.id, selectedCard.id),
        parents: full ? relatedCards(parentIds, map.nodes) : compactRelatedCards(parentIds, map.nodes),
        children: full ? relatedCards(childIds, map.nodes) : compactRelatedCards(childIds, map.nodes),
        siblings: full ? relatedCards(siblingIds, map.nodes) : compactRelatedCards(siblingIds, map.nodes),
        ancestors: full ? relatedCards(ancestorIds, map.nodes) : compactRelatedCards(ancestorIds, map.nodes),
        descendants: full ? relatedCards(descendantIds, map.nodes) : compactRelatedCards(descendantIds, map.nodes),
        blockedBy: full ? relatedCards(blockedByIds, map.nodes) : compactRelatedCards(blockedByIds, map.nodes),
        blocks: full ? relatedCards(blockingIds, map.nodes) : compactRelatedCards(blockingIds, map.nodes),
        knowledgeSources: full ? {
          primary: primaryKnowledge,
          fallback: fallbackKnowledge,
          all: incomingKnowledge,
          rule: knowledgeRule,
        } : {
          primary: focusedPrimaryKnowledge,
          fallback: focusedFallbackKnowledge,
          rule: knowledgeRule,
        },
        taskLinks,
        comments: full ? selectedComments : focusedSelectedComments.comments,
        ...(full ? {} : { commentsPage: focusedSelectedComments.commentsPage }),
      },
      teamMembers: full ? (usersResult.users ?? []) : (usersResult.users ?? []).map(compactTeamMember),
      nextStep: '사용자 요청을 수행한 뒤 의미 있는 진행과 결과는 1~2문장의 summary와 작업을 이어가거나 검증하는 데 필요한 사실을 담은 detail 댓글로 기록하고, 재사용할 결론은 sharedKnowledge에 요약한 다음 mindnprogress_get_document로 결과를 다시 확인하세요. 외부 전달물이나 결정 때문에 멈추면 제목을 바꾸지 말고 waitingItems와 [차단] 댓글을 추가하며, 재개할 때 해당 항목을 제거하고 [진행] 댓글을 남기세요.',
    }
  }, { compactResult: true })

  registerTool(server, 'mindnprogress_get_document', '문서의 모든 카드와 연결 관계 및 외부에서 접근 가능한 URL을 조회합니다.', mapIdSchema, async ({ mapId }) => {
    const [documentResult, health] = await Promise.all([
      apiRequest(`/api/maps/${encodeURIComponent(mapId)}`),
      apiRequest('/api/health'),
    ])
    return {
      ...documentResult,
      access: {
        publicBaseUrl: health.publicBaseUrl,
        documentUrl: documentAccessUrl(health.publicBaseUrl, documentResult.map.id),
        cards: documentResult.map.nodes.map((node) => ({
          cardId: node.id,
          label: node.data?.label ?? node.id,
          accessUrl: cardAccessUrl(health.publicBaseUrl, documentResult.map.id, node.id),
        })),
        rule: '링크를 기록할 때 localhost나 127.0.0.1로 재작성하지 말고 accessUrl을 그대로 사용하세요.',
      },
    }
  }, { compactResult: true })

  registerTool(server, 'mindnprogress_get_card', '한 카드의 설명, 공유 지식, 업무 필드와 댓글을 선택적으로 조회합니다. get_context의 fallback 카드 또는 간략 개요에서 원문이 필요할 때 사용하세요.', {
    mapId: z.string().min(1),
    cardId: z.string().min(1),
    commentOffset: z.number().int().nonnegative().default(0),
    commentLimit: z.number().int().min(1).max(100).default(20),
    commentOrder: z.enum(['asc', 'desc']).default('desc'),
    includeCommentDetail: z.boolean().default(false).describe('true이면 댓글 상세 본문을 함께 반환. 요약만으로 작업 판단이 어려울 때 사용'),
  }, async ({ mapId, cardId, commentOffset, commentLimit, commentOrder, includeCommentDetail }) => {
    const [documentResult, commentsResult, health] = await Promise.all([
      apiRequest(`/api/maps/${encodeURIComponent(mapId)}`),
      apiRequest(`/api/maps/${encodeURIComponent(mapId)}/comments?nodeId=${encodeURIComponent(cardId)}&includeDetail=${includeCommentDetail}`),
      apiRequest('/api/health'),
    ])
    const card = documentResult.map.nodes.find((node) => node.id === cardId)
    if (!card) throw new Error(`카드를 찾을 수 없습니다: ${cardId}`)
    const commentPage = paginateComments(commentsResult.comments ?? [], {
      offset: commentOffset,
      limit: commentLimit,
      order: commentOrder,
    })
    return {
      document: {
        id: documentResult.map.id,
        title: documentResult.map.title,
        version: documentResult.map.version,
        updatedAt: documentResult.map.updatedAt,
        updatedBy: documentResult.map.updatedBy,
      },
      card: contentCard(card),
      accessUrl: cardAccessUrl(health.publicBaseUrl, documentResult.map.id, card.id),
      comments: commentPage.items,
      commentsPage: commentPage.page,
    }
  })

  registerTool(server, 'mindnprogress_create_mindmap', '새 문서와 완성된 계층형 마인드맵을 한 번에 원자적으로 생성합니다. 여러 카드를 만들 때는 create_document 후 save_document를 호출하지 말고 반드시 이 도구를 우선 사용하세요. 카드 위치와 연결선은 자동 배치됩니다.', {
    title: z.string().min(1).max(120),
    color: documentColor.default('violet'),
    cards: z.array(outlineCardSchema).min(1).max(300).describe('루트부터 하위 카드까지 포함한 전체 카드 목록'),
  }, async ({ title, color, cards }) => {
    const { nodes, edges, rootKey } = buildMapFromOutline(cards)
    const created = await apiRequest('/api/maps', {
      method: 'POST',
      body: JSON.stringify({ title, color, map: { nodes, edges } }),
    })
    return {
      created: true,
      document: created.summary,
      rootCardId: rootKey,
      cardCount: nodes.length,
      message: '문서와 전체 마인드맵을 한 번의 저장으로 생성했습니다. 추가 save_document 호출은 필요하지 않습니다.',
    }
  })

  registerTool(server, 'mindnprogress_create_document', '루트 카드 하나만 있는 새 문서를 생성합니다. 처음부터 여러 카드로 구성할 때는 버전 충돌 방지를 위해 mindnprogress_create_mindmap을 사용하세요.', {
    title: z.string().min(1),
    color: documentColor.default('violet'),
    rootLabel: z.string().min(1),
    rootDescription: z.string().default(''),
    rootSharedKnowledge: z.string().max(10_000).default(''),
  }, async ({ title, color, rootLabel, rootDescription, rootSharedKnowledge }) => {
    const rootId = `node-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`
    return apiRequest('/api/maps', {
      method: 'POST',
      body: JSON.stringify({
        title,
        color,
        map: {
          nodes: [{
            id: rootId,
            type: 'mind',
            position: { x: 0, y: 0 },
            data: { label: rootLabel, description: rootDescription, sharedKnowledge: rootSharedKnowledge, progress: 0, status: 'planned', kind: 'root' },
          }],
          edges: [],
        },
      }),
    })
  })

  registerTool(server, 'mindnprogress_save_document', '문서의 전체 카드와 연결 관계를 저장합니다. 카드 추가, 복사, 이동, 삭제와 모든 카드 속성 변경을 지원합니다.', {
    mapId: z.string().min(1),
    baseVersion: z.number().int().positive(),
    nodes: z.array(z.record(z.unknown())),
    edges: z.array(z.record(z.unknown())),
    force: z.boolean().default(false),
  }, async ({ mapId, baseVersion, nodes, edges, force }) => apiRequest(`/api/maps/${encodeURIComponent(mapId)}`, {
    method: 'PUT',
    body: JSON.stringify({ map: { nodes, edges }, baseVersion, force }),
  }))

  registerTool(server, 'mindnprogress_add_card', '문서에 새 카드 또는 하위 카드를 추가합니다. 외부 전달물이나 결정 대기는 제목이 아니라 waitingItems로 기록합니다.', {
    mapId: z.string().min(1),
    parentId: z.string().optional(),
    data: nodeDataSchema,
    position: z.object({ x: z.number(), y: z.number() }).optional(),
  }, async ({ mapId, parentId, data, position }) => {
    const map = await getDocument(mapId)
    const parent = parentId ? map.nodes.find((node) => node.id === parentId) : null
    if (parentId && !parent) throw new Error('상위 카드를 찾을 수 없습니다.')
    const siblingIds = new Set(parentId
      ? map.edges.filter((edge) => isHierarchyEdge(edge) && edge.source === parentId).map((edge) => edge.target)
      : [])
    const siblingPositions = map.nodes.filter((node) => siblingIds.has(node.id)).map((node) => node.position)
    const nodeId = `node-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`
    const node = {
      id: nodeId,
      type: 'mind',
      position: position ?? (parent
        ? defaultChildMindMapPosition(parent.position, siblingPositions)
        : snapMindMapPosition({ x: 0, y: map.nodes.length * mindMapWorkNodeVerticalStep })),
      data: {
        ...data,
        waitingItems: data.status === 'done' || data.progress >= 100 ? [] : normalizeWaitingItems(data.waitingItems),
      },
    }
    map.nodes.push(node)
    if (parentId) map.edges.push({
      id: `edge-${parentId}-${nodeId}`,
      source: parentId,
      target: nodeId,
      type: 'default',
      data: { relation: 'hierarchy' },
      markerEnd: { type: 'arrowclosed', width: 16, height: 16 },
    })
    return saveDocument(map, false, parentId ?? '')
  })

  registerTool(server, 'mindnprogress_update_card', '카드의 일부 필드만 부분 병합 방식으로 변경합니다. data에 포함한 필드만 변경되고 일반 카드에서 생략한 필드와 position은 보존되므로 현재 카드 전체 데이터를 재전송하지 마세요. 빈 문자열과 빈 배열은 해당 필드를 명시적으로 초기화합니다. 단, status=done 또는 progress>=100이면 waitingItems가 자동으로 비워지며 Ref 카드는 원본 관리 필드가 최신 원본 값으로 동기화될 수 있습니다. description은 업무 요청과 배경, sharedKnowledge는 다른 카드가 재사용할 안정적인 결론에 사용하고 외부 대기는 waitingItems로 기록하세요.', {
    mapId: z.string().min(1),
    nodeId: z.string().min(1),
    data: nodeDataSchema.partial().describe('변경할 카드 필드만 포함하는 부분 병합 데이터. 일반 카드에서 생략한 필드는 보존되므로 현재 카드 전체 데이터를 재전송하지 않습니다. 빈 문자열과 빈 배열은 명시적 초기화이며, 완료 상태 또는 진행률 100 적용 시 waitingItems는 자동으로 비워지고 Ref 카드는 원본 관리 필드가 최신 원본 값으로 동기화될 수 있습니다.'),
    position: z.object({ x: z.number(), y: z.number() }).optional(),
  }, async ({ mapId, nodeId, data, position }) => {
    const map = await getDocument(mapId)
    const node = map.nodes.find((item) => item.id === nodeId)
    if (!node) throw new Error('카드를 찾을 수 없습니다.')
    const nextData = {
      ...node.data,
      ...data,
      ...(data.waitingItems === undefined ? {} : { waitingItems: normalizeWaitingItems(data.waitingItems) }),
    }
    node.data = nextData.status === 'done' || nextData.progress >= 100
      ? { ...nextData, waitingItems: [] }
      : nextData
    if (position) node.position = position
    return saveDocument(map, false, nodeId)
  })

  registerTool(server, 'mindnprogress_move_card', '카드와 모든 하위 카드를 유지한 채 다른 카드의 하위로 이동합니다.', {
    mapId: z.string().min(1),
    nodeId: z.string().min(1),
    newParentId: z.string().min(1),
  }, async ({ mapId, nodeId, newParentId }) => {
    const map = await getDocument(mapId)
    if (!map.nodes.some((node) => node.id === nodeId) || !map.nodes.some((node) => node.id === newParentId)) {
      throw new Error('이동할 카드 또는 새 상위 카드를 찾을 수 없습니다.')
    }
    if (nodeId === newParentId || descendantsOf(nodeId, map.edges).has(newParentId)) {
      throw new Error('자기 자신이나 하위 카드 아래로 이동할 수 없습니다.')
    }
    map.edges = map.edges.filter((edge) => isKnowledgeEdge(edge) || edge.target !== nodeId)
    map.edges.push({
      id: `edge-${newParentId}-${nodeId}`,
      source: newParentId,
      target: nodeId,
      type: 'default',
      data: { relation: 'hierarchy' },
      markerEnd: { type: 'arrowclosed', width: 16, height: 16 },
    })
    return saveDocument(map, false, nodeId)
  })

  registerTool(server, 'mindnprogress_delete_card', '카드를 삭제합니다. 기본적으로 모든 하위 카드도 함께 삭제합니다.', {
    mapId: z.string().min(1),
    nodeId: z.string().min(1),
    includeDescendants: z.boolean().default(true),
  }, async ({ mapId, nodeId, includeDescendants }) => {
    const map = await getDocument(mapId)
    const target = map.nodes.find((node) => node.id === nodeId)
    if (!target) throw new Error('카드를 찾을 수 없습니다.')
    if (target.data?.kind === 'root') throw new Error('루트 카드는 삭제할 수 없습니다.')
    const deletedIds = includeDescendants ? descendantsOf(nodeId, map.edges) : new Set()
    deletedIds.add(nodeId)
    map.nodes = map.nodes.filter((node) => !deletedIds.has(node.id))
    map.edges = map.edges.filter((edge) => !deletedIds.has(edge.source) && !deletedIds.has(edge.target))
    return saveDocument(map, false, nodeId)
  })

  registerTool(server, 'mindnprogress_add_knowledge_line', 'source 카드의 결과를 target 카드가 선행 지식으로 사용하도록 지식선을 추가합니다. 전체 문서를 전달하지 않고 최신 버전에 관계만 안전하게 반영하며 순환과 중복 연결을 거부합니다.', {
    mapId: z.string().min(1),
    sourceCardId: z.string().min(1).describe('선행 지식을 제공하는 카드 ID'),
    targetCardId: z.string().min(1).describe('선행 지식을 사용하는 카드 ID'),
    knowledgePolicy: knowledgePolicySchema.default('reuse-first'),
  }, async ({ mapId, sourceCardId, targetCardId, knowledgePolicy }) => {
    const edgeId = `knowledge-${sourceCardId}-${targetCardId}-${Date.now()}-${randomBytes(3).toString('hex')}`
    const { saved, result } = await mutateDocument(mapId, targetCardId, (map) => {
      if (!map.nodes.some((node) => node.id === sourceCardId)) throw new Error('선행 지식을 제공하는 카드를 찾을 수 없습니다.')
      if (!map.nodes.some((node) => node.id === targetCardId)) throw new Error('선행 지식을 사용하는 카드를 찾을 수 없습니다.')
      if (sourceCardId === targetCardId) throw new Error('카드는 자기 자신을 선행 지식으로 연결할 수 없습니다.')
      if (map.edges.some((edge) => isKnowledgeEdge(edge) && edge.source === sourceCardId && edge.target === targetCardId)) {
        throw new Error('이미 연결된 지식선입니다.')
      }
      if (createsKnowledgeCycle(sourceCardId, targetCardId, map.edges)) throw new Error('순환 지식선은 추가할 수 없습니다.')
      const knowledgeLine = {
        id: edgeId,
        source: sourceCardId,
        target: targetCardId,
        type: 'default',
        reconnectable: false,
        data: { relation: 'knowledge', knowledgePolicy },
        markerEnd: { type: 'arrowclosed', width: 18, height: 18 },
      }
      map.edges.push(knowledgeLine)
      return knowledgeLine
    })
    return {
      mapId,
      version: saved.map.version,
      knowledgeLine: {
        id: result.id,
        sourceCardId: result.source,
        targetCardId: result.target,
        knowledgePolicy: knowledgePolicyOf(result),
      },
    }
  })

  registerTool(server, 'mindnprogress_update_knowledge_line', 'source와 target 카드로 지식선을 찾아 주요 지식 우선 또는 정보 부족 시 확인 정책만 변경합니다. 최신 버전에 관계만 다시 적용하므로 전체 문서 저장이 필요하지 않습니다.', {
    mapId: z.string().min(1),
    sourceCardId: z.string().min(1),
    targetCardId: z.string().min(1),
    knowledgePolicy: knowledgePolicySchema,
  }, async ({ mapId, sourceCardId, targetCardId, knowledgePolicy }) => {
    const { saved, result } = await mutateDocument(mapId, targetCardId, (map) => {
      const matches = map.edges.filter((edge) => isKnowledgeEdge(edge) && edge.source === sourceCardId && edge.target === targetCardId)
      if (matches.length === 0) throw new Error('변경할 지식선을 찾을 수 없습니다.')
      if (matches.length > 1) throw new Error('같은 카드 사이에 중복 지식선이 있어 안전하게 변경할 수 없습니다.')
      matches[0].data = { ...matches[0].data, relation: 'knowledge', knowledgePolicy }
      return matches[0]
    })
    return {
      mapId,
      version: saved.map.version,
      knowledgeLine: {
        id: result.id,
        sourceCardId: result.source,
        targetCardId: result.target,
        knowledgePolicy: knowledgePolicyOf(result),
      },
    }
  })

  registerTool(server, 'mindnprogress_delete_knowledge_line', 'source와 target 카드 사이의 지식선을 삭제합니다. 카드와 계층선은 변경하지 않으며 최신 버전에 관계 삭제만 다시 적용합니다.', {
    mapId: z.string().min(1),
    sourceCardId: z.string().min(1),
    targetCardId: z.string().min(1),
  }, async ({ mapId, sourceCardId, targetCardId }) => {
    const { saved, result } = await mutateDocument(mapId, targetCardId, (map) => {
      const matches = map.edges.filter((edge) => isKnowledgeEdge(edge) && edge.source === sourceCardId && edge.target === targetCardId)
      if (matches.length === 0) throw new Error('삭제할 지식선을 찾을 수 없습니다.')
      const deletedIds = new Set(matches.map((edge) => edge.id))
      map.edges = map.edges.filter((edge) => !deletedIds.has(edge.id))
      return matches.map((edge) => edge.id)
    })
    return {
      mapId,
      version: saved.map.version,
      deletedKnowledgeLineIds: result,
      sourceCardId,
      targetCardId,
    }
  })

  registerTool(server, 'mindnprogress_update_document_info', '문서 이름 또는 아이콘 색상을 변경합니다.', {
    mapId: z.string().min(1),
    baseVersion: z.number().int().positive(),
    title: z.string().min(1).optional(),
    color: documentColor.optional(),
    force: z.boolean().default(false),
  }, async ({ mapId, ...body }) => apiRequest(`/api/maps/${encodeURIComponent(mapId)}`, {
    method: 'PATCH', body: JSON.stringify(body),
  }))

  registerTool(server, 'mindnprogress_reorder_documents', '좌측 보드의 문서 순서를 변경합니다.', {
    mapIds: z.array(z.string()).min(1),
  }, async ({ mapIds }) => apiRequest('/api/maps/order', { method: 'PATCH', body: JSON.stringify({ mapIds }) }))

  registerTool(server, 'mindnprogress_save_document_layout', '좌측 목록의 그룹, 그룹 안 문서 순서, 그룹과 개별 문서가 섞인 최상위 순서를 저장합니다. 먼저 mindnprogress_list_documents로 현재 documentLayout과 전체 문서 ID를 확인하고, 모든 활성 문서를 정확히 한 번 포함하세요.', {
    documentLayout: documentLayoutSchema,
  }, async ({ documentLayout }) => apiRequest('/api/maps/layout', {
    method: 'PATCH',
    body: JSON.stringify({ documentLayout }),
  }))

  registerTool(server, 'mindnprogress_move_document_to_trash', '문서를 휴지통으로 이동합니다.', mapIdSchema, async ({ mapId }) =>
    apiRequest(`/api/maps/${encodeURIComponent(mapId)}`, { method: 'DELETE' }))
  registerTool(server, 'mindnprogress_list_trash', '휴지통 문서 목록을 조회합니다.', {}, async () =>
    apiRequest('/api/maps/trash'))
  registerTool(server, 'mindnprogress_restore_document', '휴지통 문서를 복원합니다.', mapIdSchema, async ({ mapId }) =>
    apiRequest(`/api/maps/${encodeURIComponent(mapId)}/restore`, { method: 'POST' }))
  registerTool(server, 'mindnprogress_delete_trashed_documents', '휴지통에서 선택한 문서를 영구 삭제합니다. 문서, 댓글, 변경 이력이 함께 삭제되며 복구할 수 없습니다.', {
    mapIds: z.array(z.string().min(1)).min(1),
    confirmPermanentDeletion: z.literal(true),
  }, async ({ mapIds }) => apiRequest('/api/maps/trash', { method: 'DELETE', body: JSON.stringify({ mapIds }) }))
  registerTool(server, 'mindnprogress_empty_trash', '휴지통의 모든 문서를 영구 삭제합니다. 문서, 댓글, 변경 이력이 함께 삭제되며 복구할 수 없습니다.', {
    confirmPermanentDeletion: z.literal(true),
  }, async () => apiRequest('/api/maps/trash', { method: 'DELETE', body: JSON.stringify({ all: true }) }))

  registerTool(server, 'mindnprogress_list_history', '문서 변경 이력을 최신순으로 조회합니다. 다음 이력이 있으면 nextOffset을 offset으로 전달해 이어서 조회하세요.', {
    mapId: z.string().min(1),
    offset: z.number().int().nonnegative().default(0),
    limit: z.number().int().min(1).max(100).default(50),
  }, async ({ mapId, offset, limit }) =>
    apiRequest(`/api/maps/${encodeURIComponent(mapId)}/history?offset=${offset}&limit=${limit}`))
  registerTool(server, 'mindnprogress_restore_history', '선택한 변경 이력으로 문서를 복원합니다.', {
    mapId: z.string().min(1), revisionId: z.string().min(1),
  }, async ({ mapId, revisionId }) => apiRequest(`/api/maps/${encodeURIComponent(mapId)}/history/${encodeURIComponent(revisionId)}/restore`, { method: 'POST' }))

  registerTool(server, 'mindnprogress_list_users', '담당자로 지정할 수 있는 편집자 계정 목록을 조회합니다. active=false인 계정은 기존 담당자 표시용이며 새 담당자로 지정하지 마세요.', {}, async () =>
    apiRequest('/api/assignees'))
  registerTool(server, 'mindnprogress_list_comments', '문서 또는 특정 카드의 댓글과 답글을 페이지 단위로 조회합니다. 기본 응답은 요약과 상세 존재 여부만 포함하며, 작업 근거나 검증 내용이 더 필요할 때 includeDetail=true를 사용하세요. 다음 댓글이 있으면 nextOffset을 offset으로 전달하세요.', {
    mapId: z.string().min(1),
    nodeId: z.string().optional(),
    offset: z.number().int().nonnegative().default(0),
    limit: z.number().int().min(1).max(100).default(50),
    order: z.enum(['asc', 'desc']).default('desc'),
    includeDetail: z.boolean().default(false),
  }, async ({ mapId, nodeId, offset, limit, order, includeDetail }) => {
    const query = new URLSearchParams({
      offset: String(offset),
      limit: String(limit),
      order,
      includeDetail: String(includeDetail),
    })
    if (nodeId) query.set('nodeId', nodeId)
    return apiRequest(`/api/maps/${encodeURIComponent(mapId)}/comments?${query}`)
  })
  registerTool(server, 'mindnprogress_add_comment', '카드에 댓글 또는 답글을 요약과 상세로 작성합니다. summary는 [진행], [차단], [결과]로 시작하는 1~2문장으로 작성하고, detail에는 작업을 이어가거나 검증하는 데 필요한 수행 내용·판단·변경 범위·검증 결과·산출물·다음 단계 중 해당 내용을 충실히 기록하세요. 요약 때문에 상세를 축약하지 마세요.', {
    mapId: z.string().min(1),
    nodeId: z.string().min(1),
    summary: z.string().min(1).max(240).optional().describe('새 형식 댓글의 짧은 요약'),
    detail: z.string().max(6000).optional().describe('작업을 이어가거나 검증하는 데 필요한 상세 내용'),
    text: z.string().min(1).max(1000).optional().describe('이전 도구 호출과의 호환용 필드. 새 댓글은 summary와 detail을 사용'),
    parentId: z.string().optional(),
  }, async ({ mapId, nodeId, summary, detail, text, parentId }) => {
    if (!summary?.trim() && !text?.trim()) throw new Error('댓글 summary를 입력해 주세요.')
    const body = summary !== undefined
      ? { nodeId, summary, detail, parentId }
      : { nodeId, text, parentId }
    return apiRequest(`/api/maps/${encodeURIComponent(mapId)}/comments`, {
      method: 'POST', aiCardId: nodeId, body: JSON.stringify(body),
    })
  })
  registerTool(server, 'mindnprogress_update_comment', '기존 댓글 또는 답글의 요약과 상세를 제자리에서 수정합니다. summary를 보내면 기존 단일 본문 댓글도 summary-detail 형식으로 전환되므로, 향후 마이그레이션에서는 원문을 확인한 뒤 summary와 detail을 함께 보내세요. 댓글 ID, 작성자, 생성 시각, 답글 관계, 반응과 해결 상태는 유지됩니다.', {
    mapId: z.string().min(1),
    commentId: z.string().min(1),
    summary: z.string().min(1).max(240).optional(),
    detail: z.string().max(6000).optional().describe('빈 문자열이면 기존 상세 삭제'),
    text: z.string().min(1).max(1000).optional().describe('이전 호출과의 호환용. 새 형식 댓글의 요약 변경에는 summary 사용'),
    expectedText: z.string().max(1000).optional().describe('조건부 수정에 사용할 현재 댓글 원문. 서버 값과 다르면 다른 편집자의 변경을 덮어쓰지 않고 실패'),
  }, async ({ mapId, commentId, summary, detail, text, expectedText }) => {
    if (summary === undefined && detail === undefined && text === undefined) throw new Error('수정할 댓글 내용을 입력해 주세요.')
    return apiRequest(`/api/maps/${encodeURIComponent(mapId)}/comments/${encodeURIComponent(commentId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ summary, detail, text, expectedText }),
    })
  })
  registerTool(server, 'mindnprogress_delete_comment', '댓글과 연결된 답글을 삭제합니다.', {
    mapId: z.string().min(1), commentId: z.string().min(1),
  }, async ({ mapId, commentId }) => apiRequest(`/api/maps/${encodeURIComponent(mapId)}/comments/${encodeURIComponent(commentId)}`, { method: 'DELETE' }))
  registerTool(server, 'mindnprogress_set_comment_resolved', '댓글 스레드의 해결 또는 다시 열기 상태를 변경합니다.', {
    mapId: z.string().min(1), commentId: z.string().min(1), resolved: z.boolean(),
  }, async ({ mapId, commentId, resolved }) => apiRequest(`/api/maps/${encodeURIComponent(mapId)}/comments/${encodeURIComponent(commentId)}/resolve`, { method: 'PATCH', body: JSON.stringify({ resolved }) }))
  registerTool(server, 'mindnprogress_toggle_comment_reaction', '댓글의 이모지 반응을 추가하거나 취소합니다.', {
    mapId: z.string().min(1), commentId: z.string().min(1), emoji: z.enum(['👍', '❤️', '🎉', '👀']),
  }, async ({ mapId, commentId, emoji }) => apiRequest(`/api/maps/${encodeURIComponent(mapId)}/comments/${encodeURIComponent(commentId)}/reactions`, { method: 'POST', body: JSON.stringify({ emoji }) }))

  registerTool(server, 'mindnprogress_get_ai_conversation_transcript', '카드에 연결된 AionUi 대화의 전체 내용을 AionUi 세션 목록의 "전체 복사"와 같은 텍스트 형식으로 조회합니다. 사용자·어시스턴트·시스템 메시지를 시간순으로 반환하며 도구 호출 메시지는 제외합니다.', {
    mapId: z.string().min(1), cardId: z.string().min(1),
  }, async ({ mapId, cardId }) => {
    const map = await getDocument(mapId)
    const card = map.nodes.find((node) => node.id === cardId)
    if (!card) throw new Error('카드를 찾을 수 없습니다.')
    const conversationId = String(card.data?.aiConversationId ?? '').trim()
    if (!conversationId) throw new Error('카드에 연결된 AI 대화가 없습니다.')
    return apiRequest(`/api/integrations/aionui/conversations/${encodeURIComponent(conversationId)}/transcript`, {
      aiMapId: mapId,
      aiCardId: cardId,
    })
  })

  registerTool(server, 'mindnprogress_list_notifications', '현재 AI 편집자의 알림을 조회합니다.', {}, async () =>
    apiRequest('/api/notifications'))
  registerTool(server, 'mindnprogress_mark_notification_read', '알림을 읽음으로 표시합니다.', {
    notificationId: z.string().min(1),
  }, async ({ notificationId }) => apiRequest(`/api/notifications/${encodeURIComponent(notificationId)}/read`, { method: 'PATCH' }))
  registerTool(server, 'mindnprogress_mark_all_notifications_read', '모든 알림을 읽음으로 표시합니다.', {}, async () =>
    apiRequest('/api/notifications/read-all', { method: 'POST' }))

  await server.connect(new StdioServerTransport())
}

main().catch((error) => {
  console.error('[MindNProgress MCP]', error)
  process.exit(1)
})
