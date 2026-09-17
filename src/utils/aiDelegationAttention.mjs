function actionableKind(item) {
  if (item?.recovery?.recoveryAvailable) return 'recovery'
  if (item?.recovery?.reportRetryAvailable) return 'report'
  return null
}

function usefulDetail(item) {
  return [
    item?.message,
    item?.recoveryDispatchError,
    item?.childError,
    item?.parentError,
  ].find((value) => typeof value === 'string' && value.trim())?.trim() ?? ''
}

export function aiDelegationAttentionByCard(delegations, mapId) {
  const grouped = new Map()
  for (const item of delegations ?? []) {
    if (item?.mapId !== mapId || !item.targetCardId) continue
    const kind = actionableKind(item)
    if (!kind) continue
    const current = grouped.get(item.targetCardId) ?? { recovery: [], report: [] }
    current[kind].push(item)
    grouped.set(item.targetCardId, current)
  }

  return Object.fromEntries([...grouped.entries()].map(([cardId, items]) => {
    const kind = items.recovery.length > 0 ? 'recovery' : 'report'
    const primary = items[kind]
      .slice()
      .sort((left, right) => String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? '')))
    const count = primary.length
    const otherCount = kind === 'recovery' ? items.report.length : 0
    const label = kind === 'recovery' ? 'AI 복구 필요' : '결과 전달 필요'
    const summary = kind === 'recovery'
      ? `중단된 AI 작업 ${count}건을 재개할 수 있습니다.`
      : `완료된 AI 작업 결과 ${count}건을 다시 전달할 수 있습니다.`
    const detail = usefulDetail(primary[0])
    const title = [
      summary,
      otherCount > 0 ? `결과 전달 재시도 ${otherCount}건도 확인이 필요합니다.` : '',
      detail,
      '클릭하면 카드의 AI 작업 복구 영역으로 이동합니다.',
    ].filter(Boolean).join('\n')
    return [cardId, { kind, count, label, title }]
  }))
}
