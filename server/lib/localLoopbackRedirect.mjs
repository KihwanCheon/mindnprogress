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

// 서버와 같은 PC에서 온 요청인지 판별한다.
// 개발 서버(Vite)가 /api를 프록시하면 소켓 주소는 항상 루프백이 되므로
// 프록시가 붙인 실제 접속 주소와 브라우저가 사용한 Host를 함께 본다.
export function isLocalLoopbackRequest(request) {
  const headers = request?.headers ?? {}
  // 프록시가 마지막에 덧붙인 값이 실제 접속 주소다. 앞쪽 값은 클라이언트가 넣을 수 있다.
  const forwardedChain = headerValue(headers, 'x-forwarded-for').split(',').map((item) => item.trim()).filter(Boolean)
  const clientAddress = forwardedChain.at(-1) ?? request?.socket?.remoteAddress
  if (!isLoopbackAddress(clientAddress)) return false

  const realIp = headerValue(headers, 'x-real-ip').trim()
  if (realIp && !isLoopbackAddress(realIp)) return false
  const forwarded = headerValue(headers, 'forwarded').trim()
  if (forwarded && !/for=\s*"?\[?(?:127\.|::1|localhost)/i.test(forwarded)) return false

  // 같은 PC라도 LAN 주소로 접속했다면 브라우저 주소가 루프백이 아니다.
  const host = headerValue(headers, 'host').trim()
  if (!host) return false
  return isLoopbackAddress(normalizeAddress(host.replace(/:\d+$/, '')))
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
