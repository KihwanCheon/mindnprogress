import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import {
  AIONUI_WEB_KNOWN_PORTS,
  aionUiWebProbeCandidates,
  isAionUiAuthStatusPayload,
  probeAionUiWebPorts,
  replaceUrlPort,
  requestWithClosedSocket,
} from '../server/lib/aionUiWebPortProbe.mjs'

const authStatus = { success: true, needs_setup: false, user_count: 1, is_authenticated: false }

function fakeFetch(responders) {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    const { host } = new URL(url)
    const responder = responders[host]
    if (!responder) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
    return responder(url)
  }
  return { fetchImpl, calls }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

test('AionUi WebUI 기본 포트는 dev·release·dev 다중 실행 순서다', () => {
  assert.deepEqual(AIONUI_WEB_KNOWN_PORTS.map((item) => [item.port, item.mode]), [
    [7777, 'dev'], [25808, 'release'], [25810, 'dev-multi-instance'],
  ])
})

test('후보 포트는 설정 포트를 먼저 두고 알려진 포트를 중복 없이 붙인다', () => {
  assert.deepEqual(aionUiWebProbeCandidates('http://10.0.0.5:25808').map((item) => [item.port, item.configured, item.mode]), [
    [25808, true, 'release'], [7777, false, 'dev'], [25810, false, 'dev-multi-instance'],
  ])
  assert.deepEqual(aionUiWebProbeCandidates('http://10.0.0.5:9000').map((item) => [item.port, item.configured, item.mode]), [
    [9000, true, null], [7777, false, 'dev'], [25808, false, 'release'], [25810, false, 'dev-multi-instance'],
  ])
  assert.equal(aionUiWebProbeCandidates('http://10.0.0.5:7777')[1].url, 'http://10.0.0.5:25808')
})

test('포트를 생략한 주소는 프로토콜 기본 포트를 설정 포트로 본다', () => {
  assert.equal(aionUiWebProbeCandidates('https://aion.example.com/')[0].port, 443)
  assert.equal(aionUiWebProbeCandidates('http://aion.example.com')[0].port, 80)
  assert.equal(aionUiWebProbeCandidates('http://[::1]:7777')[0].url, 'http://[::1]:7777')
})

test('올바르지 않은 주소는 후보를 만들지 않고 오류를 낸다', () => {
  assert.throws(() => aionUiWebProbeCandidates('not a url'), /AIONUI_WEB_URL_INVALID/)
  assert.throws(() => aionUiWebProbeCandidates('ftp://10.0.0.5:7777'), /AIONUI_WEB_URL_INVALID/)
})

test('replaceUrlPort는 호스트를 유지하고 포트만 바꾼다', () => {
  assert.equal(replaceUrlPort('http://10.0.0.5:7777', 25808), 'http://10.0.0.5:25808')
  assert.equal(replaceUrlPort('https://aion.example.com', 7777), 'https://aion.example.com:7777')
})

test('AionUi 인증 상태 응답 형식만 WebUI 응답으로 인정한다', () => {
  assert.equal(isAionUiAuthStatusPayload(authStatus), true)
  assert.equal(isAionUiAuthStatusPayload({ status: 'ok' }), false)
  assert.equal(isAionUiAuthStatusPayload({ success: true, needs_setup: 'no', is_authenticated: false }), false)
  assert.equal(isAionUiAuthStatusPayload(null), false)
})

test('설정 포트가 응답하면 ok', async () => {
  const { fetchImpl, calls } = fakeFetch({ '10.0.0.5:7777': () => jsonResponse(authStatus) })
  const result = await probeAionUiWebPorts('http://10.0.0.5:7777', { fetchImpl })
  assert.equal(result.status, 'ok')
  assert.equal(result.configuredUrl, 'http://10.0.0.5:7777')
  assert.equal(result.configuredPort, 7777)
  assert.equal(result.configuredReachable, true)
  assert.deepEqual(result.respondingPorts, [7777])
  assert.ok(calls.every((url) => url.endsWith('/api/auth/status')))
})

test('설정 포트가 아닌 포트만 응답하면 port-mismatch와 응답 포트를 알려 준다', async () => {
  const { fetchImpl } = fakeFetch({ '10.0.0.5:25808': () => jsonResponse(authStatus) })
  const result = await probeAionUiWebPorts('http://10.0.0.5:7777', { fetchImpl })
  assert.equal(result.status, 'port-mismatch')
  assert.equal(result.configuredReachable, false)
  assert.deepEqual(result.respondingPorts, [25808])
  assert.equal(result.ports.find((item) => item.port === 7777).reason, 'connection-failed')
  assert.equal(result.ports.find((item) => item.port === 25808).mode, 'release')
})

test('AionUi가 아닌 HTTP 응답은 응답 포트로 세지 않는다', async () => {
  const { fetchImpl } = fakeFetch({
    '10.0.0.5:7777': () => new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
    '10.0.0.5:25808': () => jsonResponse({ error: 'NOT_FOUND' }, 404),
  })
  const result = await probeAionUiWebPorts('http://10.0.0.5:7777', { fetchImpl })
  assert.equal(result.status, 'unreachable')
  assert.deepEqual(result.respondingPorts, [])
  assert.equal(result.ports.find((item) => item.port === 7777).reason, 'not-aionui')
  assert.equal(result.ports.find((item) => item.port === 25808).reason, 'not-aionui')
})

