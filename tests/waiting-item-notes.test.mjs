import assert from 'node:assert/strict'
import test from 'node:test'
import { preserveOmittedWaitingItemNotes } from '../mcp/waitingItemNotes.mjs'

const stored = [
  { id: 'w1', label: '기획 회신', note: '임시 문구를 확정값으로 구현하지 않는다.', resumeCondition: '기획 회신', since: '2026-10-20T00:00:00.000Z' },
  { id: 'w2', label: '서버 배포', note: '회신을 기다리는 것만으로는 해소되지 않는다.', resumeCondition: 'API 배포', since: '2026-10-21T00:00:00.000Z' },
]

test('note 키 없이 다시 보낸 기존 대기 항목은 저장된 note를 보존한다', () => {
  // 생략형 응답(note 없음)으로 배열을 다시 만들어 한 항목만 남긴 경우
  const next = [{ id: 'w2', label: '서버 배포', resumeCondition: 'API 배포', since: '2026-10-21T00:00:00.000Z' }]
  assert.deepEqual(preserveOmittedWaitingItemNotes(stored, next), [stored[1]])
})

test('명시한 note는 빈 문자열을 포함해 그대로 적용하고 새 항목·다른 id에는 note를 붙이지 않는다', () => {
  const next = [
    { id: 'w1', label: '기획 회신', note: '' },
    { id: 'w2', label: '서버 배포', note: '새 메모' },
    { id: 'w3', label: '새 대기' },
    { label: 'id 없는 새 대기' },
  ]
  assert.deepEqual(preserveOmittedWaitingItemNotes(stored, next), next)
})

test('기존 항목이나 새 배열이 없으면 입력을 그대로 돌려준다', () => {
  assert.equal(preserveOmittedWaitingItemNotes(undefined, stored), stored)
  assert.equal(preserveOmittedWaitingItemNotes(stored, undefined), undefined)
  assert.deepEqual(preserveOmittedWaitingItemNotes(stored, []), [])
})
