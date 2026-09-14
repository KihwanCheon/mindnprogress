import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatAiConversationDisplay,
  normalizeAiConversationName,
  resolveConversationDisplay,
} from '../server/lib/aiConversationDisplay.mjs'

test('대화 제목은 사용자 표시용으로 한 줄 정규화하고 ID를 보조 정보로 붙인다', () => {
  assert.equal(normalizeAiConversationName('  변경한\n 대화   제목  '), '변경한 대화 제목')
  assert.deepEqual(formatAiConversationDisplay('conversation-1', ' 변경한 대화 제목 '), {
    conversationId: 'conversation-1',
    name: '변경한 대화 제목',
    displayLabel: '변경한 대화 제목 (conversation-1)',
    source: 'live',
  })
})

test('표시 시점의 AionUi 제목을 사용하고 조회 실패 시 ID로 내려간다', async () => {
  let name = '최초 제목'
  const readConversation = async (conversationId) => ({ id: conversationId, name })
  assert.equal((await resolveConversationDisplay('conversation-2', readConversation)).displayLabel, '최초 제목 (conversation-2)')

  name = '사용자가 변경한 제목'
  assert.equal((await resolveConversationDisplay('conversation-2', readConversation)).displayLabel, '사용자가 변경한 제목 (conversation-2)')

  assert.deepEqual(await resolveConversationDisplay('conversation-2', async () => { throw new Error('AionUi unavailable') }), {
    conversationId: 'conversation-2',
    name: '',
    displayLabel: 'conversation-2',
    source: 'id-only',
  })
  assert.equal((await resolveConversationDisplay('conversation-2', async () => ({ id: 'another', name: '잘못된 대화' }))).source, 'id-only')
})
