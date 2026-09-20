const terminalStates = new Set(['completed', 'failed', 'superseded', 'closed'])

function isVisibleDelegation(item) {
  return !terminalStates.has(item?.state)
    || item?.recovery?.recoveryAvailable === true
    || item?.recovery?.reportRetryAvailable === true
}

function usefulDetail(item) {
  return [
    item?.message,
    item?.recoveryDispatchError,
    item?.childError,
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
    if (!item?.id || !isVisibleDelegation(item)) continue
    const cardId = currentMapParentCardId(item, mapId)
    if (!cardId) continue
    const current = grouped.get(cardId) ?? new Map()
    current.set(item.id, item)
    grouped.set(cardId, current)
  }

  return Object.fromEntries([...grouped.entries()].map(([cardId, itemMap]) => {
    const items = [...itemMap.values()]
    const recovery = items.filter((item) => item.recovery?.recoveryAvailable === true)
    const report = items.filter((item) => item.recovery?.recoveryAvailable !== true
      && item.recovery?.reportRetryAvailable === true)
    const active = items.filter((item) => item.recovery?.recoveryAvailable !== true
      && item.recovery?.reportRetryAvailable !== true
      && !terminalStates.has(item.state))
    const kind = recovery.length > 0 ? 'recovery' : report.length > 0 ? 'report' : 'active'
    const prioritized = (kind === 'recovery' ? recovery : kind === 'report' ? report : active)
      .slice()
      .sort((left, right) => String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? '')))
    const title = [
      active.length ? `AI 위임 진행 ${active.length}건` : '',
      recovery.length ? `AI 작업 복구 필요 ${recovery.length}건` : '',
      report.length ? `AI 결과 전달 필요 ${report.length}건` : '',
      usefulDetail(prioritized[0]),
      '카드를 선택하면 세부 정보의 AI 위임 영역에서 확인할 수 있습니다.',
    ].filter(Boolean).join('\n')
    return [cardId, {
      kind,
      count: items.length,
      activeCount: active.length,
      recoveryCount: recovery.length,
      reportCount: report.length,
      title,
    }]
  }))
}
