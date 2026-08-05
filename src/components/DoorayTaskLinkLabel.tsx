import { useEffect, useMemo, useState } from 'react'
import { parseDoorayTaskUrl } from '../utils/externalLinks'

type DoorayTaskTitle = {
  key?: string
  url: string
  title: string
  comment?: { id: string; authorName: string }
}

type ResolvedDoorayTaskLabel = {
  title: string
  commentAuthorName: string | null
}

const resolvedLabels = new Map<string, ResolvedDoorayTaskLabel>()
const waitingListeners = new Map<string, Set<(label: ResolvedDoorayTaskLabel | null) => void>>()
const queuedUrls = new Map<string, string>()
const inFlightKeys = new Set<string>()
let flushTimer: ReturnType<typeof setTimeout> | null = null

function notifyLabel(key: string, label: ResolvedDoorayTaskLabel | null) {
  const listeners = waitingListeners.get(key)
  listeners?.forEach((listener) => listener(label))
  if (label) waitingListeners.delete(key)
}

function scheduleTitleLookup() {
  if (flushTimer !== null) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flushTitleLookup()
  }, 0)
}

async function flushTitleLookup() {
  const entries = [...queuedUrls].slice(0, 50)
  const urls = entries.map(([, url]) => url)
  entries.forEach(([key]) => {
    queuedUrls.delete(key)
    inFlightKeys.add(key)
  })
  if (urls.length === 0) return

  try {
    const response = await fetch('/api/integrations/dooray/task-titles', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls }),
    })
    const body = await response.json().catch(() => ({})) as { tasks?: DoorayTaskTitle[] }
    if (!response.ok) throw new Error('DOORAY_TASK_TITLE_LOOKUP_FAILED')
    const tasks = new Map((body.tasks ?? []).map((task) => [
      task.key ?? parseDoorayTaskUrl(task.url)?.labelKey,
      {
        title: task.title,
        commentAuthorName: task.comment?.authorName?.trim() || null,
      },
    ]))
    entries.forEach(([key]) => {
      const task = tasks.get(key)
      const label = task?.title.trim() ? { ...task, title: task.title.trim() } : null
      if (label) resolvedLabels.set(key, label)
      notifyLabel(key, label)
    })
  } catch {
    entries.forEach(([key]) => notifyLabel(key, null))
  } finally {
    entries.forEach(([key]) => inFlightKeys.delete(key))
    if (queuedUrls.size > 0) scheduleTitleLookup()
  }
}

function requestTitle(key: string, url: string) {
  if (resolvedLabels.has(key) || queuedUrls.has(key) || inFlightKeys.has(key)) return
  queuedUrls.set(key, url)
  scheduleTitleLookup()
}

export function DoorayTaskLinkLabel({ href, fallback }: { href: string; fallback: string }) {
  const task = useMemo(() => parseDoorayTaskUrl(href), [href])
  const [label, setLabel] = useState<ResolvedDoorayTaskLabel | null>(() => task ? resolvedLabels.get(task.labelKey) ?? null : null)

  useEffect(() => {
    if (!task) {
      setLabel(null)
      return
    }

    const cached = resolvedLabels.get(task.labelKey)
    if (cached) {
      setLabel(cached)
      return
    }

    setLabel(null)
    const listeners = waitingListeners.get(task.labelKey) ?? new Set()
    listeners.add(setLabel)
    waitingListeners.set(task.labelKey, listeners)
    requestTitle(task.labelKey, task.url)
    return () => {
      listeners.delete(setLabel)
      if (listeners.size === 0) waitingListeners.delete(task.labelKey)
    }
  }, [task])

  return <>
    {label?.title || fallback}
    {label?.title && task?.commentId && (
      <>
        <span className="dooray-comment-link-icon" title="Dooray 코멘트" aria-label="Dooray 코멘트">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3.25 2.5h9.5A1.75 1.75 0 0 1 14.5 4.25v5.5a1.75 1.75 0 0 1-1.75 1.75H7l-3.8 2.25.55-2.25h-.5A1.75 1.75 0 0 1 1.5 9.75v-5.5A1.75 1.75 0 0 1 3.25 2.5Z" />
          </svg>
        </span>
        <span className="dooray-comment-author" title={`코멘트 작성자: ${label.commentAuthorName || '확인 불가'}`}>
          {label.commentAuthorName || '작성자 미상'}
        </span>
      </>
    )}
  </>
}
