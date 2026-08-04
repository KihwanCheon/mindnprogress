import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AI_WORKSPACE_MAX_LENGTH,
  normalizeAiWorkspaceHistory,
  rememberAiWorkspace,
  removeAiWorkspace,
} from '../src/utils/aiWorkspaceHistory.mjs'

test('작업공간 이력은 문자열 경로만 정리하고 중복과 최대 개수를 제한한다', () => {
  assert.deepEqual(normalizeAiWorkspaceHistory([
    ' C:\\Git\\MindNProgress ',
    '',
    null,
    'C:\\Git\\Other',
    'C:\\Git\\MindNProgress',
    'C:\\Git\\Third',
  ], 2), [
    'C:\\Git\\MindNProgress',
    'C:\\Git\\Other',
  ])
  assert.deepEqual(normalizeAiWorkspaceHistory({ invalid: true }), [])
  assert.deepEqual(normalizeAiWorkspaceHistory(['x'.repeat(AI_WORKSPACE_MAX_LENGTH + 1)]), [])
})

test('사용한 작업공간을 최근 순서 맨 앞으로 옮기고 원본 배열은 변경하지 않는다', () => {
  const history = ['C:\\Git\\First', 'C:\\Git\\Second', 'C:\\Git\\Third']
  const next = rememberAiWorkspace(history, ' C:\\Git\\Second ', 3)
  assert.deepEqual(next, ['C:\\Git\\Second', 'C:\\Git\\First', 'C:\\Git\\Third'])
  assert.deepEqual(history, ['C:\\Git\\First', 'C:\\Git\\Second', 'C:\\Git\\Third'])
})

test('빈 작업공간은 추가하지 않고 선택한 이력만 제거한다', () => {
  const history = ['C:\\Git\\First', 'C:\\Git\\Second']
  assert.deepEqual(rememberAiWorkspace(history, '   '), history)
  assert.deepEqual(removeAiWorkspace(history, 'C:\\Git\\First'), ['C:\\Git\\Second'])
  assert.deepEqual(removeAiWorkspace(history, 'C:\\Git\\Missing'), history)
})
