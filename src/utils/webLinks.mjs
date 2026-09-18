const WEB_LINK_MAX_LENGTH = 2_048

function decodedPathSegment(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function parseWebLinkUrl(value) {
  const rawValue = typeof value === 'string' ? value.trim() : ''
  if (!rawValue || rawValue.length > WEB_LINK_MAX_LENGTH || /\s/.test(rawValue)) return null

  try {
    const url = new URL(rawValue)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    const hostname = url.hostname.toLowerCase()
    const pathSegments = url.pathname.split('/').filter(Boolean)
    const lastPathSegment = decodedPathSegment(pathSegments.at(-1) ?? '').trim()
    const title = lastPathSegment || hostname.replace(/^www\./i, '')
    const path = url.pathname === '/' ? '' : `${url.pathname}${url.hash}`
    return {
      url: url.href,
      hostname,
      displayHostname: hostname.replace(/^www\./i, ''),
      title: title.slice(0, 120),
      path: path || '/',
    }
  } catch {
    return null
  }
}

export function normalizedWebLinkUrl(value) {
  return parseWebLinkUrl(value)?.url ?? null
}

export function isSameWebLinkUrl(left, right) {
  const leftUrl = normalizedWebLinkUrl(left)
  return Boolean(leftUrl && leftUrl === normalizedWebLinkUrl(right))
}
