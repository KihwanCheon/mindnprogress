const activeRuntimeStates = new Set(['starting', 'running', 'cancelling', 'stopping'])
const finishedTaskStates = new Set(['', 'idle', 'finished', 'completed', 'cancelled', 'failed'])

function observedAtFromSnapshot(snapshot, fallbackObservedAt) {
  const generatedAt = Number(snapshot.generated_at)
  if (!Number.isFinite(generatedAt) || generatedAt <= 0) return fallbackObservedAt
  try {
    return new Date(generatedAt).toISOString()
  } catch {
    return fallbackObservedAt
  }
}

export function normalizeAionUiConversationRuntime(conversationId, runtime, observedAt) {
  const runtimeState = String(runtime.state ?? '').trim().toLowerCase().replaceAll('_', '-')
  const taskStatus = String(runtime.task_status ?? '').trim().toLowerCase().replaceAll('_', '-')
  const pendingConfirmations = Math.max(0, Math.trunc(Number(runtime.pending_confirmations) || 0))
  const turnId = typeof runtime.turn_id === 'string' && runtime.turn_id.trim() ? runtime.turn_id.trim() : null
  const isProcessing = runtime.is_processing === true
    || activeRuntimeStates.has(runtimeState)
    || Boolean(turnId)
    || runtime.has_task === true && !finishedTaskStates.has(taskStatus)

  return {
    conversationId,
    state: pendingConfirmations > 0 ? 'waiting-confirmation' : isProcessing ? 'running' : 'idle',
    isProcessing,
    pendingConfirmations,
    turnId,
    observedAt,
  }
}

export function parseAionUiActiveConversationRuntimeSnapshot(
  snapshot,
  fallbackObservedAt = new Date().toISOString(),
) {
  if (!snapshot || snapshot.schema_version !== 1 || !Array.isArray(snapshot.items)) {
    throw new Error('AIONUI_RUNTIME_SNAPSHOT_INVALID')
  }

  const observedAt = observedAtFromSnapshot(snapshot, fallbackObservedAt)
  const runtimes = new Map()
  for (const item of snapshot.items) {
    const conversationId = typeof item?.conversation_id === 'string' ? item.conversation_id.trim() : ''
    if (!conversationId || !item.runtime || typeof item.runtime !== 'object' || runtimes.has(conversationId)) {
      throw new Error('AIONUI_RUNTIME_SNAPSHOT_INVALID')
    }
    runtimes.set(conversationId, normalizeAionUiConversationRuntime(conversationId, item.runtime, observedAt))
  }
  return { observedAt, runtimes }
}

export function inactiveAiConversationRuntime(conversationId, observedAt) {
  return {
    conversationId,
    state: 'idle',
    isProcessing: false,
    pendingConfirmations: 0,
    turnId: null,
    observedAt,
  }
}

export function unavailableAiConversationRuntime(conversationId, observedAt) {
  return {
    ...inactiveAiConversationRuntime(conversationId, observedAt),
    state: 'unknown',
  }
}
