export type TaskUrlProvider = 'dooray-task' | 'dooray-wiki' | 'web'

export type ParsedDoorayTaskUrl = {
  hostname: string
  projectId: string | null
  postId: string
  commentId: string | null
  key: string
  labelKey: string
  url: string
}

export type ParsedDoorayWikiUrl = {
  hostname: string
  spaceId: string | null
  pageId: string
  key: string
  url: string
}

const doorayHostnamePattern = /^(?:[a-z0-9-]+\.)+dooray\.com$/i
const canonicalTaskPathPattern = /^\/task\/(\d+)\/(\d+)\/?$/
const copiedTaskPathPattern = /^\/project\/tasks\/(\d+)\/?$/
const commentHashPattern = /^#comment-(\d+)$/
const canonicalWikiPathPattern = /^\/wiki\/(\d+)\/(\d+)\/?$/
const copiedWikiPathPattern = /^\/project\/pages\/(\d+)\/?$/

export function parseDoorayTaskUrl(value: string): ParsedDoorayTaskUrl | null {
  const rawValue = value.trim()
  if (!rawValue || rawValue.length > 2_048) return null
  try {
    const url = new URL(rawValue)
    const canonicalMatch = canonicalTaskPathPattern.exec(url.pathname)
    const copiedMatch = copiedTaskPathPattern.exec(url.pathname)
    if (url.protocol !== 'https:'
      || url.port
      || url.username
      || url.password
      || !doorayHostnamePattern.test(url.hostname)
      || (!canonicalMatch && !copiedMatch)) return null
    if (url.hash.startsWith('#comment-') && !commentHashPattern.test(url.hash)) return null

    const hostname = url.hostname.toLowerCase()
    const projectId = canonicalMatch?.[1] ?? null
    const postId = canonicalMatch?.[2] ?? copiedMatch?.[1]
    if (!postId) return null
    const commentId = commentHashPattern.exec(url.hash)?.[1] ?? null
    const pathname = projectId ? `/task/${projectId}/${postId}` : `/project/tasks/${postId}`
    const commentHash = commentId ? `#comment-${commentId}` : ''
    const key = `${hostname}:${postId}`
    return {
      hostname,
      projectId,
      postId,
      commentId,
      key,
      labelKey: commentId ? `${key}#comment-${commentId}` : key,
      url: `https://${hostname}${pathname}${commentHash}`,
    }
  } catch {
    return null
  }
}

export function normalizedDoorayTaskUrl(value: string) {
  return parseDoorayTaskUrl(value)?.url ?? null
}

export function parseDoorayWikiUrl(value: string): ParsedDoorayWikiUrl | null {
  const rawValue = value.trim()
  if (!rawValue || rawValue.length > 2_048) return null
  try {
    const url = new URL(rawValue)
    const canonicalMatch = canonicalWikiPathPattern.exec(url.pathname)
    const copiedMatch = copiedWikiPathPattern.exec(url.pathname)
    if (url.protocol !== 'https:'
      || url.port
      || url.username
      || url.password
      || !doorayHostnamePattern.test(url.hostname)
      || (!canonicalMatch && !copiedMatch)) return null

    const hostname = url.hostname.toLowerCase()
    const spaceId = canonicalMatch?.[1] ?? null
    const pageId = canonicalMatch?.[2] ?? copiedMatch?.[1]
    if (!pageId) return null
    const pathname = spaceId ? `/wiki/${spaceId}/${pageId}` : `/project/pages/${pageId}`
    return {
      hostname,
      spaceId,
      pageId,
      key: `${hostname}:${pageId}`,
      url: `https://${hostname}${pathname}`,
    }
  } catch {
    return null
  }
}

export function normalizedDoorayWikiUrl(value: string) {
  return parseDoorayWikiUrl(value)?.url ?? null
}

export function normalizedDoorayKnowledgeUrl(value: string) {
  return normalizedDoorayTaskUrl(value) ?? normalizedDoorayWikiUrl(value)
}

export function doorayTaskIdentityKey(value: string) {
  return parseDoorayTaskUrl(value)?.key ?? null
}

export function isSameDoorayTaskUrl(left: string, right: string) {
  const leftKey = doorayTaskIdentityKey(left)
  return Boolean(leftKey && leftKey === doorayTaskIdentityKey(right))
}

export function doorayWikiIdentityKey(value: string) {
  return parseDoorayWikiUrl(value)?.key ?? null
}

export function isSameDoorayWikiUrl(left: string, right: string) {
  const leftKey = doorayWikiIdentityKey(left)
  return Boolean(leftKey && leftKey === doorayWikiIdentityKey(right))
}

export function doorayKnowledgeIdentityKey(value: string) {
  const taskKey = doorayTaskIdentityKey(value)
  if (taskKey) return `task:${taskKey}`
  const wikiKey = doorayWikiIdentityKey(value)
  return wikiKey ? `wiki:${wikiKey}` : null
}

export function isSameDoorayKnowledgeUrl(left: string, right: string) {
  const leftKey = doorayKnowledgeIdentityKey(left)
  return Boolean(leftKey && leftKey === doorayKnowledgeIdentityKey(right))
}

export function taskUrlProvider(value: string): TaskUrlProvider | null {
  if (normalizedDoorayTaskUrl(value)) return 'dooray-task'
  if (normalizedDoorayWikiUrl(value)) return 'dooray-wiki'
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? 'web' : null
  } catch {
    return null
  }
}
