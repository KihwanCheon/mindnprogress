import { createHash, randomUUID } from 'node:crypto'

function sameRequestScope(failure, delegation) {
  return Boolean(delegation?.id && delegation.requestSignature
    && delegation.createdAt >= failure.createdAt
    && delegation.mapId === failure.mapId
    && (delegation.parentMapId ?? delegation.mapId) === failure.parentMapId
    && delegation.parentCardId === failure.parentCardId
    && delegation.targetCardId === failure.targetCardId
    && failure.targetHomeMachineId
    && delegation.targetHomeMachineId === failure.targetHomeMachineId)
}

function publicFailure(record, resolvedByDelegationId = record.resolution?.delegationId ?? null) {
  const { requestSignature: _signature, instructionHash: _instructionHash, ...publicRecord } = record
  return { ...publicRecord, resolvedByDelegationId }
}

function failureError(status, reasonCode, message) {
  return Object.assign(new Error(message), { status, reasonCode })
}

export function safeDelegationFailureMessage(message, instruction = '') {
  let text = String(message ?? '')
  if (instruction) text = text.replaceAll(instruction, '[지시 전문 생략]')
  return text.replace(/Bearer\s+[a-z0-9._~+/-]+/gi, 'Bearer [비공개]')
    .replace(/((?:access[_-]?token|api[_-]?key|authorization|secret|password)\s*[=:]\s*)[^\s,;]+/gi, '$1[비공개]').slice(0, 4000)
}

