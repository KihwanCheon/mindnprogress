import assert from 'node:assert/strict'
import test from 'node:test'
import {
  collectLocalAddresses,
  localLoopbackRedirectLocation,
} from '../server/lib/localLoopbackRedirect.mjs'

const addresses = new Set(['127.0.0.1', '::1', '10.77.15.110'])

function navigationRequest({
  host = '10.77.15.110:4175',
  remoteAddress = '10.77.15.110',
  url = '/mindmap/map-a/node-b?tab=mindmap',
  method = 'GET',
  headers = {},
} = {}) {
  return {
    method,
    url,
    headers: {
      host,
      accept: 'text/html,application/xhtml+xml',
      'sec-fetch-mode': 'navigate',
      ...headers,
    },
    socket: { remoteAddress },
  }
}

test('로컬 PC가 LAN 주소로 연 화면은 같은 경로의 127.0.0.1 주소로 보낸다', () => {
  const location = localLoopbackRedirectLocation(navigationRequest(), { addresses })
  assert.equal(location, 'http://127.0.0.1:4175/mindmap/map-a/node-b?tab=mindmap')
})

test('다른 PC에서 LAN 주소로 접근하면 공유 주소를 유지한다', () => {
  const location = localLoopbackRedirectLocation(navigationRequest({ remoteAddress: '10.77.15.205' }), { addresses })
  assert.equal(location, null)
})

test('이미 loopback 주소로 접근한 요청은 다시 보내지 않는다', () => {
  const location = localLoopbackRedirectLocation(navigationRequest({
    host: '127.0.0.1:4175',
    remoteAddress: '127.0.0.1',
  }), { addresses })
  assert.equal(location, null)
})

test('API와 정적 자산 요청은 리다이렉트하지 않는다', () => {
  const apiLocation = localLoopbackRedirectLocation(navigationRequest({
    url: '/api/auth/me',
    headers: { accept: 'application/json', 'sec-fetch-mode': 'cors' },
  }), { addresses })
  const assetLocation = localLoopbackRedirectLocation(navigationRequest({
    url: '/src/main.tsx',
    headers: { accept: '*/*', 'sec-fetch-mode': 'cors' },
  }), { addresses })
  assert.equal(apiLocation, null)
  assert.equal(assetLocation, null)
})

test('프록시를 거친 요청과 상태 변경 요청은 리다이렉트하지 않는다', () => {
  const proxiedLocation = localLoopbackRedirectLocation(navigationRequest({
    headers: { 'x-forwarded-for': '10.77.15.205' },
  }), { addresses })
  const postLocation = localLoopbackRedirectLocation(navigationRequest({ method: 'POST' }), { addresses })
  assert.equal(proxiedLocation, null)
  assert.equal(postLocation, null)
})

test('네트워크 인터페이스 주소를 IPv4 매핑 형식과 함께 정규화한다', () => {
  const result = collectLocalAddresses({
    Ethernet: [{ address: '10.77.15.110' }],
    Loopback: [{ address: '::ffff:127.0.0.1' }],
  })
  assert.deepEqual([...result].sort(), ['10.77.15.110', '127.0.0.1', '::1'].sort())
})
