import assert from 'node:assert/strict'
import test from 'node:test'
import { isSameWebLinkUrl, normalizedWebLinkUrl, parseWebLinkUrl } from '../src/utils/webLinks.mjs'

test('http와 https URL을 웹 링크 카드 정보로 정규화한다', () => {
  assert.deepEqual(parseWebLinkUrl('  https://WWW.Example.com/docs/%ED%95%9C%EA%B8%80#part  '), {
    url: 'https://www.example.com/docs/%ED%95%9C%EA%B8%80#part',
    hostname: 'www.example.com',
    displayHostname: 'example.com',
    title: '한글',
    path: '/docs/%ED%95%9C%EA%B8%80#part',
  })
  assert.equal(normalizedWebLinkUrl('http://example.com'), 'http://example.com/')
})

test('실행하거나 노출해서는 안 되는 URL은 거부한다', () => {
  for (const value of [
    'javascript:alert(1)',
    'file:///C:/secret.txt',
    'https://user:password@example.com/private',
    'https://example.com/a b',
    `https://example.com/${'a'.repeat(2_100)}`,
    'https://example.com\nhttps://other.example.com',
  ]) assert.equal(parseWebLinkUrl(value), null)
})

test('동일한 웹 URL은 표기 차이를 정규화해 중복으로 판정한다', () => {
  assert.equal(isSameWebLinkUrl('https://EXAMPLE.com:443/docs', 'https://example.com/docs'), true)
  assert.equal(isSameWebLinkUrl('https://example.com/docs#one', 'https://example.com/docs#two'), false)
})
