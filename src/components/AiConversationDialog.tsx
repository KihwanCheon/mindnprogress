import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { KnowledgePolicy } from '../types/mindMap'
import {
  AI_WORKSPACE_MAX_LENGTH,
  normalizeAiWorkspaceHistory,
  rememberAiWorkspace,
  removeAiWorkspace,
} from '../utils/aiWorkspaceHistory.mjs'
import {
  availableAiRuntimeOptionId,
  getAiRuntimeSelection,
  normalizeAiRuntimeSelections,
  rememberAiRuntimeSelection,
} from '../utils/aiRuntimeSelections.mjs'
import {
  AI_EDITOR_REQUEST_MAX_LENGTH,
  buildAiConversationPrompt,
  DEFAULT_AI_EDITOR_REQUEST,
  normalizeAiEditorRequest,
} from '../utils/aiConversationLaunch.mjs'
import './AiConversationDialog.css'

type RuntimeOption = { id: string; label: string; description: string; providerId?: string }
type AionAgent = {
  id: string
  name: string
  icon: string | null
  backend: string
  status: string
  models: RuntimeOption[]
  defaultModelId: string
  modes: RuntimeOption[]
  defaultMode: string
  thoughtLevels: RuntimeOption[]
  defaultThoughtLevel: string
}
type AionSkill = { id: string; name: string; description: string; autoInject: boolean }
type AionMcpServer = { id: string; name: string; description: string; toolCount: number; required: boolean }
type AionOptions = {
  connected: boolean
  protocol: string
  defaultWorkspace: string
  agents: AionAgent[]
  skills: AionSkill[]
  mcpServers: AionMcpServer[]
}
const runtimeSelectionsStorageKey = 'mindnprogress-ai-runtime-selections'
const mcpSelectionsStorageKey = 'mindnprogress-ai-mcp-selections'
const legacyWorkspaceHistoryStorageKey = 'mindnprogress-ai-workspace-history-v1'
const workspaceHistoryApiPath = '/api/integrations/aionui/workspaces'

function workspaceStorageKey(userId: string, documentId: string) {
  return `mindnprogress-ai-workspace:${userId}:${documentId}`
}

function workspaceHistoryStorageKey(userId: string) {
  return `mindnprogress-ai-workspace-history-v2:${userId}`
}

function readDocumentWorkspace(userId: string, documentId: string) {
  try {
    return localStorage.getItem(workspaceStorageKey(userId, documentId))
      ?? ''
  } catch {
    return ''
  }
}

function hasStoredDocumentWorkspace(userId: string, documentId: string) {
  try {
    return localStorage.getItem(workspaceStorageKey(userId, documentId)) !== null
  } catch {
    return false
  }
}

function storeDocumentWorkspace(userId: string, documentId: string, value: string) {
  try {
    localStorage.setItem(workspaceStorageKey(userId, documentId), value)
  } catch {
    // 브라우저 저장소를 사용할 수 없어도 현재 입력값은 계속 사용합니다.
  }
}

function readRuntimeSelections() {
  try {
    return normalizeAiRuntimeSelections(JSON.parse(localStorage.getItem(runtimeSelectionsStorageKey) ?? '{}'))
  } catch {
    return normalizeAiRuntimeSelections({})
  }
}

function storeRuntimeSelections(value: ReturnType<typeof normalizeAiRuntimeSelections>) {
  try {
    localStorage.setItem(runtimeSelectionsStorageKey, JSON.stringify(value))
  } catch {
    // 브라우저 저장소를 사용할 수 없어도 현재 대화 옵션은 계속 사용합니다.
  }
}

function readMcpSelections() {
  try {
    const value = JSON.parse(localStorage.getItem(mcpSelectionsStorageKey) ?? '[]') as unknown
    return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [])
  } catch {
    return new Set<string>()
  }
}

