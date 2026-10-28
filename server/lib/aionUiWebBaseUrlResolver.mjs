import { probeAionUiWebPorts, replaceUrlPort } from './aionUiWebPortProbe.mjs'

export const AIONUI_WEB_RESOLVED_TTL_MS = 30_000
export const AIONUI_WEB_UNRESOLVED_TTL_MS = 5_000

function resolvedFromProbe(baseUrl, result) {
  if (result?.status === 'port-mismatch' && result.respondingPorts?.length > 0) {
    return { url: replaceUrlPort(baseUrl, result.respondingPorts[0]), resolved: true }
  }
  return { url: baseUrl, resolved: result?.status === 'ok' }
}

/**
 * 'AI 대화 열기' 링크에 쓸 WebUI 주소를 실제 응답 포트로 맞춘다.
 * AionUi는 dev(7777)와 release(25808)의 WebUI 포트가 달라, 설정 포트만 믿으면
 * 다른 모드로 실행한 머신의 대화가 열리지 않는다. 응답 포트를 찾지 못하면 설정 주소를 그대로 쓴다.
 */
export function createAionUiWebBaseUrlResolver({
  probe = probeAionUiWebPorts,
  now = Date.now,
  resolvedTtlMs = AIONUI_WEB_RESOLVED_TTL_MS,
  unresolvedTtlMs = AIONUI_WEB_UNRESOLVED_TTL_MS,
} = {}) {
  const cache = new Map()
  const inFlight = new Map()

  function store(baseUrl, entry) {
    cache.set(baseUrl, { url: entry.url, expiresAt: now() + (entry.resolved ? resolvedTtlMs : unresolvedTtlMs) })
  }

  function cached(baseUrl) {
    const entry = cache.get(baseUrl)
    if (!entry) return null
    if (entry.expiresAt <= now()) {
      cache.delete(baseUrl)
      return null
    }
    return entry.url
  }

  return {
    peek(baseUrl) {
      return cached(baseUrl) ?? baseUrl
    },
    remember(baseUrl, result) {
      store(baseUrl, resolvedFromProbe(baseUrl, result))
    },
    async resolve(baseUrl, { signal } = {}) {
      const hit = cached(baseUrl)
      if (hit) return hit
      const pending = inFlight.get(baseUrl)
      if (pending) return pending
      const work = (async () => {
        try {
          const result = await probe(baseUrl, { signal })
          // 종료 중에 중단된 결과는 실제 상태가 아니므로 캐시하지 않는다.
          if (signal?.aborted) return baseUrl
          const entry = resolvedFromProbe(baseUrl, result)
          store(baseUrl, entry)
          return entry.url
        } catch {
          return baseUrl
        } finally {
          inFlight.delete(baseUrl)
        }
      })()
      inFlight.set(baseUrl, work)
      return work
    },
  }
}
