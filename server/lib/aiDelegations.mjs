import { createHash } from 'node:crypto'

export const AI_DELEGATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_:-]{0,127}$/

export const ACTIVE_AI_DELEGATION_STATES = new Set([
  'waiting-workspace',
  'starting',
  'waiting-resource',
  'running',
  'resuming',
  'waiting-child-resume',
  'recovery-required',
  'waiting-integration',
  'integration-starting',
  'integration-waiting-resource',
  'integration-running',
  'integration-waiting-resume',
  'integration-recovery-required',
  'waiting-parent',
  'waking-parent',
])

function normalizedSelectionOption(value, fallbackId = '') {
  if (value && typeof value === 'object') {
    const id = String(value.id ?? '').trim()
    return id ? { id, label: String(value.label ?? id).trim() || id } : null
  }
  const id = String(fallbackId || value || '').trim()
  return id ? { id, label: id } : null
}

function normalizedSelectionList(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value?.id ?? value ?? '').trim()).filter(Boolean))].slice(0, 128)
}

function partialAiDelegationSelectionFromSource(source) {
  if (!source || typeof source !== 'object') return null
  const agent = normalizedSelectionOption(source.agent, source.agentId)
  const model = normalizedSelectionOption(source.model, source.modelId)
  return {
    agent,
    model,
    providerId: String(source.providerId ?? '').trim() || null,
    mode: normalizedSelectionOption(source.mode, source.modeId),
    thoughtLevel: normalizedSelectionOption(source.thoughtLevel, source.thoughtLevelId),
    enabledSkillIds: normalizedSelectionList(source.enabledSkillIds ?? source.skills),
    disabledBuiltinSkillIds: normalizedSelectionList(source.disabledBuiltinSkillIds),
    mcpIds: normalizedSelectionList(source.mcpIds ?? source.mcpServers),
    workspace: String(source.workspace ?? '').trim().slice(0, 4_096) || null,
  }
}

export function aiDelegationSelectionFromSource(source) {
  const selection = partialAiDelegationSelectionFromSource(source)
  return selection?.agent && selection?.model ? selection : null
}

function sourceDefinesAny(source, keys) {
  return source && typeof source === 'object' && keys.some((key) => Object.hasOwn(source, key))
}

export function mergeAiDelegationSelections(...sources) {
  const entries = sources
    .map((source) => ({ source, selection: partialAiDelegationSelectionFromSource(source) }))
    .filter((entry) => entry.selection)
  if (entries.length === 0) return null

  const agent = entries.find((entry) => entry.selection.agent)?.selection.agent ?? null
  const compatibleEntries = agent
    ? [
        ...entries.filter((entry) => !entry.selection.agent || entry.selection.agent.id === agent.id),
        ...entries.filter((entry) => entry.selection.agent && entry.selection.agent.id !== agent.id),
      ]
    : entries
  const firstValue = (key, candidates = compatibleEntries) =>
    candidates.find((entry) => entry.selection[key])?.selection[key] ?? null
  const firstList = (keys, key) => compatibleEntries
    .find((entry) => sourceDefinesAny(entry.source, keys))?.selection[key]
    ?? compatibleEntries[0].selection[key]
  const merged = {
    agent,
    model: firstValue('model'),
    providerId: firstValue('providerId'),
    mode: firstValue('mode'),
    thoughtLevel: firstValue('thoughtLevel'),
    enabledSkillIds: firstList(['enabledSkillIds', 'skills'], 'enabledSkillIds'),
    disabledBuiltinSkillIds: firstList(['disabledBuiltinSkillIds'], 'disabledBuiltinSkillIds'),
    mcpIds: firstList(['mcpIds', 'mcpServers'], 'mcpIds'),
    workspace: firstValue('workspace', entries),
  }
  return merged.agent && merged.model ? merged : null
}

export function isValidAiDelegationId(value) {
  return AI_DELEGATION_ID_PATTERN.test(String(value ?? ''))
}

function normalizedRequestList(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value ?? '').trim())
    .filter(Boolean))].sort()
}