// Request failures are not executable delegations and never enter the delegation poller.
export async function createAiDelegationRequestFailures({ filePath, readJson, writeJson }) {
  let records = await readJson(filePath)
  let queue = Promise.resolve()
  return {
    record(context, { status, reasonCode, message }) {
      const action = async () => {
        const now = new Date().toISOString()
        const record = {
          id: context.requestId || `request-${randomUUID()}`, kind: 'request-failure', state: 'request-failed',
          requestedDelegationId: context.delegationId, requestSignature: context.requestSignature,
          mapId: context.mapId, parentMapId: context.parentMapId,
          parentCardId: context.parentCardId, parentCardLabel: context.parentCardLabel,
          parentConversationId: context.parentConversationId,
          targetCardId: context.targetCardId, targetCardLabel: context.targetCardLabel,
          parentHomeMachineId: context.parentHomeMachineId, targetHomeMachineId: context.targetHomeMachineId,
          strategy: context.strategy, phase: context.dispatchStarted ? 'dispatch' : 'preflight',
          accepted: false, executionState: context.dispatchStarted && !context.definitelyRejected ? 'unknown' : 'not-started',
          automaticRetry: false, status, reasonCode, message: safeDelegationFailureMessage(message, context.instruction), createdAt: now, updatedAt: now,
          instructionHash: context.instruction ? createHash('sha256').update(context.instruction).digest('hex') : null,
        }
        const next = [...records, record]
        await writeJson(filePath, next)
        records = next
        return publicFailure(record)
      }
      const result = queue.catch(() => {}).then(action)
      queue = result.catch(() => {})
      return result
    },
    list({ mapId, parentCardId, targetCardId, delegations }) {
      return records.filter(item => (item.parentMapId === mapId || item.mapId === mapId)
        && (!parentCardId || item.parentCardId === parentCardId)
        && (!targetCardId || item.targetCardId === targetCardId)).map(item => {
        const accepted = delegations.get(item.requestedDelegationId)
        const resolved = sameRequestScope(item, accepted) && item.requestSignature && accepted.requestSignature === item.requestSignature
        // Only a definitely unstarted version-conflict request can be matched across revisions.
        // Legacy records without the instruction hash require explicit confirmation instead.
        const retried = !resolved && !item.resolution && item.phase === 'preflight'
          && item.executionState === 'not-started' && item.reasonCode === 'AI_DELEGATION_VERSION_CONFLICT'
          && item.instructionHash && item.parentConversationId
          ? [...delegations.values()].filter(candidate => sameRequestScope(item, candidate)
            && candidate.instructionHash === item.instructionHash
            && candidate.parentConversationId === item.parentConversationId
            && candidate.strategy === item.strategy)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0] : null
        return publicFailure(item, item.resolution?.delegationId ?? (resolved ? accepted.id : retried?.id ?? null))
      }).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    },
    get(id) {
      const record = records.find(item => item.id === id)
      return record ? structuredClone(record) : null
    },
    resolve({ mapId, failureId, replacementDelegationId, expectedUpdatedAt, confirmSameWork, note, actorId }, delegations) {
      const action = async () => {
        const record = records.find(item => item.id === failureId && item.parentMapId === mapId)
        if (!record) throw failureError(404, 'AI_DELEGATION_REQUEST_FAILURE_NOT_FOUND', '접수 실패 기록을 찾을 수 없습니다.')
        if (record.resolution) {
          if (record.resolution.delegationId !== replacementDelegationId) throw failureError(409, 'AI_DELEGATION_REQUEST_FAILURE_ALREADY_RESOLVED', '다른 재접수 위임으로 이미 처리한 기록입니다.')
          return { requestFailure: publicFailure(record), repeated: true }
        }
        if (!expectedUpdatedAt || expectedUpdatedAt !== record.updatedAt) throw failureError(409, 'AI_DELEGATION_REQUEST_FAILURE_CHANGED', '접수 실패 기록이 변경됐습니다. 최신 상태를 다시 확인하세요.')
        if (confirmSameWork !== true || typeof note !== 'string' || note.trim().length < 3 || note.length > 1000
          || !actorId) throw failureError(400, 'AI_DELEGATION_REQUEST_FAILURE_CONFIRMATION_REQUIRED', '동일 업무의 재접수를 확인하고 3자 이상 1000자 이하의 감사 메모를 남겨 주세요.')
        if (record.phase !== 'preflight' || record.executionState !== 'not-started') throw failureError(409, 'AI_DELEGATION_REQUEST_FAILURE_EXECUTION_UNCERTAIN', '실행 여부가 불확실한 요청은 재접수 확인으로 해제할 수 없습니다.')
        const accepted = delegations.get(replacementDelegationId)
        if (!sameRequestScope(record, accepted)) throw failureError(409, 'AI_DELEGATION_REQUEST_FAILURE_REPLACEMENT_INVALID', '같은 문서·상위·대상 카드·머신에서 나중에 실제 접수된 위임을 선택해야 합니다.')
        const now = new Date().toISOString()
        const updated = { ...record, updatedAt: now, resolution: {
          delegationId: accepted.id, method: 'confirmed-retry', at: now, actorId, note: note.trim(),
        } }
        const next = records.map(item => item.id === record.id ? updated : item)
        await writeJson(filePath, next)
        records = next
        return { requestFailure: publicFailure(updated), repeated: false }
      }
      const result = queue.catch(() => {}).then(action)
      queue = result.catch(() => {})
      return result
    },
  }
}

export function withDelegationTaskCompletion(delegation, map) {
  const target = map?.nodes.find(node => node.id === delegation.targetCardId)
  if (delegation.state !== 'completed' || target?.data?.isWork !== true) return delegation
  const { status, progress } = target.data
  return { ...delegation, taskCompletion: {
    state: status === 'done' && progress === 100 ? 'completed' : 'incomplete', status, progress,
    message: status === 'done' && progress === 100
      ? 'AI 실행은 종료됐고 카드 업무는 완료 상태입니다. 품질과 기록의 검증을 대신하지 않습니다.'
      : 'AI 실행은 종료됐지만 카드 업무는 아직 미완료입니다. 결과와 카드 기록을 담당 AI가 확인해야 하며 자동 재실행하지 않습니다.',
  } }
}
