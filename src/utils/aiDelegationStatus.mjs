import { integrationRecoveryPending } from './aiIntegrationRecovery.mjs'

const terminalStates = new Set(['completed', 'failed', 'superseded', 'closed'])
const resolvedStates = new Set(['completed', 'superseded', 'closed'])

export function aiDelegationRequiresRecovery(item) {
  if (integrationRecoveryPending(item)) return false
  return item?.recovery?.recoveryAvailable === true
    || (!resolvedStates.has(item?.state) && item?.workspaceResult?.status === 'quarantined')
}

export function isVisibleAiDelegation(item) {
  if (integrationRecoveryPending(item)) return true
  if (item?.kind === 'request-failure') return !item.resolvedByDelegationId
  if (item?.kind === 'task-attention') return item.taskCompletion?.state === 'incomplete'
  return !terminalStates.has(item?.state)
    || aiDelegationRequiresRecovery(item)
    || item?.recovery?.reportRetryAvailable === true
}

export function aiDelegationDisplayItems(delegations = [], requestFailures = []) {
  return [...delegations, ...requestFailures.filter(item => !item.resolvedByDelegationId)]
}

function targetScopeKey(item) {
  if (!item?.mapId || !item.parentCardId || !item.targetCardId) return null
  return JSON.stringify([item.parentMapId ?? item.mapId, item.parentCardId, item.mapId, item.targetCardId])
}

function newestExecutionFirst(left, right) {
  // Refreshing an old execution must not make it the latest assignment.
  return String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? ''))
    || String(right.id).localeCompare(String(left.id))
}

export function aiDelegationDisplaySections(items = []) {
  const records = [...new Map((items ?? []).filter(item => item?.id).map(item => [item.id, item])).values()]
  const currentItems = records.filter(isVisibleAiDelegation)
  const currentTargets = new Set(currentItems.filter(item => item.kind !== 'request-failure').map(targetScopeKey))
  const completedHistory = records.filter(item => item.state === 'completed' && !isVisibleAiDelegation(item))
    .sort(newestExecutionFirst)
  const historyByTarget = new Map()
  const latestByTarget = new Map()
  for (const item of records.filter(item => !item.kind).sort(newestExecutionFirst)) {
    const key = targetScopeKey(item)
    if (key && !latestByTarget.has(key)) latestByTarget.set(key, item)
  }
  for (const item of completedHistory) {
    const key = targetScopeKey(item)
    if (key) historyByTarget.set(key, (historyByTarget.get(key) ?? 0) + 1)
  }
  for (const [key, latest] of latestByTarget) {
    if (currentTargets.has(key) || latest.state !== 'completed' || latest.taskCompletion?.state !== 'incomplete') continue
    // This is a card-level presentation copy, never a new execution or stored state.
    currentItems.push({ ...latest, kind: 'task-attention', completedExecutionCount: historyByTarget.get(key) ?? 0 })
  }
  return { currentItems, completedHistory }
}

function usefulDetail(item) {
  return [
    item?.message,
    item?.recoveryDispatchError,
    item?.childError,
    item?.workspaceError,
    item?.workspaceResult?.error,
    item?.integrationError,
    item?.parentError,
  ].find((value) => typeof value === 'string' && value.trim())?.trim() ?? ''
}

function currentMapParentCardId(item, mapId) {
  if ((item?.parentMapId ?? item?.mapId) !== mapId) return null
  return item.parentCardId || null
}

export function aiDelegationStatusByCard(delegations, mapId) {
  const grouped = new Map()
  for (const item of aiDelegationDisplaySections(delegations).currentItems) {
    if (!item?.id || !isVisibleAiDelegation(item)) continue
    const cardId = currentMapParentCardId(item, mapId)
    if (!cardId) continue
    const current = grouped.get(cardId) ?? new Map()
    current.set(item.id, item)
    grouped.set(cardId, current)
  }

  return Object.fromEntries([...grouped.entries()].map(([cardId, itemMap]) => {
    const items = [...itemMap.values()]
    const requestFailures = items.filter(item => item.kind === 'request-failure')
    const incompleteTasks = items.filter(item => item.kind === 'task-attention')
    const recovery = items.filter(aiDelegationRequiresRecovery)
    const report = items.filter((item) => !aiDelegationRequiresRecovery(item)
      && item.recovery?.reportRetryAvailable === true)
    const active = items.filter((item) => !aiDelegationRequiresRecovery(item)
      && item.recovery?.reportRetryAvailable !== true
      && item.kind !== 'request-failure'
      && (!terminalStates.has(item.state) || integrationRecoveryPending(item)))
    const kind = recovery.length > 0 ? 'recovery' : report.length > 0 ? 'report'
      : requestFailures.length > 0 ? 'request-failed' : active.length > 0 ? 'active' : 'attention'
    const prioritized = (kind === 'recovery' ? recovery : kind === 'report' ? report
      : kind === 'request-failed' ? requestFailures : kind === 'attention' ? incompleteTasks : active)
      .slice()
      .sort((left, right) => String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? '')))
    const title = [
      active.length ? `AI 위임 진행 ${active.length}건` : '',
      recovery.length ? `AI 작업 복구 필요 ${recovery.length}건` : '',
      report.length ? `AI 결과 전달 필요 ${report.length}건` : '',
      requestFailures.length ? `AI 위임 접수 실패 ${requestFailures.length}건` : '',
      incompleteTasks.length ? `카드 업무 확인 필요 ${incompleteTasks.length}개 카드` : '',
      usefulDetail(prioritized[0]),
      '카드를 선택하면 세부 정보의 AI 위임 영역에서 확인할 수 있습니다.',
    ].filter(Boolean).join('\n')
    return [cardId, {
      kind,
      count: items.length,
      activeCount: active.length,
      recoveryCount: recovery.length,
      reportCount: report.length,
      requestFailureCount: requestFailures.length,
      incompleteTaskCount: incompleteTasks.length,
      title,
    }]
  }))
}
