import { randomUUID } from 'node:crypto'

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
          targetCardId: context.targetCardId, targetCardLabel: context.targetCardLabel,
          parentHomeMachineId: context.parentHomeMachineId, targetHomeMachineId: context.targetHomeMachineId,
          strategy: context.strategy, phase: context.dispatchStarted ? 'dispatch' : 'preflight',
          accepted: false, executionState: context.dispatchStarted && !context.definitelyRejected ? 'unknown' : 'not-started',
          automaticRetry: false, status, reasonCode, message: safeDelegationFailureMessage(message, context.instruction), createdAt: now, updatedAt: now,
        }
        const next = [...records, record]
        await writeJson(filePath, next)
        records = next
        const { requestSignature: _signature, ...publicRecord } = record
        return publicRecord
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
        const resolved = accepted && item.requestSignature && accepted.requestSignature === item.requestSignature
          && accepted.createdAt >= item.createdAt && accepted.mapId === item.mapId && accepted.parentCardId === item.parentCardId
          && (accepted.parentMapId ?? accepted.mapId) === item.parentMapId
          && accepted.targetCardId === item.targetCardId && accepted.targetHomeMachineId === item.targetHomeMachineId
        const { requestSignature: _signature, ...publicRecord } = item
        return { ...publicRecord, resolvedByDelegationId: resolved ? accepted.id : null }
      }).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
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
