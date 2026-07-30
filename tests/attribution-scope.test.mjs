import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveScopedAttribution } from '../server/lib/attributionScope.mjs'

const NOW = 1_785_400_000_000

const attribution = (cardId, createdAt, overrides = {}) => ({
  authorName: 'Claude Code(Fable)',
  mapId: 'map-test',
  cardId,
  startedBy: 'user-editor',
  createdAt,
  expiresAt: NOW + 60_000,
  ...overrides,
})

test('mapId가 없으면 귀속하지 않는다', () => {
  const result = resolveScopedAttribution({ mapId: '', cardId: '' }, [attribution('a', 1)], new Map(), NOW)
  assert.equal(result.attribution, null)
  assert.equal(result.match, null)
})

test('카드에 발급된 귀속을 최우선으로 사용한다', () => {
  const exact = attribution('card-a', 1)
  const result = resolveScopedAttribution({ mapId: 'map-test', cardId: 'card-a' }, [attribution('card-b', 2), exact], new Map(), NOW)
  assert.equal(result.attribution, exact)
  assert.equal(result.match, 'card')
})

test('카드 귀속이 없으면 카드에 연결된 대화 귀속을 사용한다', () => {
  const conversation = { authorName: 'Codex CLI(GPT-5.6-Sol)', mapId: 'map-test', cardId: 'card-a' }
  const conversations = new Map([['map-test:card-a', conversation]])
  const result = resolveScopedAttribution({ mapId: 'map-test', cardId: 'card-a' }, [attribution('card-b', 1)], conversations, NOW)
  assert.equal(result.attribution, conversation)
  assert.equal(result.match, 'conversation')
})

test('카드 귀속이 없으면 같은 문서의 다른 카드 AI를 추측하지 않는다', () => {
  const older = attribution('card-x', 1)
  const newest = attribution('card-y', 2)
  const result = resolveScopedAttribution({ mapId: 'map-test', cardId: 'card-unrelated' }, [older, newest], new Map(), NOW)
  assert.equal(result.attribution, null)
  assert.equal(result.match, null)
})

test('카드 ID가 없으면 문서의 활성 AI를 추측하지 않는다', () => {
  const newest = attribution('card-y', 2)
  const result = resolveScopedAttribution({ mapId: 'map-test', cardId: '' }, [attribution('card-x', 1), newest], new Map(), NOW)
  assert.equal(result.attribution, null)
  assert.equal(result.match, null)
})

test('문서에 서로 다른 AI 귀속이 활성 상태면 문서 수준으로 추측하지 않는다', () => {
  const claude = attribution('card-x', 1)
  const codex = attribution('card-y', 2, { authorName: 'Codex CLI(GPT-5.6-Sol)' })
  const result = resolveScopedAttribution({ mapId: 'map-test', cardId: 'card-unrelated' }, [claude, codex], new Map(), NOW)
  assert.equal(result.attribution, null)
  assert.equal(result.match, null)
})

test('같은 모델이어도 서로 다른 편집자의 AI면 문서 수준으로 추측하지 않는다', () => {
  const firstEditor = attribution('card-x', 1)
  const secondEditor = attribution('card-y', 2, { startedBy: 'user-editor-2' })
  const result = resolveScopedAttribution({ mapId: 'map-test', cardId: 'card-unrelated' }, [firstEditor, secondEditor], new Map(), NOW)
  assert.equal(result.attribution, null)
  assert.equal(result.match, null)
})

test('편집자가 지정되면 다른 편집자의 카드 귀속을 사용하지 않는다', () => {
  const otherEditor = attribution('card-a', 1, { startedBy: 'user-editor-2' })
  const result = resolveScopedAttribution(
    { mapId: 'map-test', cardId: 'card-a', editorId: 'user-editor' },
    [otherEditor],
    new Map(),
    NOW,
  )
  assert.equal(result.attribution, null)
  assert.equal(result.match, null)
})

test('편집자가 지정되면 같은 편집자의 카드 귀속만 사용한다', () => {
  const sameEditor = attribution('card-a', 1)
  const otherEditor = attribution('card-a', 2, { startedBy: 'user-editor-2' })
  const result = resolveScopedAttribution(
    { mapId: 'map-test', cardId: 'card-a', editorId: 'user-editor' },
    [otherEditor, sameEditor],
    new Map(),
    NOW,
  )
  assert.equal(result.attribution, sameEditor)
  assert.equal(result.match, 'card')
})

test('편집자가 지정되면 다른 편집자 또는 편집자 미상의 대화 귀속을 사용하지 않는다', () => {
  for (const startedBy of ['user-editor-2', null]) {
    const conversation = { authorName: 'Codex CLI(GPT-5.6-Sol)', startedBy }
    const result = resolveScopedAttribution(
      { mapId: 'map-test', cardId: 'card-a', editorId: 'user-editor' },
      [],
      new Map([['map-test:card-a', conversation]]),
      NOW,
    )
    assert.equal(result.attribution, null)
    assert.equal(result.match, null)
  }
})

test('편집자가 지정되면 같은 편집자의 대화 귀속을 사용한다', () => {
  const conversation = { authorName: 'Codex CLI(GPT-5.6-Sol)', startedBy: 'user-editor' }
  const result = resolveScopedAttribution(
    { mapId: 'map-test', cardId: 'card-a', editorId: 'user-editor' },
    [],
    new Map([['map-test:card-a', conversation]]),
    NOW,
  )
  assert.equal(result.attribution, conversation)
  assert.equal(result.match, 'conversation')
})

test('만료되었거나 다른 문서의 귀속은 후보에서 제외한다', () => {
  const expired = attribution('card-a', 3, { expiresAt: NOW - 1 })
  const otherMap = attribution('card-a', 4, { mapId: 'map-other' })
  const result = resolveScopedAttribution({ mapId: 'map-test', cardId: 'card-a' }, [expired, otherMap], new Map(), NOW)
  assert.equal(result.attribution, null)
  assert.equal(result.match, null)
})
