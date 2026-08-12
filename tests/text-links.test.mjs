import assert from 'node:assert/strict'
import test from 'node:test'
import { extractTextLinks } from '../src/utils/textLinks.mjs'

test('URL 뒤에 붙은 닫는 괄호와 한국어 조사를 링크에서 제외한다', () => {
  const url = 'http://10.77.15.110:4175/mindmap/map-mruc2ea9-f1aa05/node-mrvdg2gp-966307'
  const text = `관련 업무(${url})의 내용을 확인한다.`

  assert.deepEqual(extractTextLinks(text), [{
    href: url,
    label: url,
    start: '관련 업무('.length,
    end: '관련 업무('.length + url.length,
  }])
  assert.equal(text.slice(extractTextLinks(text)[0].end), ')의 내용을 확인한다.')
})

test('URL 바로 뒤에 붙은 한국어 조사와 문장부호를 제외한다', () => {
  const url = 'https://example.com/tasks/42'
  assert.deepEqual(
    extractTextLinks(`${url}에서 확인하고 ${url}도 참고한다.`).map(({ href, label }) => ({ href, label })),
    [{ href: url, label: url }, { href: url, label: url }],
  )
})

test('URL 내부의 균형 잡힌 괄호와 한국어 경로는 유지한다', () => {
  const parenthesizedUrl = 'https://example.com/wiki/Function_(mathematics)'
  const koreanUrl = 'https://example.com/wiki/서울의'
  const links = extractTextLinks(`${parenthesizedUrl} ${koreanUrl}`)

  assert.equal(links[0].label, parenthesizedUrl)
  assert.equal(links[1].label, koreanUrl)
  assert.equal(links[1].href, 'https://example.com/wiki/%EC%84%9C%EC%9A%B8%EC%9D%98')
})
