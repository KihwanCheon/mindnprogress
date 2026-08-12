import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatAiConversationTitle,
  initialAiDelegationRuntime,
  isValidAiDelegationId,
} from '../server/lib/aiDelegations.mjs'

test('AI 위임으로 만든 새 대화 제목에 문서와 카드 제목을 함께 사용한다', () => {
  assert.equal(formatAiConversationTitle('JP-로그인', '더미 UI 준비'), 'JP-로그인: 더미 UI 준비')
  assert.equal(formatAiConversationTitle('문서\n제목', '카드   제목'), '문서 제목: 카드 제목')
  assert.equal(formatAiConversationTitle('문서', '카드'.repeat(60)).length, 120)
})

test('콜론을 포함한 위임 ID를 요청과 재시작 복원에서 사용할 수 있다', () => {
  assert.equal(isValidAiDelegationId('map-a:card-b:1258:p0-download-errors'), true)
  assert.equal(isValidAiDelegationId('map-a/card-b/1258'), false)
  assert.equal(isValidAiDelegationId('map-a card-b 1258'), false)
})

test('이미 끝난 AionCore operation은 상위 대화 재개 대기 상태로 복구한다', () => {
  assert.deepEqual(initialAiDelegationRuntime({
    state: 'completed',
    turnId: 'turn-child',
  }, '2026-08-11T09:00:00.000Z'), {
    state: 'waiting-parent',
    childStatus: 'completed',
    childTurnId: 'turn-child',
    childError: null,
    childCompletedAt: '2026-08-11T09:00:00.000Z',
  })
})

test('Unity 프로젝트 잠금 대기를 하위 작업 완료로 오인하지 않는다', () => {
  const runtime = initialAiDelegationRuntime({
    state: 'waiting_resource',
    turnId: 'turn-waiting',
    resource: {
      kind: 'unity_project',
      key: 'unity:abc123',
      projectRoot: 'C:/Git/Holdem/hdtf-client',
    },
  })
  assert.equal(runtime.state, 'waiting-resource')
  assert.equal(runtime.childTurnId, 'turn-waiting')
  assert.equal(runtime.resource.key, 'unity:abc123')
})

test('사용자가 중지한 하위 턴은 상위 대화 재개가 아닌 하위 재개 대기로 유지한다', () => {
  assert.deepEqual(initialAiDelegationRuntime({
    state: 'waiting_resume',
    turnId: 'turn-interrupted',
  }, '2026-08-13T09:00:00.000Z'), {
    state: 'waiting-child-resume',
    childStatus: 'interrupted',
    childTurnId: 'turn-interrupted',
    childError: null,
    childInterruptedAt: '2026-08-13T09:00:00.000Z',
  })
})
