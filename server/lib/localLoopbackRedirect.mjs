import { networkInterfaces } from 'node:os'

function headerValue(headers, name) {
  const value = headers?.[name]
  return Array.isArray(value) ? value.join(',') : String(value ?? '')
}

function normalizeAddress(value) {
  let normalized = String(value ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '')
  if (normalized.startsWith('::ffff:')) normalized = normalized.slice('::ffff:'.length)
  const zoneIndex = normalized.indexOf('%')
  if (zoneIndex >= 0) normalized = normalized.slice(0, zoneIndex)
  return normalized
}

function isLoopbackAddress(value) {
  const address = normalizeAddress(value)
  return address === 'localhost' || address === '::1' || address.startsWith('127.')
}

export function collectLocalAddresses(interfaces = networkInterfaces()) {
  const addresses = new Set(['127.0.0.1', '::1'])
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      const address = normalizeAddress(entry?.address)
      if (address) addresses.add(address)
    }
  }
  return addresses
}

const localAddresses = collectLocalAddresses()

export function localLoopbackRedirectLocation(request, {
  addresses = localAddresses,
  loopbackHostname = '127.0.0.1',
} = {}) {
  if (request?.method !== 'GET') return null

  const headers = request.headers ?? {}
  const accept = headerValue(headers, 'accept').toLowerCase()
  const fetchMode = headerValue(headers, 'sec-fetch-mode').toLowerCase()
  if (!accept.includes('text/html') || (fetchMode && fetchMode !== 'navigate')) return null
  if (headerValue(headers, 'forwarded') || headerValue(headers, 'x-forwarded-for') || headerValue(headers, 'x-real-ip')) return null

  const host = headerValue(headers, 'host').trim()
  if (!host) return null

  let targetUrl
  try {
    targetUrl = new URL(request.url ?? '/', `http://${host}`)
  } catch {
    return null
  }

  const targetAddress = normalizeAddress(targetUrl.hostname)
  const remoteAddress = normalizeAddress(request.socket?.remoteAddress)
  if (!targetAddress || !remoteAddress || isLoopbackAddress(targetAddress)) return null
  if (!addresses.has(targetAddress) || !addresses.has(remoteAddress)) return null

  targetUrl.hostname = loopbackHostname
  return targetUrl.toString()
}
