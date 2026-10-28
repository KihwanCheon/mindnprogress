import http from 'node:http'
import https from 'node:https'

// AionUi WebUI 포트는 실행 모드에 따라 고정값이 달라진다.
// AionUi packages/desktop/src/common/config/constants.ts 의 WEBUI_DEFAULT_PORT 와 맞춘다.
export const AIONUI_WEB_KNOWN_PORTS = Object.freeze([
  Object.freeze({ port: 7777, mode: 'dev' }),
  Object.freeze({ port: 25808, mode: 'release' }),
  Object.freeze({ port: 25810, mode: 'dev-multi-instance' }),
])

export const AIONUI_WEB_PROBE_TIMEOUT_MS = 1_500

// WebUI는 /api/* 를 AionCore로 넘기므로 인증 상태 응답으로 AionUi WebUI인지 판정한다.
const AUTH_STATUS_PATH = '/api/auth/status'
const LOOPBACK_HOSTNAME = '127.0.0.1'
const MAX_RESPONSE_BYTES = 64 * 1024

/**
 * 연결 소켓이 완전히 닫힌 뒤에만 끝나는 단발 GET 요청.
 * 전역 fetch는 중단 뒤에도 소켓 정리가 비동기로 남아, 서버 종료와 겹치면 Windows에서
 * libuv 단언(UV_HANDLE_CLOSING)으로 프로세스가 비정상 종료된다. keep-alive도 쓰지 않는다.
 */
export function requestWithClosedSocket(target, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const transport = new URL(target).protocol === 'https:' ? https : http
    let failure = null
    let statusCode = 0
    const chunks = []
    let size = 0
    const request = transport.request(target, {
      method: 'GET',
      agent: false,
      signal,
      headers: { Accept: 'application/json' },
    })
    request.once('response', (response) => {
      statusCode = response.statusCode ?? 0
      response.on('data', (chunk) => {
        size += chunk.length
        if (size > MAX_RESPONSE_BYTES) request.destroy(new Error('AIONUI_WEB_PROBE_RESPONSE_TOO_LARGE'))
        else chunks.push(chunk)
      })
      response.on('error', (error) => { failure ??= error })
    })
    request.once('error', (error) => { failure ??= error })
    request.once('close', () => {
      if (failure || !statusCode) {
        reject(failure ?? new Error('AIONUI_WEB_PROBE_NO_RESPONSE'))
        return
      }
      const body = Buffer.concat(chunks).toString('utf8')
      resolve({
        ok: statusCode >= 200 && statusCode < 300,
        status: statusCode,
        json: async () => JSON.parse(body),
      })
    })
    request.end()
  })
}

function parseWebBaseUrl(baseUrl) {
  let url
  try {
    url = new URL(String(baseUrl ?? '').trim())
  } catch {
    throw new Error('AIONUI_WEB_URL_INVALID')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('AIONUI_WEB_URL_INVALID')
  url.pathname = '/'
  url.search = ''
  url.hash = ''
  url.username = ''
  url.password = ''
  return url
}

function effectivePort(url) {
  if (url.port) return Number(url.port)
  return url.protocol === 'https:' ? 443 : 80
}

function urlWithPort(url, port) {
  const next = new URL(url)
  next.port = String(port)
  return next.toString().replace(/\/+$/, '')
}

function knownPortMode(port) {
  return AIONUI_WEB_KNOWN_PORTS.find((item) => item.port === port)?.mode ?? null
}

function isLoopbackHostname(hostname) {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  return normalized === 'localhost' || normalized === '::1' || normalized.startsWith('127.')
}

export function replaceUrlPort(baseUrl, port) {
  return urlWithPort(parseWebBaseUrl(baseUrl), port)
}

export function aionUiWebProbeCandidates(baseUrl) {
  const url = parseWebBaseUrl(baseUrl)
  const configuredPort = effectivePort(url)
  const ports = [configuredPort, ...AIONUI_WEB_KNOWN_PORTS.map((item) => item.port).filter((port) => port !== configuredPort)]
  return ports.map((port) => ({
    port,
    mode: knownPortMode(port),
    configured: port === configuredPort,
    url: urlWithPort(url, port),
  }))
}

export function isAionUiAuthStatusPayload(value) {
  return Boolean(value)
    && typeof value === 'object'
    && typeof value.success === 'boolean'
    && typeof value.needs_setup === 'boolean'
    && typeof value.is_authenticated === 'boolean'
}

async function probeCandidate(candidate, { fetchImpl, timeoutMs, signal: outerSignal }) {
  const startedAt = Date.now()
  const timeout = AbortSignal.timeout(timeoutMs)
  const signal = outerSignal ? AbortSignal.any([outerSignal, timeout]) : timeout
  try {
    const response = await fetchImpl(`${candidate.url}${AUTH_STATUS_PATH}`, { signal })
    let payload = null
    try {
      payload = await response.json()
    } catch {
      payload = null
    }
    const reachable = response.ok && isAionUiAuthStatusPayload(payload)
    return { ...candidate, reachable, reason: reachable ? 'responded' : 'not-aionui', elapsedMs: Date.now() - startedAt }
  } catch {
    return {
      ...candidate,
      reachable: false,
      reason: outerSignal?.aborted ? 'aborted' : timeout.aborted ? 'timeout' : 'connection-failed',
      elapsedMs: Date.now() - startedAt,
    }
  }
}

function probeAll(candidates, options) {
  return Promise.all(candidates.map((candidate) => probeCandidate(candidate, options)))
}

/**
 * 'AI 대화 열기'가 쓰는 WebUI 주소의 설정 포트와 AionUi 기본 포트들을 동시에 확인한다.
 * checkLoopback은 MnP와 같은 PC의 AionUi(메인 머신)에만 쓴다. 공개 주소에서는 응답이 없는데
 * loopback에서만 응답하면 WebUI의 원격 접속 허용이 꺼진 상태다.
 * signal은 런타임 종료 신호다. 종료 중에 확인 요청이 남지 않도록 즉시 중단한다.
 */
export async function probeAionUiWebPorts(baseUrl, {
  fetchImpl = requestWithClosedSocket,
  timeoutMs = AIONUI_WEB_PROBE_TIMEOUT_MS,
  checkLoopback = false,
  signal,
} = {}) {
  const url = parseWebBaseUrl(baseUrl)
  const candidates = aionUiWebProbeCandidates(url)
  const ports = await probeAll(candidates, { fetchImpl, timeoutMs, signal })
  const configured = ports.find((item) => item.configured)
  const respondingPorts = ports.filter((item) => item.reachable).map((item) => item.port)

  let loopbackRespondingPorts = null
  if (checkLoopback && !signal?.aborted && respondingPorts.length === 0 && !isLoopbackHostname(url.hostname)) {
    const loopbackUrl = new URL(url)
    loopbackUrl.hostname = LOOPBACK_HOSTNAME
    const loopbackPorts = await probeAll(aionUiWebProbeCandidates(loopbackUrl), { fetchImpl, timeoutMs, signal })
    loopbackRespondingPorts = loopbackPorts.filter((item) => item.reachable).map((item) => item.port)
  }

  const status = configured.reachable
    ? 'ok'
    : respondingPorts.length > 0
      ? 'port-mismatch'
      : loopbackRespondingPorts?.length
        ? 'remote-access-disabled'
        : 'unreachable'

  return {
    status,
    configuredUrl: configured.url,
    configuredPort: configured.port,
    configuredReachable: configured.reachable,
    respondingPorts,
    loopbackRespondingPorts,
    ports,
  }
}
