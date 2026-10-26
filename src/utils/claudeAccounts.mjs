// Claude 멀티 계정(AionUi fork) 화면용 순수 함수. 번호는 AionCore가 정한 공유 순서다.

const CIRCLED_DIGITS = 20

/** 원형 번호(①…⑳, 이후 #n). */
export function claudeAccountMark(number) {
  const value = Number(number)
  if (!Number.isInteger(value) || value < 1) return ''
  return value <= CIRCLED_DIGITS ? String.fromCodePoint(0x2460 + value - 1) : `#${value}`
}

/** 그룹 총괄 대화만 총괄 계정을 쓰고, 그 외 용도는 같은 기본 계정을 쓴다. */
export function claudeAccountRole(purpose) {
  return purpose === 'group-coordination' ? 'coordinator' : 'others'
}

export const CLAUDE_ACCOUNT_ROLE_LABELS = Object.freeze({
  coordinator: '그룹 총괄 대화',
  others: '문서·카드 대화와 AI 위임',
})

/**
 * 사용량 표시에 대표로 보여 줄 계정 항목(`{ value }`). 조회된 계정 중 5시간·주간
 * 사용률이 가장 높은 계정이고, 같으면 앞 번호다. 조회된 계정이 없으면 첫 항목이다.
 */
export function mostUsedClaudeUsageEntry(entries) {
  let picked = null
  let pickedUsage = -1
  for (const entry of entries ?? []) {
    const value = entry?.value
    if (value?.state !== 'ready') continue
    const usage = Math.max(
      ...[value.session?.usedPercent, value.weekly?.usedPercent].filter((percent) => Number.isFinite(percent)),
      0,
    )
    if (usage > pickedUsage) {
      picked = entry
      pickedUsage = usage
    }
  }
  return picked ?? entries?.[0] ?? null
}

/**
 * 창에 표시할 계정. 사용자가 고른 계정, 용도 정책 계정, 1번 계정 순으로 정한다.
 * 계정이 2개 미만이면 빈 문자열이라 요청에 계정을 넣지 않는다.
 */
export function resolveDialogClaudeAccountId(accounts, chosenId, policyId) {
  if (!Array.isArray(accounts) || accounts.length < 2) return ''
  const valid = (id) => Boolean(id) && accounts.some((account) => account.id === id)
  if (valid(chosenId)) return chosenId
  if (valid(policyId)) return policyId
  return accounts[0].id
}
