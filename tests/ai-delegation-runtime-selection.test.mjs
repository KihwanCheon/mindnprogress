import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AI_DELEGATION_NARRATIVE_MAX_LENGTH,
  normalizeAiDelegationPreferences,
  normalizeAiDelegationRuntime,
  readAiDelegationPreferences,
  resolveAiDelegationRuntime,
  saveAiDelegationPreferences,
} from '../src/utils/aiDelegationRuntimeSelection.mjs'

const empty = { agentId: '', modelId: '', mode: '', thoughtLevel: '' }
const selection = { agentId: 'claude', modelId: 'opus', mode: 'accept-edits', thoughtLevel: 'high' }
const defaults = { selection: empty, narrativeMode: false, narrativeText: '' }
const preferences = { selection, narrativeMode: true, narrativeText: '  구현은 Claude Code, 검수는 Codex를 사용하세요.\n권한은 작업별로 확인하세요.  ' }
const agents = [{ id: 'claude', models: [{ id: 'opus' }, { id: 'sonnet' }], defaultModelId: 'sonnet',
  modes: [{ id: 'accept-edits' }], defaultMode: 'accept-edits', thoughtLevels: [{ id: 'high' }], defaultThoughtLevel: 'high' }]

function memoryStorage() {
  const values = new Map()
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
}

test('선택형 네 항목·서술형 원문·체크 상태를 현재 대화 모델과 분리하여 저장한다', () => {
  const storage = memoryStorage()
  storage.setItem('mindnprogress-ai-runtime-selections', 'current-conversation-settings')
  assert.equal(readAiDelegationPreferences('user', 'main', storage), null)
  assert.equal(saveAiDelegationPreferences('user', 'main', preferences, storage), true)
  assert.deepEqual(readAiDelegationPreferences('user', 'main', storage), preferences)
  assert.equal(storage.getItem('mindnprogress-ai-runtime-selections'), 'current-conversation-settings')
  assert.deepEqual(resolveAiDelegationRuntime(selection, agents), { selection, unavailableFields: [] })
  saveAiDelegationPreferences('user', 'main', { ...preferences, narrativeMode: false }, storage)
  assert.deepEqual(readAiDelegationPreferences('user', 'main', storage), { ...preferences, narrativeMode: false })
})

test('기존 버전의 선택형 설정은 마이그레이션 쓰기 없이 읽고 새 설정 저장 시에만 갱신한다', () => {
  const storage = memoryStorage()
  const key = 'mindnprogress-ai-delegation-runtime:user:main'
  const oldValue = JSON.stringify({ version: 1, selection })
  storage.setItem(key, oldValue)
  const migrated = readAiDelegationPreferences('user', 'main', storage)
  assert.deepEqual(migrated, { ...defaults, selection })
  assert.equal(storage.getItem(key), oldValue)
  saveAiDelegationPreferences('user', 'main', { ...migrated, narrativeMode: true }, storage)
  assert.equal(JSON.parse(storage.getItem(key)).version, 2)
  assert.deepEqual(readAiDelegationPreferences('user', 'main', storage).selection, selection)
})

test('계정·실행 머신별 설정은 섞이지 않는다', () => {
  const storage = memoryStorage()
  saveAiDelegationPreferences('user', 'main', preferences, storage)
  assert.equal(readAiDelegationPreferences('other', 'main', storage), null)
  assert.equal(readAiDelegationPreferences('user', 'sub', storage), null)
  const partial = { ...defaults, selection: { ...empty, agentId: 'claude' } }
  saveAiDelegationPreferences('user', 'sub', partial, storage)
  assert.deepEqual(readAiDelegationPreferences('user', 'main', storage), preferences)
  assert.deepEqual(readAiDelegationPreferences('user', 'sub', storage), partial)
  saveAiDelegationPreferences('user:main', 'sub', preferences, storage)
  assert.equal(readAiDelegationPreferences('user', 'main:sub', storage), null)
  assert.equal(saveAiDelegationPreferences('', 'main', preferences, storage), false)
  assert.equal(saveAiDelegationPreferences('user', '', preferences, storage), false)
  assert.equal(readAiDelegationPreferences('user', '', storage), null)
})

