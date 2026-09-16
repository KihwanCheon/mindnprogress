import assert from 'node:assert/strict'
import test from 'node:test'
import { selectPublicIpv4 } from '../server/lib/publicNetwork.mjs'

const candidates = [
  { name: 'vEthernet (WSL)', address: '172.20.0.1' },
  { name: 'Ethernet 2', address: '10.0.0.20' },
  { name: 'Ethernet', address: '10.0.0.10' },
]

test('지정한 인터페이스는 정확한 이름을 부분 일치보다 먼저 사용한다', () => {
  assert.equal(selectPublicIpv4(candidates, 'ethernet'), '10.0.0.10')
})

test('인터페이스 이름은 대소문자 없이 일부 문자열로도 찾는다', () => {
  assert.equal(selectPublicIpv4(candidates, 'NET 2'), '10.0.0.20')
})

test('지정한 인터페이스가 없으면 경고하고 가상 인터페이스보다 물리 인터페이스를 우선한다', () => {
  const warnings = []
  assert.equal(selectPublicIpv4(candidates, 'Wi-Fi', (message) => warnings.push(message)), '10.0.0.20')
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /MNP_PUBLIC_INTERFACE=Wi-Fi/)
})

test('사용할 IPv4 후보가 없으면 loopback으로 대체한다', () => {
  assert.equal(selectPublicIpv4([], ''), '127.0.0.1')
})
