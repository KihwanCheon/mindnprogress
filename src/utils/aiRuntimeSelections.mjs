export const AI_RUNTIME_SELECTIONS_VERSION = 2

const MAX_OPTION_ID_LENGTH = 512
const RESERVED_AGENT_IDS = new Set(['__proto__', 'constructor', 'prototype'])

function cleanId(value) {
  if (typeof value !== 'string') return ''
  const result = value.trim()
  return result && result.length <= MAX_OPTION_ID_LENGTH ? result : ''
}

function cleanAgentId(value) {
  const result = cleanId(value)
  return RESERVED_AGENT_IDS.has(result) ? '' : result
}

function normalizeSelection(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const modelId = cleanId(value.modelId)
  const mode = cleanId(value.mode)
  const thoughtLevel = cleanId(value.thoughtLevel)
  return {
    ...(modelId ? { modelId } : {}),
    ...(mode ? { mode } : {}),
    ...(thoughtLevel ? { thoughtLevel } : {}),
  }
}

export function normalizeAiRuntimeSelections(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const entries = source.selectionsByAgent && typeof source.selectionsByAgent === 'object' && !Array.isArray(source.selectionsByAgent)
    ? Object.entries(source.selectionsByAgent)
      .map(([agentId, selection]) => [cleanAgentId(agentId), normalizeSelection(selection)])
      .filter(([agentId]) => Boolean(agentId))
    : []
  const selectionsByAgent = Object.fromEntries(entries)
  const legacyAgentId = cleanAgentId(source.agentId)
  if (legacyAgentId && !selectionsByAgent[legacyAgentId]) {
    selectionsByAgent[legacyAgentId] = normalizeSelection(source)
  }
  return {
    version: AI_RUNTIME_SELECTIONS_VERSION,
    lastAgentId: cleanAgentId(source.lastAgentId) || legacyAgentId,
    selectionsByAgent,
  }
}

export function getAiRuntimeSelection(value, agentId) {
  const normalizedAgentId = cleanAgentId(agentId)
  if (!normalizedAgentId) return {}
  return normalizeAiRuntimeSelections(value).selectionsByAgent[normalizedAgentId] ?? {}
}

export function rememberAiRuntimeSelection(value, agentId, selection) {
  const current = normalizeAiRuntimeSelections(value)
  const normalizedAgentId = cleanAgentId(agentId)
  if (!normalizedAgentId) return current
  return {
    version: AI_RUNTIME_SELECTIONS_VERSION,
    lastAgentId: normalizedAgentId,
    selectionsByAgent: {
      ...current.selectionsByAgent,
      [normalizedAgentId]: normalizeSelection(selection),
    },
  }
}

export function availableAiRuntimeOptionId(options, preferredId, defaultId) {
  if (!Array.isArray(options)) return ''
  const normalizedPreferredId = cleanId(preferredId)
  const normalizedDefaultId = cleanId(defaultId)
  if (normalizedPreferredId && options.some((option) => cleanId(option?.id) === normalizedPreferredId)) return normalizedPreferredId
  if (normalizedDefaultId && options.some((option) => cleanId(option?.id) === normalizedDefaultId)) return normalizedDefaultId
  return cleanId(options[0]?.id)
}
