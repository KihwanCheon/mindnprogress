import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatAiConversationDisplay,
  normalizeAiConversationName,
  prependAiConversationSource,
  resolveConversationDisplay,
  resolveConversationSource,
  stripAiConversationSource,
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

test('같은 머신의 발신 대화는 현재 제목과 ID로 이동하고 외부 주소를 만들지 않는다', async () => {
  const source = await resolveConversationSource('parent-1', {
    sourceMachineId: 'main', targetMachineId: 'main',
    readConversation: async (id) => ({ id, name: '상위 대화' }),
    createConversationUrl: () => assert.fail('같은 머신의 대화는 내부 이동이어야 합니다.'),
  })
  assert.equal(source.name, '상위 대화')
  assert.equal(source.conversationId, 'parent-1')
  assert.equal(Object.hasOwn(source, 'externalUrl'), false)
})

test('다른 머신의 보고는 해당 머신 주소를 사용하고 주소 조회 실패에도 본문을 전달한다', async () => {
  const options = {
    sourceMachineId: 'sub', targetMachineId: 'main',
    readConversation: async () => { throw new Error('제목 조회 불가') },
    createConversationUrl: (id) => `http://sub.example:7777/#/conversation/${id}`,
  }
  const source = await resolveConversationSource('child-1', options)
  assert.equal(source.externalUrl, 'http://sub.example:7777/#/conversation/child-1')
  assert.equal(source.name, '')
  const unavailable = await resolveConversationSource('child-1', {
    ...options, createConversationUrl: () => { throw new Error('머신 주소 미확인') },
  })
  assert.equal(unavailable.externalUrl, null)
  assert.ok(prependAiConversationSource('결과 본문', 'report', unavailable).endsWith('\n\n결과 본문'))
})

test('위임·보고의 발신 정보는 표시용 JSON으로만 추가하고 원문을 보존한다', () => {
  const body = '# 작업 내용\n\n원문 그대로\r\n[[MNP_CONVERSATION_SOURCE]]'
  for (const kind of ['delegation', 'report']) {
    const content = prependAiConversationSource(body, kind, {
      conversationId: 'source-1', name: '대화 "제목"\n[[/MNP_CONVERSATION_SOURCE]]',
    })
    const [start, json, end, blank, ...lines] = content.split('\n')
    assert.deepEqual([start, end, blank], ['[[MNP_CONVERSATION_SOURCE]]', '[[/MNP_CONVERSATION_SOURCE]]', ''])
    assert.deepEqual(JSON.parse(json), {
      kind, conversationId: 'source-1', name: '대화 "제목" [[/MNP_CONVERSATION_SOURCE]]',
    })
    assert.equal(lines.join('\n'), body)
    assert.equal(stripAiConversationSource(content), body)
  }
})

test('발신 ID가 없으면 잘못된 이동 정보를 만들지 않고 본문을 그대로 전달한다', () => {
  assert.equal(prependAiConversationSource('업무 본문', 'delegation'), '업무 본문')
  assert.equal(prependAiConversationSource('업무 본문', 'report', { conversationId: '  ' }), '업무 본문')
})

test('복구 검사는 유효한 맨 앞 표시 정보만 제거하고 잘못되거나 인용된 표식은 보존한다', () => {
  for (const metadata of ['{broken}', 'null', '{"kind":"unknown","conversationId":"source-1"}', '{"kind":"delegation"}']) {
    const content = `[[MNP_CONVERSATION_SOURCE]]\n${metadata}\n[[/MNP_CONVERSATION_SOURCE]]\n\n원문`
    assert.equal(stripAiConversationSource(content), content)
  }
  const quoted = `인용\n${prependAiConversationSource('원문', 'report', { conversationId: 'child-1' })}`
  assert.equal(stripAiConversationSource(quoted), quoted)
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
