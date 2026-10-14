const storageKey = item => `mindnprogress-integration-recovery:${item.mapId}:${item.id}`
const pendingRequests = new Map()
function storage() { try { return globalThis.sessionStorage } catch { return null } }
function read(item) {
  if (pendingRequests.has(storageKey(item))) return pendingRequests.get(storageKey(item))
  try { return JSON.parse(storage()?.getItem(storageKey(item)) ?? 'null') } catch { return null }
}
function clear(item) { pendingRequests.delete(storageKey(item)); try { storage()?.removeItem(storageKey(item)) } catch { /* 서버 기록으로도 확인한다. */ } }

export function integrationRecoveryUnconfirmed(item) { return Boolean(read(item)) }
export function integrationRecoveryPending(item) {
  return ['queued', 'checking'].includes(item?.integrationRecoveryRequest?.status)
}
export function reconcileIntegrationRecoveryRequests(items) {
  for (const item of items) if (read(item)?.recoveryRequestId === item.integrationRecoveryRequest?.requestId) clear(item)
}

// 시간 초과는 거절 증거가 아니다. 같은 요청을 다시 POST하지 않고 저장된 접수 기록만 조회한다.
export async function submitIntegrationRecovery(item, body, request) {
  const saved = read(item)
  const input = saved ?? { ...body, recoveryRequestId: globalThis.crypto?.randomUUID?.()
    ?? `recovery-${Date.now()}-${Math.random().toString(36).slice(2)}` }
  pendingRequests.set(storageKey(item), input)
  try { storage()?.setItem(storageKey(item), JSON.stringify(input)) } catch { /* 저장소 장애로 요청을 막지 않는다. */ }
  const parentMapId = item.parentMapId ?? item.mapId
  try {
    const result = await request(`/api/maps/${encodeURIComponent(parentMapId)}/ai-delegations/${encodeURIComponent(item.id)}/recover`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(65_000) })
    clear(item)
    return { ...result, message: result.delegation?.integrationRecoveryRequest?.message ?? '통합 재시도 요청을 접수했습니다. 검증·통합 상태를 확인하세요.' }
  } catch (error) {
    if (Number.isInteger(error?.status)) { clear(item); throw error }
    try {
      const result = await request(`/api/maps/${encodeURIComponent(parentMapId)}/ai-delegations`, { signal: AbortSignal.timeout(65_000) })
      const latest = result.delegations.find(candidate => candidate.id === item.id)
      if (latest?.integrationRecoveryRequest?.requestId === input.recoveryRequestId) {
        clear(item)
        return { delegation: latest, message: latest.integrationRecoveryRequest.message }
      }
    } catch { /* 조회도 불확실하면 새 실행 없이 접수 확인 대기로 남긴다. */ }
    return { unconfirmed: true, message: '응답을 받지 못해 접수 여부를 확인 중입니다. 통합 재시도를 반복하지 않았습니다. 상태 다시 확인을 눌러 주세요.' }
  }
}
