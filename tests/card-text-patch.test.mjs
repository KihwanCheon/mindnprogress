import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  applyCardTextPatch,
  cardTextIntegrity,
  textIntegrity,
} from '../mcp/cardTextPatch.mjs'

test('텍스트 무결성 정보는 문자열 길이와 UTF-8 SHA-256을 안정적으로 계산한다', () => {
  assert.deepEqual(textIntegrity('한글'), {
    length: 2,
    sha256: 'bd87f9bb68b67d2fa1cb82b6751820e946d5b1316d25d5fd96512fb4be44a2a8',
  })
  assert.deepEqual(cardTextIntegrity({ description: '설명' }), {
    description: textIntegrity('설명'),
    sharedKnowledge: textIntegrity(''),
  })
})

test('replace_once는 유일하게 일치하는 부분만 교체한다', () => {
  assert.equal(
    applyCardTextPatch('앞 기존 뒤', { type: 'replace_once', find: '기존', replace: '수정' }),
    '앞 수정 뒤',
  )
  assert.throws(
    () => applyCardTextPatch('반복 반복', { type: 'replace_once', find: '반복', replace: '수정' }),
    /TEXT_PATCH_MATCH_COUNT.*일치 2개/,
  )
  assert.throws(
    () => applyCardTextPatch('원문', { type: 'replace_once', find: '없음', replace: '수정' }),
    /TEXT_PATCH_MATCH_COUNT.*일치 0개/,
  )
})

test('replace_between은 두 경계 문자열을 보존하고 내부만 교체한다', () => {
  assert.equal(
    applyCardTextPatch('앞[시작]기존[끝]뒤', {
      type: 'replace_between',
      startMarker: '[시작]',
      endMarker: '[끝]',
      replacement: '교체',
    }),
    '앞[시작]교체[끝]뒤',
  )
  assert.throws(
    () => applyCardTextPatch('[끝]기존[시작]', {
      type: 'replace_between',
      startMarker: '[시작]',
      endMarker: '[끝]',
      replacement: '교체',
    }),
    /TEXT_PATCH_MARKER_ORDER/,
  )
})

test('append는 요청한 구분자만 추가한다', () => {
  assert.equal(applyCardTextPatch('기존', { type: 'append', text: '추가', separator: 'none' }), '기존추가')
  assert.equal(applyCardTextPatch('기존', { type: 'append', text: '추가', separator: 'newline' }), '기존\n추가')
  assert.equal(applyCardTextPatch('기존', { type: 'append', text: '추가', separator: 'blank-line' }), '기존\n\n추가')
  assert.equal(applyCardTextPatch('', { type: 'append', text: '추가', separator: 'blank-line' }), '추가')
})
