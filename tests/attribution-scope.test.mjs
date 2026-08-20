import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveAttributionWithoutToken, resolveScopedAttribution } from '../server/lib/attributionScope.mjs'

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

test('토큰이 없어도 직접 밝힌 AI 종류와 모델을 연결 대화보다 우선한다', () => {
  const conversation = { authorName: 'Claude Code(Opus)', mapId: 'map-test', cardId: 'card-a' }
  const result = resolveAttributionWithoutToken(
    { mapId: 'map-test', cardId: 'card-a' },
    'Codex CLI(GPT-5.6-Sol)',
    [],
    new Map([['map-test:card-a', conversation]]),
    NOW,
  )
  assert.equal(result.authorName, 'Codex CLI(GPT-5.6-Sol)')
  assert.equal(result.attribution, null)
  assert.equal(result.match, 'self-declared')
})

test('토큰과 직접 식별 정보가 없으면 카드에 연결된 대화 귀속을 사용한다', () => {
  const conversation = { authorName: 'Codex CLI(GPT-5.6-Sol)', mapId: 'map-test', cardId: 'card-a' }
  const result = resolveAttributionWithoutToken(
    { mapId: 'map-test', cardId: 'card-a' },
    '',
    [],
    new Map([['map-test:card-a', conversation]]),
    NOW,
  )
  assert.equal(result.authorName, '')
  assert.equal(result.attribution, conversation)
  assert.equal(result.match, 'conversation')
})

test('토큰이 없는 요청도 다른 카드의 대화 귀속은 사용하지 않는다', () => {
  const conversation = { authorName: 'Codex CLI(GPT-5.6-Sol)', mapId: 'map-test', cardId: 'card-b' }
  const result = resolveAttributionWithoutToken(
    { mapId: 'map-test', cardId: 'card-a' },
    '',
    [],
    new Map([['map-test:card-b', conversation]]),
    NOW,
  )
  assert.equal(result.authorName, '')
  assert.equal(result.attribution, null)
  assert.equal(result.match, null)
})

const startedConversation = (overrides = {}) => ({
  authorName: 'Claude Code(Opus (1M context))',
  mapId: 'map-test',
  cardId: 'card-start',
  conversationId: 'conv-1',
  startedBy: 'user-editor',
  ...overrides,
})

test('대화가 시작된 카드 밖을 편집해도 conversationId로 귀속한다', () => {
  const conversation = startedConversation()
  const result = resolveScopedAttribution(
    { mapId: 'map-test', cardId: 'card-new', conversationId: 'conv-1' },
    [],
    new Map([['map-test:card-start', conversation]]),
    NOW,
  )
  assert.equal(result.attribution, conversation)
  assert.equal(result.match, 'conversation-id')
})

test('카드 ID가 없는 요청도 conversationId로 귀속한다', () => {
  const conversation = startedConversation()
  const result = resolveScopedAttribution(
    { mapId: 'map-test', cardId: '', conversationId: 'conv-1' },
    [],
    new Map([['map-test:card-start', conversation]]),
    NOW,
  )
  assert.equal(result.attribution, conversation)
  assert.equal(result.match, 'conversation-id')
})

test('문서 범위 밖 요청도 conversationId로 귀속한다', () => {
  const conversation = startedConversation()
  const result = resolveScopedAttribution(
    { mapId: '', cardId: '', conversationId: 'conv-1' },
    [],
    new Map([['map-test:card-start', conversation]]),
    NOW,
  )
  assert.equal(result.attribution, conversation)
  assert.equal(result.match, 'conversation-id')
})

test('conversationId가 다르면 대화 귀속을 사용하지 않는다', () => {
  const otherAiOnTargetCard = startedConversation({
    authorName: 'Claude Code(Opus)',
    cardId: 'card-new',
    conversationId: 'conv-target',
  })
  const result = resolveScopedAttribution(
    { mapId: 'map-test', cardId: 'card-new', conversationId: 'conv-other' },
    [attribution('card-new', 9)],
    new Map([
      ['map-test:card-start', startedConversation()],
      ['map-test:card-new', otherAiOnTargetCard],
    ]),
    NOW,
  )
  assert.equal(result.attribution, null)
  assert.equal(result.match, null)
})

