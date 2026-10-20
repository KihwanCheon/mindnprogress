const storagePrefix = 'mindnprogress-ai-delegation-runtime:'
const optionalFields = ['modelId', 'mode', 'thoughtLevel']

export function normalizeAiDelegationRuntime(value) {
  const clean = field => typeof value?.[field] === 'string' && value[field].trim().length <= 512 ? value[field].trim() : ''
  const agentId = clean('agentId')
  return { agentId, ...Object.fromEntries(optionalFields.map(field => [field, agentId ? clean(field) : ''])) }
}

function storageKey(userId, machineId) {
  return userId && machineId ? `${storagePrefix}${encodeURIComponent(userId)}:${encodeURIComponent(machineId)}` : null
}

export function readAiDelegationRuntime(userId, machineId, storage) {
  const key = storageKey(userId, machineId)
  if (!key) return null
  try {
    const saved = JSON.parse((storage ?? globalThis.localStorage).getItem(key) ?? 'null')
    if (saved?.version !== 1) return null
    const selection = normalizeAiDelegationRuntime(saved.selection)
    return selection.agentId ? selection : null
  } catch {
    return null
  }
}

export function saveAiDelegationRuntime(userId, machineId, value, storage) {
  const key = storageKey(userId, machineId)
  const selection = normalizeAiDelegationRuntime(value)
  // 미지정 초기값이나 선택 해제로 마지막에 지정한 설정을 지우지 않는다.
  if (!key || !selection.agentId) return false
  try {
    (storage ?? globalThis.localStorage).setItem(key, JSON.stringify({ version: 1, selection }))
    return true
  } catch {
    // 저장이 불가능해도 현재 팝업의 선택과 대화 시작은 유지한다.
    return false
  }
}

export function resolveAiDelegationRuntime(value, agents) {
  const saved = normalizeAiDelegationRuntime(value)
  const agent = agents.find(item => item.id === saved.agentId)
  if (!agent) return { selection: normalizeAiDelegationRuntime(null), unavailableFields: saved.agentId ? ['AI 종류'] : [] }
  const selection = { ...saved }
  const unavailableFields = []
  for (const [field, list, label] of [['modelId', 'models', '모델'], ['mode', 'modes', '권한'], ['thoughtLevel', 'thoughtLevels', '사고 수준']]) {
    if (saved[field] && !agent[list].some(item => item.id === saved[field])) {
      selection[field] = ''
      unavailableFields.push(label)
    }
  }
  return { selection, unavailableFields }
}