test('제한 시간을 넘긴 포트는 timeout으로 기록한다', async () => {
  const fetchImpl = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason))
  })
  const startedAt = Date.now()
  const result = await probeAionUiWebPorts('http://10.0.0.5:7777', { fetchImpl, timeoutMs: 50 })
  assert.ok(Date.now() - startedAt < 1_000, '후보 포트를 동시에 확인한다')
  assert.equal(result.status, 'unreachable')
  assert.ok(result.ports.every((item) => item.reason === 'timeout'))
})

test('외부 중단 신호가 오면 진행 중인 확인을 끝내고 loopback 확인도 하지 않는다', async () => {
  const controller = new AbortController()
  const calls = []
  const fetchImpl = (url, { signal }) => {
    calls.push(url)
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason))
    })
  }
  setTimeout(() => controller.abort(new Error('RUNTIME_STOPPING')), 20)
  const startedAt = Date.now()
  const result = await probeAionUiWebPorts('http://10.0.0.5:7777', {
    fetchImpl, timeoutMs: 10_000, checkLoopback: true, signal: controller.signal,
  })
  assert.ok(Date.now() - startedAt < 1_000, '제한 시간까지 기다리지 않는다')
  assert.ok(result.ports.every((item) => item.reason === 'aborted'))
  assert.equal(result.loopbackRespondingPorts, null)
  assert.ok(calls.every((url) => !url.includes('127.0.0.1')))
})

test('공개 주소에서는 응답이 없고 loopback에서만 응답하면 remote-access-disabled', async () => {
  const { fetchImpl } = fakeFetch({ '127.0.0.1:25808': () => jsonResponse(authStatus) })
  const result = await probeAionUiWebPorts('http://10.0.0.5:7777', { fetchImpl, checkLoopback: true })
  assert.equal(result.status, 'remote-access-disabled')
  assert.deepEqual(result.respondingPorts, [])
  assert.deepEqual(result.loopbackRespondingPorts, [25808])
})

test('loopback 확인은 요청한 경우에만, 공개 주소가 응답하지 않을 때만 수행한다', async () => {
  const notRequested = fakeFetch({ '127.0.0.1:7777': () => jsonResponse(authStatus) })
  const remote = await probeAionUiWebPorts('http://10.0.0.5:7777', { fetchImpl: notRequested.fetchImpl })
  assert.equal(remote.status, 'unreachable')
  assert.equal(remote.loopbackRespondingPorts, null)
  assert.ok(notRequested.calls.every((url) => !url.includes('127.0.0.1')))

  const reachable = fakeFetch({ '10.0.0.5:7777': () => jsonResponse(authStatus) })
  const ok = await probeAionUiWebPorts('http://10.0.0.5:7777', { fetchImpl: reachable.fetchImpl, checkLoopback: true })
  assert.equal(ok.status, 'ok')
  assert.ok(reachable.calls.every((url) => !url.includes('127.0.0.1')))
})

test('설정 주소가 이미 loopback이면 loopback을 다시 확인하지 않는다', async () => {
  const { fetchImpl, calls } = fakeFetch({})
  const result = await probeAionUiWebPorts('http://127.0.0.1:7777', { fetchImpl, checkLoopback: true })
  assert.equal(result.status, 'unreachable')
  assert.equal(calls.length, AIONUI_WEB_KNOWN_PORTS.length)
})

async function withServer(handler, run) {
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    return await run(`http://127.0.0.1:${server.address().port}`)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}

test('기본 요청 함수는 실제 WebUI 응답을 판정한다', async () => {
  await withServer((req, res) => {
    assert.equal(req.headers.connection, 'close', 'keep-alive 소켓을 남기지 않는다')
    res.writeHead(req.url === '/api/auth/status' ? 200 : 404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(authStatus))
  }, async (baseUrl) => {
    const response = await requestWithClosedSocket(`${baseUrl}/api/auth/status`)
    assert.equal(response.ok, true)
    assert.deepEqual(await response.json(), authStatus)
    const result = await probeAionUiWebPorts(baseUrl)
    assert.equal(result.status, 'ok')
  })
})

test('기본 요청 함수는 중단 신호와 큰 응답을 실패로 끝낸다', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.write('{"success":')
  }, async (baseUrl) => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 30)
    await assert.rejects(requestWithClosedSocket(`${baseUrl}/api/auth/status`, { signal: controller.signal }))
  })
  await withServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end('x'.repeat(70 * 1024))
  }, async (baseUrl) => {
    await assert.rejects(requestWithClosedSocket(`${baseUrl}/api/auth/status`), /AIONUI_WEB_PROBE_RESPONSE_TOO_LARGE/)
  })
})

test('응답 본문을 읽지 못해도 예외를 밖으로 던지지 않는다', async () => {
  const { fetchImpl } = fakeFetch({
    '10.0.0.5:7777': () => new Response('{broken', { status: 200, headers: { 'Content-Type': 'application/json' } }),
  })
  const result = await probeAionUiWebPorts('http://10.0.0.5:7777', { fetchImpl })
  assert.equal(result.ports.find((item) => item.port === 7777).reason, 'not-aionui')
})
