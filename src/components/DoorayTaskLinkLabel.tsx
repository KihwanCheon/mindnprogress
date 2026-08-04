import { useEffect, useMemo, useState } from 'react'
import { normalizedDoorayTaskUrl } from '../utils/externalLinks'

type DoorayTaskTitle = { url: string; title: string }

const resolvedTitles = new Map<string, string>()
const waitingListeners = new Map<string, Set<(title: string | null) => void>>()
const queuedUrls = new Set<string>()
const inFlightUrls = new Set<string>()
let flushTimer: ReturnType<typeof setTimeout> | null = null

function notifyTitle(url: string, title: string | null) {
  const listeners = waitingListeners.get(url)
  listeners?.forEach((listener) => listener(title))
  if (title) waitingListeners.delete(url)
}

function scheduleTitleLookup() {
  if (flushTimer !== null) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flushTitleLookup()
  }, 0)
}

async function flushTitleLookup() {
  const urls = [...queuedUrls].slice(0, 50)
  urls.forEach((url) => {
    queuedUrls.delete(url)
    inFlightUrls.add(url)
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
    const tasks = new Map((body.tasks ?? []).map((task) => [task.url, task.title]))
    urls.forEach((url) => {
      const title = tasks.get(url)?.trim() || null
      if (title) resolvedTitles.set(url, title)
      notifyTitle(url, title)
    })
  } catch {
    urls.forEach((url) => notifyTitle(url, null))
  } finally {
    urls.forEach((url) => inFlightUrls.delete(url))
    if (queuedUrls.size > 0) scheduleTitleLookup()
  }
}

function requestTitle(url: string) {
  if (resolvedTitles.has(url) || queuedUrls.has(url) || inFlightUrls.has(url)) return
  queuedUrls.add(url)
  scheduleTitleLookup()
}

export function DoorayTaskLinkLabel({ href, fallback }: { href: string; fallback: string }) {
  const url = useMemo(() => normalizedDoorayTaskUrl(href), [href])
  const [title, setTitle] = useState<string | null>(() => url ? resolvedTitles.get(url) ?? null : null)

  useEffect(() => {
    if (!url) {
      setTitle(null)
      return
    }

    const cached = resolvedTitles.get(url)
    if (cached) {
      setTitle(cached)
      return
    }

    setTitle(null)
    const listeners = waitingListeners.get(url) ?? new Set()
    listeners.add(setTitle)
    waitingListeners.set(url, listeners)
    requestTitle(url)
    return () => {
      listeners.delete(setTitle)
      if (listeners.size === 0) waitingListeners.delete(url)
    }
  }, [url])

  return <>{title || fallback}</>
}
