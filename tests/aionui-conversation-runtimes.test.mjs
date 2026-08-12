import assert from 'node:assert/strict'
import test from 'node:test'
import {
  inactiveAiConversationRuntime,
  parseAionUiActiveConversationRuntimeSnapshot,
  unavailableAiConversationRuntime,
} from '../server/lib/aionUiConversationRuntimes.mjs'

test('AionUi 활성 런타임 스냅샷을 대화 ID별 상태로 정규화한다', () => {
  const snapshot = parseAionUiActiveConversationRuntimeSnapshot({
    schema_version: 1,
    generated_at: Date.parse('2026-08-12T01:02:03.000Z'),
    items: [{
      conversation_id: 'conversation-running',
      runtime: {
        state: 'waiting_confirmation',
        has_task: true,
        task_status: 'running',
        is_processing: true,
        pending_confirmations: 2,
        turn_id: 'turn-1',
      },
    }],
  })

  assert.equal(snapshot.observedAt, '2026-08-12T01:02:03.000Z')
  assert.deepEqual(snapshot.runtimes.get('conversation-running'), {
    conversationId: 'conversation-running',
    state: 'waiting-confirmation',
    isProcessing: true,
    pendingConfirmations: 2,
    turnId: 'turn-1',
    observedAt: '2026-08-12T01:02:03.000Z',
  })
})

test('정상 스냅샷에 없는 대화와 조회 실패 상태를 구분한다', () => {
  const observedAt = '2026-08-12T01:02:03.000Z'

  assert.equal(inactiveAiConversationRuntime('conversation-idle', observedAt).state, 'idle')
  assert.equal(unavailableAiConversationRuntime('conversation-unknown', observedAt).state, 'unknown')
})

test('호환되지 않거나 중복된 활성 런타임 스냅샷을 거부한다', () => {
  assert.throws(
    () => parseAionUiActiveConversationRuntimeSnapshot({ schema_version: 2, items: [] }),
    /AIONUI_RUNTIME_SNAPSHOT_INVALID/,
  )
  assert.throws(
    () => parseAionUiActiveConversationRuntimeSnapshot({
      schema_version: 1,
      items: [
        { conversation_id: 'duplicate', runtime: {} },
        { conversation_id: 'duplicate', runtime: {} },
      ],
    }),
    /AIONUI_RUNTIME_SNAPSHOT_INVALID/,
  )
})
