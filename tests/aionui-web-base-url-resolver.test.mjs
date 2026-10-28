import assert from 'node:assert/strict'
import test from 'node:test'
import { createAionUiWebBaseUrlResolver } from '../server/lib/aionUiWebBaseUrlResolver.mjs'

function probeResult(status, respondingPorts, configuredPort = 7777) {
  return { status, respondingPorts, configuredPort, configuredReachable: status === 'ok' }
}

function fakeClock(start = 1_000) {
  let current = start
  return { now: () => current, advance: (ms) => { current += ms } }
}

test('설정 포트가 응답하면 설정 주소를 그대로 쓴다', async () => {
  const resolver = createAionUiWebBaseUrlResolver({ probe: async () => probeResult('ok', [7777]) })
  assert.equal(await resolver.resolve('http://10.0.0.5:7777'), 'http://10.0.0.5:7777')
})

test('다른 포트만 응답하면 그 포트로 바꾼 주소를 쓴다', async () => {
  const resolver = createAionUiWebBaseUrlResolver({ probe: async () => probeResult('port-mismatch', [25808]) })
  assert.equal(await resolver.resolve('http://10.0.0.5:7777'), 'http://10.0.0.5:25808')
})

test('어느 포트도 응답하지 않거나 확인이 실패하면 설정 주소로 돌아간다', async () => {
  const unreachable = createAionUiWebBaseUrlResolver({ probe: async () => probeResult('unreachable', []) })
  assert.equal(await unreachable.resolve('http://10.0.0.5:7777'), 'http://10.0.0.5:7777')
  const remoteOff = createAionUiWebBaseUrlResolver({ probe: async () => probeResult('remote-access-disabled', []) })
  assert.equal(await remoteOff.resolve('http://10.0.0.5:7777'), 'http://10.0.0.5:7777')
  const failing = createAionUiWebBaseUrlResolver({ probe: async () => { throw new Error('boom') } })
  assert.equal(await failing.resolve('http://10.0.0.5:7777'), 'http://10.0.0.5:7777')
})

test('성공 결과는 30초, 실패 결과는 5초 동안 다시 확인하지 않는다', async () => {
  const clock = fakeClock()
  let calls = 0
  let result = probeResult('port-mismatch', [25808])
  const resolver = createAionUiWebBaseUrlResolver({ probe: async () => { calls += 1; return result }, now: clock.now })
  await resolver.resolve('http://10.0.0.5:7777')
  clock.advance(29_000)
  assert.equal(await resolver.resolve('http://10.0.0.5:7777'), 'http://10.0.0.5:25808')
  assert.equal(calls, 1)
  clock.advance(2_000)
  result = probeResult('unreachable', [])
  assert.equal(await resolver.resolve('http://10.0.0.5:7777'), 'http://10.0.0.5:7777')
  assert.equal(calls, 2)
  clock.advance(4_000)
  await resolver.resolve('http://10.0.0.5:7777')
  assert.equal(calls, 2)
  clock.advance(2_000)
  await resolver.resolve('http://10.0.0.5:7777')
  assert.equal(calls, 3)
})

test('주소마다 따로 캐시하고, 같은 주소의 동시 요청은 한 번만 확인한다', async () => {
  let calls = 0
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const resolver = createAionUiWebBaseUrlResolver({
    probe: async (baseUrl) => { calls += 1; await gate; return probeResult('port-mismatch', [baseUrl.includes('10.0.0.6') ? 7777 : 25808], baseUrl.includes('10.0.0.6') ? 25808 : 7777) },
  })
  const first = resolver.resolve('http://10.0.0.5:7777')
  const second = resolver.resolve('http://10.0.0.5:7777')
  const other = resolver.resolve('http://10.0.0.6:25808')
  release()
  assert.deepEqual(await Promise.all([first, second, other]), ['http://10.0.0.5:25808', 'http://10.0.0.5:25808', 'http://10.0.0.6:7777'])
  assert.equal(calls, 2)
})

test('peek은 확인하지 않고 캐시된 주소나 설정 주소를 돌려준다', async () => {
  let calls = 0
  const resolver = createAionUiWebBaseUrlResolver({ probe: async () => { calls += 1; return probeResult('port-mismatch', [25808]) } })
  assert.equal(resolver.peek('http://10.0.0.5:7777'), 'http://10.0.0.5:7777')
  assert.equal(calls, 0)
  await resolver.resolve('http://10.0.0.5:7777')
  assert.equal(resolver.peek('http://10.0.0.5:7777'), 'http://10.0.0.5:25808')
})

test('연결 확인 결과를 remember로 넣으면 다음 해석에 바로 쓴다', async () => {
  let calls = 0
  const resolver = createAionUiWebBaseUrlResolver({ probe: async () => { calls += 1; return probeResult('ok', [7777]) } })
  resolver.remember('http://10.0.0.5:7777', probeResult('port-mismatch', [25808]))
  assert.equal(await resolver.resolve('http://10.0.0.5:7777'), 'http://10.0.0.5:25808')
  assert.equal(calls, 0)
})

test('확인 중 종료 신호가 오면 결과를 캐시하지 않고 설정 주소를 쓴다', async () => {
  const controller = new AbortController()
  let calls = 0
  const resolver = createAionUiWebBaseUrlResolver({
    probe: async (_baseUrl, { signal }) => { calls += 1; controller.abort(); assert.equal(signal, controller.signal); return probeResult('unreachable', []) },
  })
  assert.equal(await resolver.resolve('http://10.0.0.5:7777', { signal: controller.signal }), 'http://10.0.0.5:7777')
  await resolver.resolve('http://10.0.0.5:7777')
  assert.equal(calls, 2)
})
