export const AI_DELEGATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_:-]{0,127}$/

export function isValidAiDelegationId(value) {
  return AI_DELEGATION_ID_PATTERN.test(String(value ?? ''))
}

export function initialAiDelegationRuntime(dispatch, completedAt = new Date().toISOString()) {
  const state = String(dispatch?.state ?? '').trim()
  const childTurnId = String(dispatch?.turnId ?? '').trim() || null
  const resource = dispatch?.resource && typeof dispatch.resource === 'object'
    ? dispatch.resource
    : null
  if (state === 'completed' || state === 'failed') {
    return {
      state: 'waiting-parent',
      childStatus: state,
      childTurnId,
      childError: String(dispatch?.errorMessage ?? '').trim() || null,
      childCompletedAt: completedAt,
    }
  }
  if (state === 'waiting_resource') {
    return {
      state: 'waiting-resource',
      childTurnId,
      resource,
    }
  }
  return {
    state: state === 'running' ? 'running' : 'starting',
    childTurnId,
    ...(resource ? { resource } : {}),
  }
}
