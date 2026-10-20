import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeAiDelegationRuntime,
  readAiDelegationRuntime,
  resolveAiDelegationRuntime,
  saveAiDelegationRuntime,
} from '../src/utils/aiDelegationRuntimeSelection.mjs'

const empty = { agentId: '', modelId: '', mode: '', thoughtLevel: '' }
const selection = { agentId: 'claude', modelId: 'opus', mode: 'accept-edits', thoughtLevel: 'high' }
const agents = [{ id: 'claude', models: [{ id: 'opus' }, { id: 'sonnet' }], defaultModelId: 'sonnet',
  modes: [{ id: 'accept-edits' }], defaultMode: 'accept-edits', thoughtLevels: [{ id: 'high' }], defaultThoughtLevel: 'high' }]

function memoryStorage() {
  const values = new Map()
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
}

test('마지막 위임 선택값 네 항목을 현재 대화 설정과 분리하여 저장한다', () => {
  const storage = memoryStorage()
  storage.setItem('mindnprogress-ai-runtime-selections', 'current-conversation-settings')
  assert.equal(readAiDelegationRuntime('user', 'main', storage), null)
  assert.equal(saveAiDelegationRuntime('user', 'main', selection, storage), true)
  assert.deepEqual(readAiDelegationRuntime('user', 'main', storage), selection)
  assert.equal(storage.getItem('mindnprogress-ai-runtime-selections'), 'current-conversation-settings')
  assert.deepEqual(resolveAiDelegationRuntime(selection, agents), { selection, unavailableFields: [] })
})

test('계정·실행 머신별 마지막 선택값은 섞이지 않는다', () => {
  const storage = memoryStorage()
  saveAiDelegationRuntime('user', 'main', selection, storage)
  assert.equal(readAiDelegationRuntime('other', 'main', storage), null)
  assert.equal(readAiDelegationRuntime('user', 'sub', storage), null)
  const partial = { ...empty, agentId: 'claude' }
  saveAiDelegationRuntime('user', 'sub', partial, storage)
  assert.deepEqual(readAiDelegationRuntime('user', 'main', storage), selection)
  assert.deepEqual(readAiDelegationRuntime('user', 'sub', storage), partial)
  saveAiDelegationRuntime('user:main', 'sub', selection, storage)
  assert.equal(readAiDelegationRuntime('user', 'main:sub', storage), null, '구분자가 있는 식별자도 충돌하지 않는다')
  assert.equal(saveAiDelegationRuntime('', 'main', selection, storage), false)
  assert.equal(saveAiDelegationRuntime('user', '', selection, storage), false)
  assert.equal(readAiDelegationRuntime('user', '', storage), null)
})

test('선택하지 않은 항목은 저장·복원 시에도 기본값으로 채우지 않는다', () => {
  const storage = memoryStorage()
  const partial = { ...empty, agentId: 'claude', thoughtLevel: 'high' }
  saveAiDelegationRuntime('user', 'main', partial, storage)
  assert.deepEqual(resolveAiDelegationRuntime(readAiDelegationRuntime('user', 'main', storage), agents), { selection: partial, unavailableFields: [] })
})

test('초기화·전체 선택 해제는 마지막에 지정한 설정을 지우지 않는다', () => {
  const storage = memoryStorage()
  saveAiDelegationRuntime('user', 'main', selection, storage)
  assert.equal(saveAiDelegationRuntime('user', 'main', empty, storage), false)
  assert.equal(saveAiDelegationRuntime('user', 'main', null, storage), false)
  assert.deepEqual(readAiDelegationRuntime('user', 'main', storage), selection)
})

test('현재 없는 모델·권한·사고 수준만 미지정으로 복원하고 원본 저장값은 보존한다', () => {
  const storage = memoryStorage()
  saveAiDelegationRuntime('user', 'main', selection, storage)
  const available = [{ ...agents[0], models: [{ id: 'sonnet' }], thoughtLevels: [] }]
  assert.deepEqual(resolveAiDelegationRuntime(readAiDelegationRuntime('user', 'main', storage), available), {
    selection: { ...selection, modelId: '', thoughtLevel: '' }, unavailableFields: ['모델', '사고 수준'],
  })
  assert.deepEqual(resolveAiDelegationRuntime(selection, [{ ...agents[0], modes: [] }]), {
    selection: { ...selection, mode: '' }, unavailableFields: ['권한'],
  })
  assert.deepEqual(readAiDelegationRuntime('user', 'main', storage), selection)
})

test('저장된 AI 종류가 없어지면 다른 AI를 자동 선택하지 않는다', () => {
  assert.deepEqual(resolveAiDelegationRuntime(selection, []), { selection: empty, unavailableFields: ['AI 종류'] })
  assert.deepEqual(resolveAiDelegationRuntime(null, agents), { selection: empty, unavailableFields: [] })
})

test('손상된 저장값이나 알 수 없는 저장 형식은 무시한다', () => {
  const storage = memoryStorage()
  saveAiDelegationRuntime('user', 'main', selection, storage)
  const key = [...storage.values.keys()][0]
  for (const raw of ['{', 'null', '[]', '{}', JSON.stringify({ version: 2, selection }), JSON.stringify({ version: 1, selection: { modelId: 'opus' } })]) {
    storage.setItem(key, raw)
    assert.equal(readAiDelegationRuntime('user', 'main', storage), null)
  }
  for (const value of [null, undefined, false, [], 'claude', { agentId: 'x'.repeat(513) }]) {
    assert.deepEqual(normalizeAiDelegationRuntime(value), empty)
  }
  assert.deepEqual(normalizeAiDelegationRuntime({ agentId: ' claude ', modelId: 1, mode: 'x'.repeat(513), thoughtLevel: ' high ' }), {
    ...empty, agentId: 'claude', thoughtLevel: 'high',
  })
})

test('저장소 접근 제한·용량 초과는 읽기·저장 실패로 반환하고 예외를 전파하지 않는다', () => {
  const storage = { getItem() { throw new Error('SecurityError') }, setItem() { throw new Error('QuotaExceededError') } }
  assert.equal(readAiDelegationRuntime('user', 'main', storage), null)
  assert.equal(saveAiDelegationRuntime('user', 'main', selection, storage), false)
  assert.deepEqual(selection, { agentId: 'claude', modelId: 'opus', mode: 'accept-edits', thoughtLevel: 'high' })
})