export function createAiDelegationRequestSignature({
  mapId,
  parentCardId,
  targetCardId,
  strategy,
  conversationId,
  instruction,
  decisionReason,
  sourceRevision,
  newConversation,
}) {
  const requested = newConversation && typeof newConversation === 'object'
    ? {
        agentId: String(newConversation.agentId ?? '').trim() || null,
        modelId: String(newConversation.modelId ?? '').trim() || null,
        providerId: String(newConversation.providerId ?? '').trim() || null,
        modeId: String(newConversation.modeId ?? '').trim() || null,
        thoughtLevelId: String(newConversation.thoughtLevelId ?? '').trim() || null,
        enabledSkillIds: normalizedRequestList(newConversation.enabledSkillIds),
        disabledBuiltinSkillIds: normalizedRequestList(newConversation.disabledBuiltinSkillIds),
        mcpIds: normalizedRequestList(newConversation.mcpIds),
        workspace: String(newConversation.workspace ?? '').trim() || null,
      }
    : null
  return createHash('sha256').update(JSON.stringify({
    mapId,
    parentCardId,
    targetCardId,
    strategy,
    conversationId,
    instruction,
    decisionReason,
    sourceRevision,
    newConversation: strategy === 'new' ? requested : null,
  })).digest('hex')
}

function normalizedWorkspaceRoot(value) {
  return String(value ?? '').trim().replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
}

export function aiDelegationWorkspaceLeaseMatches(expected, actual) {
  if (!expected && !actual) return true
  if (!expected || !actual) return false
  return String(expected.workspaceId ?? '') === String(actual.workspaceId ?? '')
    && String(expected.jobId ?? '') === String(actual.jobId ?? '')
    && String(expected.leaseId ?? '') === String(actual.leaseId ?? '')
    && normalizedWorkspaceRoot(expected.projectRoot) === normalizedWorkspaceRoot(actual.projectRoot)
}

export function failedAiIntegrationRecoveryRuntime(dispatch, recoveredAt = new Date().toISOString()) {
  if (String(dispatch?.state ?? '').trim() !== 'failed') return null
  return {
    state: 'integration-recovery-required',
    integrationStatus: 'failed',
    integrationTurnId: String(dispatch?.turnId ?? '').trim() || null,
    integrationError: String(dispatch?.errorMessage ?? '').trim()
      || '필수 체크포인트 또는 통합 작업이 실패해 명시적인 재개가 필요합니다.',
    recoveryRequiredAt: recoveredAt,
    integrationResource: null,
  }
}

export function aiDelegationSucceeded(delegation) {
  if (delegation?.childStatus !== 'completed' || delegation?.workspaceError) return false
  if (delegation?.integrationOperationId && delegation?.integrationStatus !== 'completed') return false
  if (delegation?.workspaceLease?.leaseId && delegation?.workspaceResult?.status !== 'completed') return false
  return true
}

export function aiDelegationStateAfterParentWake(delegation, parentDispatchState) {
  if (parentDispatchState !== 'completed') return 'parent-wake-failed'
  return aiDelegationSucceeded(delegation) ? 'completed' : 'failed'
}

export function activeAiDelegationsForConversation(delegations, {
  mapId,
  targetCardId,
  targetConversationId,
  excludeId = null,
} = {}) {
  return [...delegations]
    .filter((delegation) => delegation?.id !== excludeId
      && delegation?.mapId === mapId
      && delegation?.targetCardId === targetCardId
      && delegation?.targetConversationId === targetConversationId
      && ACTIVE_AI_DELEGATION_STATES.has(delegation?.state))
    .sort((first, second) => String(second.createdAt ?? '').localeCompare(String(first.createdAt ?? '')))
}

export function formatAiConversationTitle(documentTitle, cardTitle) {
  return `${documentTitle}: ${cardTitle}`.replace(/\s+/g, ' ').trim().slice(0, 120)
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
  if (state === 'waiting_resume') {
    return {
      state: 'waiting-child-resume',
      childStatus: 'interrupted',
      childTurnId,
      childError: String(dispatch?.errorMessage ?? '').trim() || null,
      childInterruptedAt: completedAt,
    }
  }
  if (state === 'recovery_required') {
    return {
      state: 'recovery-required',
      childStatus: 'interrupted-by-restart',
      childTurnId,
      childError: String(dispatch?.errorMessage ?? '').trim() || 'interrupted_by_restart',
      recoveryRequiredAt: completedAt,
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
