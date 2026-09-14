import { useEffect, useRef, useState } from 'react'
import { normalizeAiDialogSections, type AiDialogSection, type AiDialogSections } from '../utils/aiDialogSections.mjs'

// 닫은 직후 다시 열어도 앞선 저장 뒤에 읽는다. 계정이 바뀐 요청은 서버에서 거부한다.
const queues = new Map<string, Promise<unknown>>()
function requestSections(userId: string, sections?: Partial<AiDialogSections>) {
  const operation = (queues.get(userId) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const response = await fetch('/api/integrations/aionui/dialog-preferences', {
      method: sections ? 'PATCH' : 'GET', credentials: 'include', keepalive: true, signal: AbortSignal.timeout(5_000),
      headers: sections ? { 'Content-Type': 'application/json' } : undefined,
      body: sections ? JSON.stringify({ expectedUserId: userId, sections }) : undefined,
    })
    const body = await response.json().catch(() => ({})) as { userId?: string; sections?: unknown; error?: string }
    if (!response.ok) throw Error(body.error ?? '계정의 접힘 상태를 동기화하지 못했습니다.')
    if (body.userId !== userId) throw Error('로그인 계정이 변경되었습니다. 대화 시작 창을 다시 열어 주세요.')
    return normalizeAiDialogSections(body.sections)
  })
  queues.set(userId, operation)
  void operation.finally(() => { if (queues.get(userId) === operation) queues.delete(userId) }).catch(() => {})
  return operation
}

export function useAiDialogSections(userId: string) {
  const [sections, setSections] = useState<AiDialogSections>(() => normalizeAiDialogSections(null))
  const [error, setError] = useState('')
  const state = useRef({ userId, active: false, value: sections, dirty: {} as Partial<AiDialogSections>, pending: {} as Partial<Record<AiDialogSection, number>>, version: 0, loadFailed: false })

  useEffect(() => {
    const current = { userId, active: true, value: normalizeAiDialogSections(null), dirty: {} as Partial<AiDialogSections>, pending: {} as Partial<Record<AiDialogSection, number>>, version: 0, loadFailed: false }
    state.current = current
    setSections(current.value); setError('')
    void requestSections(userId).then(saved => {
      if (!current.active) return
      current.value = { ...saved, ...current.dirty }
      setSections(current.value)
    }).catch(() => {
      if (!current.active) return
      current.loadFailed = true
      setError('계정의 접힘 상태를 불러오지 못했습니다. 현재 화면에서는 접고 펼칠 수 있습니다.')
    })
    return () => { current.active = false }
  }, [userId])

  const save = (patch: Partial<AiDialogSections>) => {
    const current = state.current
    const revisions = { ...current.pending }
    void requestSections(current.userId, patch).then(() => {
      if (!current.active) return
      for (const key of Object.keys(patch) as AiDialogSection[]) {
        if (current.pending[key] === revisions[key]) delete current.pending[key]
      }
      if (!Object.keys(current.pending).length && !current.loadFailed) setError('')
    }).catch(() => {
      if (current.active && (Object.keys(patch) as AiDialogSection[]).some(key => current.pending[key] === revisions[key])) setError('접힘 상태를 계정에 저장하지 못했습니다. 현재 화면에만 적용되어 있습니다.')
    })
  }
  const toggle = (section: AiDialogSection) => {
    const current = state.current, open = !current.value[section]
    current.value = { ...current.value, [section]: open }
    current.dirty[section] = open; current.pending[section] = ++current.version
    setSections(current.value)
    save({ [section]: open })
  }
  const retry = () => {
    const current = state.current
    if (Object.keys(current.pending).length) save(Object.fromEntries(Object.keys(current.pending).map(key => [key, current.value[key as AiDialogSection]])))
    if (current.loadFailed) {
      void requestSections(current.userId).then(saved => {
        if (!current.active) return
        current.loadFailed = false; current.value = { ...saved, ...current.dirty }
        setSections(current.value)
        if (!Object.keys(current.pending).length) setError('')
      }).catch(() => { if (current.active) setError('계정의 접힘 상태를 다시 불러오지 못했습니다.') })
    }
  }
  return { sections, toggle, error, retry }
}