function readWorkspaceHistory(userId: string) {
  try {
    const stored = localStorage.getItem(workspaceHistoryStorageKey(userId))
      ?? localStorage.getItem(legacyWorkspaceHistoryStorageKey)
      ?? '[]'
    return normalizeAiWorkspaceHistory(JSON.parse(stored))
  } catch {
    return []
  }
}

function readLegacyWorkspaceHistory() {
  try {
    return normalizeAiWorkspaceHistory(JSON.parse(localStorage.getItem(legacyWorkspaceHistoryStorageKey) ?? '[]'))
  } catch {
    return []
  }
}

function storeWorkspaceHistory(userId: string, history: string[]) {
  try {
    localStorage.setItem(workspaceHistoryStorageKey(userId), JSON.stringify(history))
  } catch {
    // 브라우저 저장소를 사용할 수 없어도 현재 대화는 시작할 수 있습니다.
  }
}

function clearLegacyWorkspaceHistory() {
  try {
    localStorage.removeItem(legacyWorkspaceHistoryStorageKey)
  } catch {
    // 사용자별 서버 이력이 저장되었으므로 기존 공용 캐시 정리는 생략해도 됩니다.
  }
}

async function requestWorkspaceHistory(method: 'GET' | 'POST' | 'DELETE', body?: object) {
  const response = await fetch(workspaceHistoryApiPath, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    keepalive: true,
    signal: AbortSignal.timeout(5_000),
  })
  const result = await response.json().catch(() => ({})) as { workspaces?: unknown; error?: string }
  if (!response.ok) throw new Error(result.error ?? '최근 작업공간을 동기화하지 못했습니다.')
  return normalizeAiWorkspaceHistory(result.workspaces)
}

