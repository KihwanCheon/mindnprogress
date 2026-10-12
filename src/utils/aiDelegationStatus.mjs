const terminalStates = new Set(['completed', 'failed', 'superseded', 'closed'])
const resolvedStates = new Set(['completed', 'superseded', 'closed'])

export function aiDelegationRequiresRecovery(item) {
  return item?.recovery?.recoveryAvailable === true
    || (!resolvedStates.has(item?.state) && item?.workspaceResult?.status === 'quarantined')
}

export function isVisibleAiDelegation(item) {
  if (item?.kind === 'request-failure') return !item.resolvedByDelegationId
  return !terminalStates.has(item?.state)
    || aiDelegationRequiresRecovery(item)
    || item?.recovery?.reportRetryAvailable === true
    || (item?.state === 'completed' && item?.taskCompletion?.state === 'incomplete')
}

export function aiDelegationDisplayItems(delegations = [], requestFailures = []) {
  return [...delegations, ...requestFailures.filter(item => !item.resolvedByDelegationId)]
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
  for (const item of delegations ?? []) {
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
    const incompleteTasks = items.filter(item => item.state === 'completed' && item.taskCompletion?.state === 'incomplete'
      && !aiDelegationRequiresRecovery(item) && !item.recovery?.reportRetryAvailable)
    const recovery = items.filter(aiDelegationRequiresRecovery)
    const report = items.filter((item) => !aiDelegationRequiresRecovery(item)
      && item.recovery?.reportRetryAvailable === true)
    const active = items.filter((item) => !aiDelegationRequiresRecovery(item)
      && item.recovery?.reportRetryAvailable !== true
      && item.kind !== 'request-failure'
      && !terminalStates.has(item.state))
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
      incompleteTasks.length ? `AI 실행 종료 · 카드 업무 미완료 ${incompleteTasks.length}건` : '',
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
