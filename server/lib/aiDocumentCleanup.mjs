export function aiRecordReferencesMaps(record, mapIds) {
  return ['mapId', 'parentMapId', 'targetMapId'].some((key) => mapIds.has(record?.[key]))
}

// 삭제 완료 후 지연된 응답이 같은 문서의 AI 기록을 다시 삽입하지 못하게 한다.
export function createAiDocumentRecordMap(deletedMapIds) {
  return new class extends Map {
    set(key, record) {
      if (!aiRecordReferencesMaps(record, deletedMapIds)) super.set(key, record)
      return this
    }
  }()
}

export function removeAiDocumentRecords(mapIds, deletedMapIds, stores) {
  const ids = new Set(mapIds)
  for (const id of ids) deletedMapIds.add(id)
  for (const store of stores) {
    for (const [key, record] of store) {
      if (aiRecordReferencesMaps(record, ids)) store.delete(key)
    }
  }
}

const executingStates = new Set([
  'starting', 'waiting-resource', 'running', 'resuming', 'recovery-dispatch-pending',
  'integration-starting', 'integration-waiting-resource', 'integration-running',
])
const executingDispatchStates = new Set(['starting', 'waiting_resource', 'waiting-resource', 'running'])
const executingWakeStates = new Set([...executingDispatchStates, 'waiting_resume', 'waiting-resume'])

export function aiDocumentDeletionBusy(mapIds, { delegations, instructions, leases = [], delegationBusy, instructionBusy }) {
  const ids = new Set(mapIds)
  const relatedDelegations = [...delegations].filter((record) => aiRecordReferencesMaps(record, ids))
  if (relatedDelegations.some((record) => executingStates.has(record.state)
    || (record.state === 'waking-parent' && (record.parentDispatchState === 'intent-recorded'
      || executingWakeStates.has(record.parentDispatchState)))
    || executingWakeStates.has(record.recoveryWakeState)
    || executingWakeStates.has(record.integrationCleanWakeState)
    || ['queued', 'checking'].includes(record.integrationRecoveryRequest?.status)
    || record.pendingRecovery || record.resultCorrection?.phase === 'preparing'
    || delegationBusy?.(record.id))) return true
  if ([...instructions].some((record) => aiRecordReferencesMaps(record, ids)
    && (instructionBusy?.(record.id) || (record.state === 'delivered' && executingDispatchStates.has(record.dispatchState))))) return true
  const leaseIds = new Set(relatedDelegations.map((record) => record.workspaceLease?.leaseId).filter(Boolean))
  return leases.some((lease) => (aiRecordReferencesMaps(lease, ids) || leaseIds.has(lease.leaseId))
    && !['completed', 'cancelled', 'quarantined'].includes(lease.status))
}
