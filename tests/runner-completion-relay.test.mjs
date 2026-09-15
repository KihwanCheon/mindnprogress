import assert from 'node:assert/strict'
import test from 'node:test'
import { startCompletionRelay } from '../runner/lib/completionRelay.mjs'

test('Runner 완료 릴레이는 loopback에서 허용된 대화 완료 콜백만 전달한다', async () => {
  const calls = []
  const relay = await startCompletionRelay({
    forward: async (pathname, body) => { calls.push({ pathname, body }) },
  })
  const pathname = `/api/integrations/aionui/launches/${'a'.repeat(43)}/conversation`

  try {
    const delivered = await fetch(`${relay.baseUrl}${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: 'conversation_1' }),
    })
    assert.equal(delivered.status, 200)
    assert.deepEqual(calls, [{ pathname, body: { conversationId: 'conversation_1' } }])

    const rejected = await fetch(`${relay.baseUrl}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: 'conversation_1' }),
    })
    assert.equal(rejected.status, 404)
    assert.equal(calls.length, 1)
  } finally {
    await relay.close()
  }
})

test('Runner 완료 릴레이는 MnP 전달 실패를 성공으로 응답하지 않는다', async () => {
  const relay = await startCompletionRelay({
    forward: async () => { throw new Error('MAIN_UNREACHABLE') },
  })

  try {
    const response = await fetch(`${relay.baseUrl}/api/integrations/aionui/launches/${'b'.repeat(43)}/conversation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: 'conversation_2' }),
    })
    assert.equal(response.status, 502)
  } finally {
    await relay.close()
  }
})
