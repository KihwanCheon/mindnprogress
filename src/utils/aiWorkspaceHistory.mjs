export const AI_WORKSPACE_HISTORY_LIMIT = 10
export const AI_WORKSPACE_MAX_LENGTH = 1000

function normalizedLimit(value) {
  return Number.isInteger(value) && value > 0 ? value : AI_WORKSPACE_HISTORY_LIMIT
}

export function normalizeAiWorkspaceHistory(value, limit = AI_WORKSPACE_HISTORY_LIMIT) {
  if (!Array.isArray(value)) return []
  const result = []
  const seen = new Set()
  for (const candidate of value) {
    if (typeof candidate !== 'string') continue
    const workspace = candidate.trim()
    if (!workspace || workspace.length > AI_WORKSPACE_MAX_LENGTH || seen.has(workspace)) continue
    seen.add(workspace)
    result.push(workspace)
    if (result.length >= normalizedLimit(limit)) break
  }
  return result
}

export function rememberAiWorkspace(history, value, limit = AI_WORKSPACE_HISTORY_LIMIT) {
  const workspace = typeof value === 'string' ? value.trim() : ''
  if (!workspace) return normalizeAiWorkspaceHistory(history, limit)
  return normalizeAiWorkspaceHistory([
    workspace,
    ...normalizeAiWorkspaceHistory(history, limit).filter((candidate) => candidate !== workspace),
  ], limit)
}

export function removeAiWorkspace(history, value, limit = AI_WORKSPACE_HISTORY_LIMIT) {
  const workspace = typeof value === 'string' ? value.trim() : ''
  return normalizeAiWorkspaceHistory(history, limit).filter((candidate) => candidate !== workspace)
}