function encodeBase64Json(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function AiConversationDialog({ userId, documentId, documentTitle, cardId, cardTitle, knowledgeSources, initialRequest, launchInWebUi, onClose }: {
  userId: string
  documentId: string
  documentTitle: string
  cardId: string
  cardTitle: string
  knowledgeSources: { id: string; label: string; policy: KnowledgePolicy }[]
  initialRequest?: string
  launchInWebUi: boolean
  onClose: () => void
}) {
  const [options, setOptions] = useState<AionOptions | null>(null)
  const [loading, setLoading] = useState(true)
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState('')
  const [launchError, setLaunchError] = useState('')
  const [request, setRequest] = useState(() => normalizeAiEditorRequest(initialRequest) || DEFAULT_AI_EDITOR_REQUEST)
  const [agentId, setAgentId] = useState('')
  const [modelId, setModelId] = useState('')
  const [mode, setMode] = useState('')
  const [thoughtLevel, setThoughtLevel] = useState('')
  const [workspace, setWorkspace] = useState(() => readDocumentWorkspace(userId, documentId))
  const [workspaceHistory, setWorkspaceHistory] = useState(() => readWorkspaceHistory(userId))
  const workspaceHistoryRef = useRef(workspaceHistory)
  const workspaceHistoryMutationRef = useRef(0)
  const workspaceHistoryRequestRef = useRef<Promise<void>>(Promise.resolve())
  const runtimeSelectionsRef = useRef(readRuntimeSelections())
  const [selectedSkillIds, setSelectedSkillIds] = useState<Set<string>>(new Set())
  const [selectedMcpIds, setSelectedMcpIds] = useState<Set<string>>(new Set())

  const persistRuntimeSelection = useCallback((nextAgentId: string, selection: { modelId: string; mode: string; thoughtLevel: string }) => {
    const next = rememberAiRuntimeSelection(runtimeSelectionsRef.current, nextAgentId, selection)
    runtimeSelectionsRef.current = next
    storeRuntimeSelections(next)
  }, [])

  const applyWorkspaceHistory = useCallback((history: string[]) => {
    workspaceHistoryRef.current = history
    storeWorkspaceHistory(userId, history)
    setWorkspaceHistory(history)
  }, [userId])

  const enqueueWorkspaceHistoryRequest = useCallback((requestAction: () => Promise<string[]>) => {
    const operation = workspaceHistoryRequestRef.current.then(requestAction, requestAction)
    workspaceHistoryRequestRef.current = operation.then(() => undefined, () => undefined)
    return operation
  }, [])

  useEffect(() => {
    let active = true
    const legacyHistory = readLegacyWorkspaceHistory()
    const mutationVersion = workspaceHistoryMutationRef.current
    const operation = enqueueWorkspaceHistoryRequest(async () => {
      const serverHistory = await requestWorkspaceHistory('GET')
      if (legacyHistory.length === 0) return serverHistory
      return requestWorkspaceHistory('POST', { migration: true, workspaces: legacyHistory })
    })
    void operation.then((history) => {
      clearLegacyWorkspaceHistory()
      if (active && workspaceHistoryMutationRef.current === mutationVersion) applyWorkspaceHistory(history)
    }).catch(() => {
      // 서버가 일시적으로 응답하지 않으면 사용자별 브라우저 캐시를 계속 사용합니다.
    })
    return () => { active = false }
  }, [applyWorkspaceHistory, enqueueWorkspaceHistoryRequest])

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/integrations/aionui/options', { credentials: 'include', signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as AionOptions & { error?: string }
        if (!response.ok) throw new Error(body.error ?? 'AionUi 옵션을 불러오지 못했습니다.')
        return body
      })
      .then((body) => {
        setOptions(body)
        if (hasStoredDocumentWorkspace(userId, documentId)) {
          setWorkspace(readDocumentWorkspace(userId, documentId))
        } else if (typeof body.defaultWorkspace === 'string') {
          setWorkspace(body.defaultWorkspace.trim())
        }
        const savedSelections = runtimeSelectionsRef.current
        const savedMcpIds = readMcpSelections()
        const initialAgent = body.agents.find((agent) => agent.id === savedSelections.lastAgentId && agent.models.length > 0)
          ?? body.agents.find((agent) => agent.models.length > 0)
          ?? body.agents[0]
        if (initialAgent) {
          const savedAgentSelection = getAiRuntimeSelection(savedSelections, initialAgent.id)
          setAgentId(initialAgent.id)
          setModelId(availableAiRuntimeOptionId(initialAgent.models, savedAgentSelection.modelId, initialAgent.defaultModelId))
          setMode(availableAiRuntimeOptionId(initialAgent.modes, savedAgentSelection.mode, initialAgent.defaultMode))
          setThoughtLevel(availableAiRuntimeOptionId(initialAgent.thoughtLevels, savedAgentSelection.thoughtLevel, initialAgent.defaultThoughtLevel))
        }
        setSelectedSkillIds(new Set())
        setSelectedMcpIds(new Set(body.mcpServers.filter((server) => server.required || savedMcpIds.has(server.id)).map((server) => server.id)))
      })
      .catch((loadError) => {
        if (loadError instanceof DOMException && loadError.name === 'AbortError') return
        setError(loadError instanceof Error ? loadError.message : 'AionUi 옵션을 불러오지 못했습니다.')
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [documentId, userId])

  useEffect(() => {
    if (!options || !agentId) return
    persistRuntimeSelection(agentId, { modelId, mode, thoughtLevel })
  }, [agentId, mode, modelId, options, persistRuntimeSelection, thoughtLevel])

  useEffect(() => {
    if (!options) return
    const selectedIds = options.mcpServers
      .filter((server) => !server.required && selectedMcpIds.has(server.id))
      .map((server) => server.id)
    localStorage.setItem(mcpSelectionsStorageKey, JSON.stringify(selectedIds))
  }, [options, selectedMcpIds])

  const selectedAgent = useMemo(() => options?.agents.find((agent) => agent.id === agentId) ?? null, [agentId, options])
  const selectedModel = selectedAgent?.models.find((model) => model.id === modelId)

  const changeAgent = (nextAgentId: string) => {
    persistRuntimeSelection(agentId, { modelId, mode, thoughtLevel })
    setAgentId(nextAgentId)
    const nextAgent = options?.agents.find((agent) => agent.id === nextAgentId)
    const savedAgentSelection = getAiRuntimeSelection(runtimeSelectionsRef.current, nextAgentId)
    setModelId(nextAgent ? availableAiRuntimeOptionId(nextAgent.models, savedAgentSelection.modelId, nextAgent.defaultModelId) : '')
    setMode(nextAgent ? availableAiRuntimeOptionId(nextAgent.modes, savedAgentSelection.mode, nextAgent.defaultMode) : '')
    setThoughtLevel(nextAgent ? availableAiRuntimeOptionId(nextAgent.thoughtLevels, savedAgentSelection.thoughtLevel, nextAgent.defaultThoughtLevel) : '')
  }

  const toggleSelection = (setter: Dispatch<SetStateAction<Set<string>>>, id: string) => {
    setter((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const updateWorkspace = (value: string) => {
    setWorkspace(value)
    storeDocumentWorkspace(userId, documentId, value)
  }

  const rememberWorkspace = async (value: string) => {
    const normalizedWorkspace = value.trim()
    if (!normalizedWorkspace) return
    storeDocumentWorkspace(userId, documentId, normalizedWorkspace)
    const next = rememberAiWorkspace(workspaceHistoryRef.current, normalizedWorkspace)
    const mutationVersion = ++workspaceHistoryMutationRef.current
    applyWorkspaceHistory(next)
    try {
      const history = await enqueueWorkspaceHistoryRequest(() => requestWorkspaceHistory('POST', { workspace: normalizedWorkspace }))
      if (workspaceHistoryMutationRef.current === mutationVersion) applyWorkspaceHistory(history)
    } catch {
      // 대화 시작은 서버 이력 저장 실패로 막지 않고 브라우저 캐시로 보완합니다.
    }
  }

  const deleteWorkspaceHistory = async (value: string) => {
    const previous = workspaceHistoryRef.current
    const next = removeAiWorkspace(workspaceHistoryRef.current, value)
    const mutationVersion = ++workspaceHistoryMutationRef.current
    applyWorkspaceHistory(next)
    try {
      const history = await enqueueWorkspaceHistoryRequest(() => requestWorkspaceHistory('DELETE', { workspace: value }))
      if (workspaceHistoryMutationRef.current === mutationVersion) applyWorkspaceHistory(history)
    } catch {
      if (workspaceHistoryMutationRef.current === mutationVersion) applyWorkspaceHistory(previous)
    }
  }

  const launch = async () => {
    if (!options || !selectedAgent || !modelId || !request.trim()) return
    let launchTab: Window | null = null
    if (launchInWebUi) {
      launchTab = window.open('about:blank', '_blank')
      if (!launchTab) {
        setLaunchError('AionUi 대화 탭을 열지 못했습니다. 브라우저의 팝업 차단을 해제한 뒤 다시 시도해 주세요.')
        return
      }
      try {
        launchTab.document.title = 'AionUi 대화 준비 중'
        launchTab.document.body.textContent = 'AionUi 대화를 준비하는 중…'
        launchTab.document.body.style.cssText = 'margin:0;display:grid;place-items:center;min-height:100vh;font:14px system-ui;color:#666;background:#f7f7f8'
        launchTab.opener = null
      } catch {
        // 빈 탭 상태 안내를 만들 수 없어도 ticket 발급과 이동은 계속합니다.
      }
    }
    setLaunching(true)
    setLaunchError('')
    try {
      const enabledSkillIds = options.skills.filter((skill) => !skill.autoInject && selectedSkillIds.has(skill.id)).map((skill) => skill.id)
      const disabledBuiltinSkillIds = options.skills.filter((skill) => skill.autoInject && !selectedSkillIds.has(skill.id)).map((skill) => skill.id)
      const mcpIds = options.mcpServers.filter((server) => server.required || selectedMcpIds.has(server.id)).map((server) => server.id)
      const attributionResponse = await fetch('/api/integrations/aionui/attributions', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: selectedAgent.id,
          modelId,
          providerId: selectedModel?.providerId,
          mapId: documentId,
          cardId,
          mode: mode || undefined,
          thoughtLevel: thoughtLevel || undefined,
          enabledSkillIds,
          disabledBuiltinSkillIds,
          mcpIds,
          workspace: workspace.trim() || undefined,
          requestPreview: request.trim(),
        }),
      })
      const attribution = await attributionResponse.json().catch(() => ({})) as { attributionToken?: string; completionUrl?: string; editorId?: string; error?: string }
      if (!attributionResponse.ok || !attribution.attributionToken || !attribution.completionUrl || !attribution.editorId) {
        throw new Error(attribution.error ?? 'AI 작성자 정보를 준비하지 못했습니다.')
      }
      const prompt = buildAiConversationPrompt({
        mapId: documentId,
        cardId,
        editorId: attribution.editorId,
        attributionToken: attribution.attributionToken,
        request,
      })
      const launchPayload = {
        agentId: selectedAgent.id,
        completionUrl: attribution.completionUrl,
        title: `${documentTitle}: ${cardTitle}`.replace(/\s+/g, ' ').trim().slice(0, 120),
        prompt,
        modelId,
        providerId: selectedModel?.providerId,
        mode: mode || undefined,
        thoughtLevel: thoughtLevel || undefined,
        enabledSkillIds,
        disabledBuiltinSkillIds,
        mcpIds,
        workspace: workspace.trim() || undefined,
        autoSend: true,
      }
      void rememberWorkspace(workspace)
      if (launchInWebUi) {
        const launchResponse = await fetch('/api/integrations/aionui/external-conversation-launches', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(launchPayload),
        })
        const launchResult = await launchResponse.json().catch(() => ({})) as { launchUrl?: string; error?: string }
        if (!launchResponse.ok || !launchResult.launchUrl) {
          throw new Error(launchResult.error ?? 'AionUi WebUI 대화 시작 정보를 발급하지 못했습니다.')
        }
        if (!launchTab || launchTab.closed) {
          launchTab = null
          throw new Error('준비 중이던 AionUi 탭이 닫혔습니다. 다시 시도해 주세요.')
        }
        launchTab.location.href = launchResult.launchUrl
        launchTab.focus()
        launchTab = null
      } else {
        const data = encodeURIComponent(encodeBase64Json({ payload: JSON.stringify(launchPayload) }))
        window.location.href = `${options.protocol}?v=1&data=${data}`
      }
      onClose()
    } catch (launchFailure) {
      if (launchTab && !launchTab.closed) launchTab.close()
      setLaunchError(launchFailure instanceof Error ? launchFailure.message : 'AI 대화를 시작하지 못했습니다.')
    } finally {
      setLaunching(false)
    }
  }

  return (
    <div className="ai-dialog-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="ai-dialog" role="dialog" aria-modal="true" aria-label="AI 대화 시작 옵션">
        <header>
          <div><span>AionUi 연동</span><strong>AI 대화 시작</strong><small>{cardTitle}</small></div>
          <button type="button" onClick={onClose} aria-label="AI 대화 옵션 닫기">×</button>
        </header>
        {loading ? <div className="ai-dialog-message">AionUi의 새 채팅 옵션을 불러오는 중…</div> : error ? (
          <div className="ai-dialog-message error"><strong>연결할 수 없습니다.</strong><span>{error}</span><small>AionUi를 실행한 뒤 다시 시도해 주세요.</small></div>
        ) : options && (
          <div className="ai-dialog-content">
            {knowledgeSources.length > 0 && (
              <div className="ai-knowledge-notice">
                <strong>선행 지식 {knowledgeSources.length}개를 먼저 사용합니다.</strong>
                <span>{knowledgeSources.map((source) => `${source.label} · ${source.policy === 'reuse-first' ? '주요 지식' : '부족할 때 확인'}`).join(' / ')}</span>
                <small>최상위 업무와 원본 자료는 선행 지식만으로 부족할 때만 선택적으로 확인합니다.</small>
              </div>
            )}
            <label className="ai-request"><span>AI에게 요청할 내용</span><textarea value={request} onChange={(event) => setRequest(event.target.value)} rows={4} maxLength={AI_EDITOR_REQUEST_MAX_LENGTH} autoFocus /></label>
            <div className="ai-dialog-grid">
              <label><span>AI 종류</span><select value={agentId} onChange={(event) => changeAgent(event.target.value)}>{options.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
              <label><span>모델</span><select value={modelId} onChange={(event) => setModelId(event.target.value)}>{selectedAgent?.models.map((model) => <option key={`${model.providerId ?? ''}-${model.id}`} value={model.id}>{model.label}</option>)}</select></label>
              {selectedAgent && selectedAgent.modes.length > 0 && <label><span>권한</span><select value={mode} onChange={(event) => setMode(event.target.value)}>{selectedAgent.modes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
              {selectedAgent && selectedAgent.thoughtLevels.length > 0 && <label><span>사고 수준</span><select value={thoughtLevel} onChange={(event) => setThoughtLevel(event.target.value)}>{selectedAgent.thoughtLevels.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
            </div>
            <div className="ai-workspace-field">
              <label><span>작업공간</span><input value={workspace} onChange={(event) => updateWorkspace(event.target.value)} placeholder="선택사항" maxLength={AI_WORKSPACE_MAX_LENGTH} /></label>
              {workspaceHistory.length > 0 && (
                <div className="ai-workspace-history">
                  <div className="ai-workspace-history-heading"><span>최근 작업공간</span><small>{workspaceHistory.length}개</small></div>
                  <div className="ai-workspace-history-list" role="list" aria-label="최근 작업공간">
                    {workspaceHistory.map((item) => (
                      <div className={`ai-workspace-history-item ${workspace.trim() === item ? 'selected' : ''}`} role="listitem" key={item}>
                        <button type="button" className="ai-workspace-history-select" onClick={() => updateWorkspace(item)} title={item}>
                          <span>{item}</span>
                        </button>
                        <button type="button" className="ai-workspace-history-remove" onClick={() => { void deleteWorkspaceHistory(item) }} aria-label={`${item} 이력 삭제`} title="이력에서 삭제">×</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <details open>
              <summary>MCP 도구 <b>{options.mcpServers.filter((server) => server.required || selectedMcpIds.has(server.id)).length}</b></summary>
              <div className="ai-capability-list ai-mcp-capability-list" aria-label="사용할 MCP 도구 선택">
                {options.mcpServers.map((server) => (
                  <label key={server.id} title={server.description}>
                    <input type="checkbox" checked={server.required || selectedMcpIds.has(server.id)} disabled={server.required} onChange={() => toggleSelection(setSelectedMcpIds, server.id)} />
                    <span>
                      <strong>{server.name}{server.required ? ' · 필수' : ''}</strong>
                      <small>{server.toolCount > 0 ? `${server.toolCount}개 도구` : server.description || '도구 정보 없음'}</small>
                    </span>
                  </label>
                ))}
              </div>
            </details>
            <details open>
              <summary>스킬 <b>{selectedSkillIds.size}</b></summary>
              <div className="ai-capability-list">{options.skills.map((skill) => <label key={skill.id} title={skill.description}><input type="checkbox" checked={selectedSkillIds.has(skill.id)} onChange={() => toggleSelection(setSelectedSkillIds, skill.id)} /><span><strong>{skill.name}</strong><small>{skill.description || '설명 없음'}</small></span></label>)}</div>
            </details>
            {launchError && <div className="ai-launch-error" role="alert">{launchError}</div>}
          </div>
        )}
        <footer><span>응답은 AionUi에서만 처리됩니다.</span><div><button type="button" onClick={onClose}>취소</button><button type="button" className="primary" onClick={() => { void launch() }} disabled={loading || launching || Boolean(error) || !selectedAgent || !modelId || !request.trim()}>{launching ? '준비 중…' : 'AionUi에서 시작'}</button></div></footer>
      </section>
    </div>
  )
}
