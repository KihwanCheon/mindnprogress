export type TaskUrlProvider = 'dooray-task' | 'web'

export function normalizedDoorayTaskUrl(value: string) {
  try {
    const url = new URL(value.trim())
    const match = /^\/task\/(\d+)\/(\d+)\/?$/.exec(url.pathname)
    if (url.protocol !== 'https:' || url.port || !/^(?:[a-z0-9-]+\.)+dooray\.com$/i.test(url.hostname) || !match) return null
    return `https://${url.hostname.toLowerCase()}/task/${match[1]}/${match[2]}`
  } catch {
    return null
  }
}

export function taskUrlProvider(value: string): TaskUrlProvider | null {
  if (normalizedDoorayTaskUrl(value)) return 'dooray-task'
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? 'web' : null
  } catch {
    return null
  }
}
