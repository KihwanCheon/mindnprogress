import assert from 'node:assert/strict'
import test from 'node:test'
import {
  availableAiRuntimeOptionId,
  getAiRuntimeSelection,
  normalizeAiRuntimeSelections,
  rememberAiRuntimeSelection,
} from '../src/utils/aiRuntimeSelections.mjs'

test('기존 공용 AI 선택값을 마지막 AI 종류의 개별 선택값으로 변환한다', () => {
  assert.deepEqual(normalizeAiRuntimeSelections({
    agentId: 'codex',
    modelId: 'gpt-5.6',
    mode: 'workspace-write',
    thoughtLevel: 'xhigh',
  }), {
    version: 2,
    lastAgentId: 'codex',
    selectionsByAgent: {
      codex: {
        modelId: 'gpt-5.6',
        mode: 'workspace-write',
        thoughtLevel: 'xhigh',
      },
    },
  })
})

test('AI 종류별 최근 모델과 권한 및 사고 수준을 독립적으로 유지한다', () => {
  const codexSelections = rememberAiRuntimeSelection({}, 'codex', {
    modelId: 'gpt-5.6',
    mode: 'workspace-write',
    thoughtLevel: 'xhigh',
  })
  const allSelections = rememberAiRuntimeSelection(codexSelections, 'claude', {
    modelId: 'claude-opus-4-6',
    mode: 'accept-edits',
    thoughtLevel: 'high',
  })

  assert.equal(allSelections.lastAgentId, 'claude')
  assert.deepEqual(getAiRuntimeSelection(allSelections, 'codex'), {
    modelId: 'gpt-5.6',
    mode: 'workspace-write',
    thoughtLevel: 'xhigh',
  })
  assert.deepEqual(getAiRuntimeSelection(allSelections, 'claude'), {
    modelId: 'claude-opus-4-6',
    mode: 'accept-edits',
    thoughtLevel: 'high',
  })
})

test('저장된 옵션을 사용할 수 없으면 AI 종류의 기본값과 첫 옵션 순서로 대체한다', () => {
  const options = [{ id: 'medium' }, { id: 'high' }]
  assert.equal(availableAiRuntimeOptionId(options, 'xhigh', 'high'), 'high')
  assert.equal(availableAiRuntimeOptionId(options, 'xhigh', 'ultra'), 'medium')
  assert.equal(availableAiRuntimeOptionId([], 'xhigh', 'high'), '')
})

test('손상된 저장값과 유효하지 않은 AI 종류 식별자를 안전하게 제외한다', () => {
  assert.deepEqual(normalizeAiRuntimeSelections({
    lastAgentId: '__proto__',
    selectionsByAgent: {
      codex: { modelId: ' gpt-5.6 ', thoughtLevel: 3 },
      constructor: { modelId: 'invalid' },
    },
  }), {
    version: 2,
    lastAgentId: '',
    selectionsByAgent: {
      codex: { modelId: 'gpt-5.6' },
    },
  })
})