test('선택하지 않은 항목은 기본값으로 채우지 않고 명시적인 선택 해제·본문 삭제도 저장한다', () => {
  const storage = memoryStorage()
  const partial = { ...empty, agentId: 'claude', thoughtLevel: 'high' }
  saveAiDelegationPreferences('user', 'main', { ...preferences, selection: partial }, storage)
  assert.deepEqual(resolveAiDelegationRuntime(readAiDelegationPreferences('user', 'main', storage).selection, agents), { selection: partial, unavailableFields: [] })
  saveAiDelegationPreferences('user', 'main', { ...preferences, selection: empty }, storage)
  assert.deepEqual(readAiDelegationPreferences('user', 'main', storage), { ...preferences, selection: empty })
  saveAiDelegationPreferences('user', 'main', { ...preferences, narrativeText: '' }, storage)
  assert.deepEqual(readAiDelegationPreferences('user', 'main', storage), { ...preferences, narrativeText: '' })
  saveAiDelegationPreferences('user', 'main', defaults, storage)
  assert.deepEqual(readAiDelegationPreferences('user', 'main', storage), defaults)
})

test('현재 없는 모델·권한·사고 수준만 미지정으로 표시하고 저장 원본은 보존한다', () => {
  const storage = memoryStorage()
  saveAiDelegationPreferences('user', 'main', preferences, storage)
  const available = [{ ...agents[0], models: [{ id: 'sonnet' }], thoughtLevels: [] }]
  assert.deepEqual(resolveAiDelegationRuntime(readAiDelegationPreferences('user', 'main', storage).selection, available), {
    selection: { ...selection, modelId: '', thoughtLevel: '' }, unavailableFields: ['모델', '사고 수준'],
  })
  assert.deepEqual(resolveAiDelegationRuntime(selection, [{ ...agents[0], modes: [] }]), {
    selection: { ...selection, mode: '' }, unavailableFields: ['권한'],
  })
  assert.deepEqual(readAiDelegationPreferences('user', 'main', storage), preferences)
})

test('저장된 AI 종류가 없어지면 다른 AI를 자동 선택하지 않는다', () => {
  assert.deepEqual(resolveAiDelegationRuntime(selection, []), { selection: empty, unavailableFields: ['AI 종류'] })
  assert.deepEqual(resolveAiDelegationRuntime(null, agents), { selection: empty, unavailableFields: [] })
})

test('손상된 저장 형식과 필드를 안전하게 처리하고 서술형 공백·줄바꿈은 보존한다', () => {
  const storage = memoryStorage()
  const key = 'mindnprogress-ai-delegation-runtime:user:main'
  for (const raw of ['{', 'null', '[]', '{}', JSON.stringify({ version: 3, selection })]) {
    storage.setItem(key, raw)
    assert.equal(readAiDelegationPreferences('user', 'main', storage), null)
  }
  for (const value of [null, undefined, false, [], 'claude']) assert.deepEqual(normalizeAiDelegationPreferences(value), defaults)
  assert.deepEqual(normalizeAiDelegationRuntime({ agentId: 'x'.repeat(513) }), empty)
  assert.deepEqual(normalizeAiDelegationRuntime({ agentId: ' claude ', modelId: 1, mode: 'x'.repeat(513), thoughtLevel: ' high ' }), { ...empty, agentId: 'claude', thoughtLevel: 'high' })
  assert.deepEqual(normalizeAiDelegationPreferences({ selection, narrativeMode: 'true', narrativeText: 123 }), { ...defaults, selection })
  const text = '가'.repeat(AI_DELEGATION_NARRATIVE_MAX_LENGTH)
  assert.equal(normalizeAiDelegationPreferences({ narrativeText: text }).narrativeText, text)
  assert.equal(normalizeAiDelegationPreferences({ narrativeText: text + '나' }).narrativeText, '')
  assert.deepEqual(normalizeAiDelegationPreferences(preferences), preferences)
})

test('저장소 접근 제한·용량 초과는 실패로 반환하고 예외를 전파하지 않는다', () => {
  const storage = { getItem() { throw new Error('SecurityError') }, setItem() { throw new Error('QuotaExceededError') } }
  assert.equal(readAiDelegationPreferences('user', 'main', storage), null)
  assert.equal(saveAiDelegationPreferences('user', 'main', preferences, storage), false)
  assert.deepEqual(preferences.selection, selection)
})