test('conversationId 귀속을 그 카드에서 시작한 다른 AI 귀속보다 우선한다', () => {
  const caller = startedConversation()
  const otherAiOnTargetCard = startedConversation({
    authorName: 'Codex CLI(GPT-5.6-Sol)',
    cardId: 'card-new',
    conversationId: 'conv-2',
  })
  const result = resolveScopedAttribution(
    { mapId: 'map-test', cardId: 'card-new', conversationId: 'conv-1' },
    [attribution('card-new', 9)],
    new Map([['map-test:card-start', caller], ['map-test:card-new', otherAiOnTargetCard]]),
    NOW,
  )
  assert.equal(result.attribution, caller)
  assert.equal(result.match, 'conversation-id')
})

test('편집자가 지정되면 다른 편집자의 conversationId 귀속은 사용하지 않는다', () => {
  const result = resolveScopedAttribution(
    { mapId: 'map-test', cardId: 'card-new', conversationId: 'conv-1', editorId: 'user-editor' },
    [],
    new Map([['map-test:card-start', startedConversation({ startedBy: 'user-editor-2' })]]),
    NOW,
  )
  assert.equal(result.attribution, null)
  assert.equal(result.match, null)
})

test('작성자 이름이 없는 대화 귀속은 conversationId가 같아도 사용하지 않는다', () => {
  const result = resolveScopedAttribution(
    { mapId: 'map-test', cardId: 'card-new', conversationId: 'conv-1' },
    [],
    new Map([['map-test:card-start', startedConversation({ authorName: '' })]]),
    NOW,
  )
  assert.equal(result.attribution, null)
  assert.equal(result.match, null)
})

test('같은 대화로 발급된 카드 귀속 토큰은 conversationId로도 사용한다', () => {
  const sameConversationToken = attribution('card-start', 5, { conversationId: 'conv-1' })
  const result = resolveScopedAttribution(
    { mapId: 'map-other', cardId: 'card-new', conversationId: 'conv-1' },
    [sameConversationToken],
    new Map(),
    NOW,
  )
  assert.equal(result.attribution, sameConversationToken)
  assert.equal(result.match, 'conversation-id')
})

test('만료된 카드 귀속 토큰은 conversationId가 같아도 사용하지 않는다', () => {
  const expired = attribution('card-start', 5, { conversationId: 'conv-1', expiresAt: NOW - 1 })
  const result = resolveScopedAttribution(
    { mapId: 'map-test', cardId: 'card-new', conversationId: 'conv-1' },
    [expired],
    new Map(),
    NOW,
  )
  assert.equal(result.attribution, null)
  assert.equal(result.match, null)
})

test('토큰이 없어도 직접 밝힌 AI 종류와 모델을 conversationId 귀속보다 우선한다', () => {
  const result = resolveAttributionWithoutToken(
    { mapId: 'map-test', cardId: 'card-new', conversationId: 'conv-1' },
    'Codex CLI(GPT-5.6-Sol)',
    [],
    new Map([['map-test:card-start', startedConversation()]]),
    NOW,
  )
  assert.equal(result.authorName, 'Codex CLI(GPT-5.6-Sol)')
  assert.equal(result.attribution, null)
  assert.equal(result.match, 'self-declared')
})

test('토큰과 직접 식별 정보가 없으면 conversationId 귀속을 사용한다', () => {
  const conversation = startedConversation()
  const result = resolveAttributionWithoutToken(
    { mapId: 'map-test', cardId: 'card-new', conversationId: 'conv-1' },
    '',
    [],
    new Map([['map-test:card-start', conversation]]),
    NOW,
  )
  assert.equal(result.authorName, '')
  assert.equal(result.attribution, conversation)
  assert.equal(result.match, 'conversation-id')
})
