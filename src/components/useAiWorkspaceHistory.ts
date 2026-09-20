import { useCallback, useEffect, useRef, useState } from 'react'
import { normalizeAiWorkspaceHistory, rememberAiWorkspace, removeAiWorkspace } from '../utils/aiWorkspaceHistory.mjs'

const queues = new Map<string, Promise<unknown>>()
const scopeKey = (userId: string, machineId: string) => JSON.stringify([userId, machineId])
const cacheKey = (key: string) => `mindnprogress-ai-workspace-history-v3:${key}`

function readCache(userId: string, machineId: string) {
  if (!userId || !machineId) return []
  try {
    // 계정·머신을 모두 명시한 구버전 캐시만 이전한다. 공용 v1/계정 전용 캐시는 사용하지 않는다.
    const stored = localStorage.getItem(cacheKey(scopeKey(userId, machineId)))
      ?? localStorage.getItem(`mindnprogress-ai-workspace-history-v2:${userId}:${machineId}`)
    return normalizeAiWorkspaceHistory(JSON.parse(stored ?? '[]'))
  } catch { return [] }
}

function storeCache(key: string, history: string[]) {
  try { localStorage.setItem(cacheKey(key), JSON.stringify(history)) } catch { /* 캐시 없이 서버 이력을 사용한다. */ }
}

async function requestHistory(userId: string, machineId: string, method: 'GET' | 'POST' | 'DELETE', body?: object) {
  const response = await fetch(`/api/integrations/aionui/workspaces?${new URLSearchParams({ machineId })}`, {
    method, credentials: 'include', keepalive: true, signal: AbortSignal.timeout(5_000),
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify({ ...body, expectedUserId: userId }) : undefined,
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error ?? '최근 작업공간을 동기화하지 못했습니다.')
  if (result.userId !== userId || result.machineId !== machineId) {
    throw new Error('계정·머신별 작업공간 응답이 다릅니다. MnP 업데이트와 로그인 상태를 확인해 주세요.')
  }
  return normalizeAiWorkspaceHistory(result.workspaces)
}

function enqueue<T>(key: string, action: () => Promise<T>): Promise<T> {
  // 팝업을 닫고 다시 열어도 같은 계정·머신의 삭제/저장/조회 순서를 유지한다.
  const operation = (queues.get(key) ?? Promise.resolve()).then(action, action)
  queues.set(key, operation)
  void operation.finally(() => { if (queues.get(key) === operation) queues.delete(key) }).catch(() => {})
  return operation
}

export function useAiWorkspaceHistory(userId: string, machineId: string) {
  const key = scopeKey(userId, machineId)
  const currentKey = useRef(key)
  currentKey.current = key
  const version = useRef(0)
  const [state, setState] = useState({ key: '', history: [] as string[], error: '' })
  const history = state.key === key ? state.history : []
  const historyRef = useRef(history)
  historyRef.current = history

  useEffect(() => {
    if (!userId || !machineId) return
    let active = true
    const requestVersion = ++version.current
    const cached = readCache(userId, machineId)
    setState({ key, history: cached, error: '' })
    void enqueue(key, async () => {
      const serverHistory = await requestHistory(userId, machineId, 'GET')
      return cached.length ? requestHistory(userId, machineId, 'POST', { migration: true, workspaces: cached }) : serverHistory
    }).then((workspaces) => {
      storeCache(key, workspaces)
      if (active && currentKey.current === key && version.current === requestVersion) setState({ key, history: workspaces, error: '' })
    }).catch((reason) => {
      if (active && currentKey.current === key && version.current === requestVersion) {
        setState({ key, history: cached, error: reason.message })
      }
    })
    return () => { active = false }
  }, [key, userId, machineId])

  const mutate = useCallback(async (method: 'POST' | 'DELETE', workspace: string) => {
    if (!userId || !machineId || currentKey.current !== key) throw new Error('실행 머신을 먼저 확인해 주세요.')
    const previous = historyRef.current
    const next = method === 'POST' ? rememberAiWorkspace(previous, workspace) : removeAiWorkspace(previous, workspace)
    const requestVersion = ++version.current
    historyRef.current = next
    setState({ key, history: next, error: '' })
    storeCache(key, next)
    try {
      const workspaces = await enqueue(key, () => requestHistory(userId, machineId, method, { workspace }))
      storeCache(key, workspaces)
      if (currentKey.current === key && version.current === requestVersion) setState({ key, history: workspaces, error: '' })
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '최근 작업공간을 저장하지 못했습니다.'
      if (currentKey.current === key && version.current === requestVersion) {
        const restored = method === 'DELETE' ? previous : next
        historyRef.current = restored
        storeCache(key, restored)
        setState({ key, history: restored, error: message })
      }
      if (method === 'DELETE') throw reason
      // 이력 저장 실패로 이미 시작된 AI 대화를 실패 처리하지 않는다.
    }
  }, [key, userId, machineId])

  return { history, error: state.key === key ? state.error : '',
    remember: (workspace: string) => mutate('POST', workspace),
    remove: (workspace: string) => mutate('DELETE', workspace) }
}
