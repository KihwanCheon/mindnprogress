import { createHash } from 'node:crypto'
import { aiDelegationReportResult, aiDelegationSucceeded } from './aiDelegations.mjs'
import { aiDelegationReportArchived, aiDelegationReportArchivePending } from './aiDelegationReportArchive.mjs'
import { aiDelegationDeliveredReportPatch } from './aiDelegationReports.mjs'
import { integrationRecoveryPending } from './aiIntegrationRecovery.mjs'
import { throwIfRuntimeStopping } from './runtimeStopping.mjs'

const reportStates = new Set(['waiting-parent', 'waking-parent'])
const errorCode = (value) => typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,100}$/.test(value) ? value : null

// 요청 본문·자격 증명·원문 오류/stack은 기록하지 않는다. 전송 계층의 구조화된 원인만 보존한다.
export function parentWakeFailureDiagnostic(error, { phase, machineId, method = 'GET', pathname = null, at }) {
  const causes = []
  let cause = error
  for (let index = 0; cause && index < 4; index++, cause = cause.cause) {
    const code = errorCode(cause.code)
    if (code && !causes.includes(code)) causes.push(code)
    for (const nested of Array.isArray(cause.errors) ? cause.errors.slice(0, 4) : []) {
      const nestedCode = errorCode(nested?.code)
      if (nestedCode && !causes.includes(nestedCode)) causes.push(nestedCode)
    }
  }
  const status = Number.isInteger(error?.status) ? error.status : null
  const code = errorCode(error?.code) ?? errorCode(error?.reasonCode)
    ?? (status ? `HTTP_${status}` : error?.name === 'TimeoutError' ? 'REQUEST_TIMEOUT' : 'REQUEST_FAILED')
  let origin = null
  try { const url = new URL(error?.requestOrigin); if (['http:', 'https:'].includes(url.protocol)) origin = url.origin } catch { /* 주소 원문은 기록하지 않는다. */ }
  return { phase, observedAt: at, machineId, method, pathname, origin,
    status, code, causeCodes: causes,
    category: status ? 'http' : error?.name === 'TimeoutError' || causes.some(value => value.includes('TIMEOUT')) ? 'timeout'
      : causes.some(value => ['ENOTFOUND', 'EAI_AGAIN'].includes(value)) ? 'dns'
      : causes.length || error?.message === 'fetch failed' ? 'connection' : 'request' }
}

export function recoverableLegacyParentWake(delegation) {
  return delegation?.state === 'parent-wake-failed' && !delegation.parentWakeRetry
    && !delegation.reportApprovalRequired && !delegation.pendingRecovery && !delegation.reportReceipt
    && delegation.parentDispatchState === 'unknown' && aiDelegationSucceeded(delegation)
    && aiDelegationReportResult(delegation).availability === 'captured'
    && /^(fetch failed|AIONUI_REQUEST_FAILED:(408|429|5\d\d))$/.test(delegation.parentError ?? '')
}

// 이 처리기는 하위 실행·Git 통합을 호출하지 않는다. POST는 내구 intent를 저장한 최초 1회뿐이다.
// 이후에는 동일 operation 조회만 수행하며 404/근거 불일치는 새 실행 없이 명시적 확인으로 남긴다.
export function createAiParentWakeProcessor({ get, values, update, archive, coordinationPending, capabilities,
  parentMachineId, runtime, normalizeRuntime, instruction, operationId, fetchOn, signal,
  now = Date.now, warn = console.warn }) {
  const inFlight = new Set()
  return async function processParentWake(input) {
    if (inFlight.has(input.id)) return
    inFlight.add(input.id)
    let delegation = input
    let phase = 'preflight'
    let method = 'GET'
    let pathname = null
    let machineId = null
    const stamp = () => new Date(now()).toISOString()
    const current = () => get(delegation.id) === delegation && !delegation.reportReceipt && !delegation.pendingRecovery
      && !integrationRecoveryPending(delegation)
      && (reportStates.has(delegation.state) || recoverableLegacyParentWake(delegation))
    const save = async (patch) => {
      if (!current()) return false
      const updated = await update(delegation.id, patch)
      delegation = updated
      return get(input.id) === updated && updated != null
    }
    const healthy = (status, nextPhase) => ({ ...delegation.parentWakeRetry,
      status, phase: nextPhase, attempt: 0, nextAttemptAt: null })
    try {
      if (!current()) return
      machineId = parentMachineId(delegation)
      if (recoverableLegacyParentWake(delegation)) {
        const priorError = new Error(delegation.parentError)
        const priorStatus = delegation.parentError.match(/^AIONUI_REQUEST_FAILED:(\d{3})$/)
        if (priorStatus) priorError.status = Number(priorStatus[1])
        await save({ state: delegation.wakeOperationId ? 'waking-parent' : 'waiting-parent',
          reportWaitReason: null, parentError: null,
          parentWakeRetry: { status: 'scheduled', phase: delegation.wakeOperationId ? 'dispatch-status' : 'preflight',
            attempt: 0, nextAttemptAt: stamp(), restoredAt: stamp(),
            legacyRecordUpdatedAt: delegation.updatedAt ?? null,
            lastFailure: parentWakeFailureDiagnostic(priorError, { phase: 'legacy-unknown', machineId, at: stamp() }) } })
        return
      }
      if (Date.parse(delegation.parentWakeRetry?.nextAttemptAt ?? '') > now()) return
      if (delegation.state === 'waiting-parent') {
        if ([...values()].some(item => item.id !== delegation.id && item.parentConversationId === delegation.parentConversationId && item.state === 'waking-parent')) {
          await save({ reportWaitReason: 'earlier-report' }); return
        }
        phase = 'coordination'
        if (delegation.childStatus === 'completed' && await coordinationPending(delegation)) {
          await save({ state: 'waiting-document-work', childResultSnapshot: null, childResultHash: null,
            childResultTurnId: null, childResultCapturedAt: null, childResultCaptureAttemptedAt: null })
          return
        }
        if (!current()) return
        if (delegation.reportApprovalRequired) {
          await save({ state: 'parent-wake-failed', parentDispatchState: 'not-sent', parentError: null, reportWaitReason: null }); return
        }
        phase = 'archive'
        const archived = await archive(delegation)
        if (get(input.id) !== archived) return
        delegation = archived
        if (!current()) return
        if (aiDelegationReportArchivePending(delegation)) { await save({ reportWaitReason: 'report-history-pending' }); return }
        phase = 'capabilities'
        pathname = '/api/internal/external-conversation-dispatches/capabilities'
        if (aiDelegationReportArchived(delegation) && (await capabilities(machineId))?.historyOnlyReports !== true) {
          throw Object.assign(new Error('상위 보고 기능 적용 대기'), { code: 'AIONCORE_HISTORY_REPORT_UNSUPPORTED' })
        }
        if (!current()) return
        phase = 'parent-runtime'
        pathname = `/api/conversations/${encodeURIComponent(delegation.parentConversationId)}`
        const parent = await runtime(delegation.parentConversationId, machineId)
        if (!current()) return
        const observed = normalizeRuntime(delegation.parentConversationId, parent, stamp())
        const observation = { state: observed.state, observedAt: stamp(), turnId: observed.turnId ?? null }
        if (observed.state !== 'idle') {
          const previous = delegation.parentRuntimeObservation
          await save({ reportWaitReason: observed.state === 'running' ? 'parent-busy'
            : observed.state === 'waiting-confirmation' ? 'parent-confirmation' : 'parent-unavailable',
          parentDispatchState: 'not-sent', parentError: null, parentWakeRetry: healthy('waiting', phase),
          ...(!previous || previous.state !== observation.state || previous.turnId !== observation.turnId
            || now() - Date.parse(previous.observedAt) >= 60_000 ? { parentRuntimeObservation: observation } : {}) })
          return
        }
        phase = 'prepare'
        pathname = null
        const result = aiDelegationReportResult(delegation)
        const attempt = Number(delegation.parentWakeAttempt ?? 0) + 1
        const wakeOperationId = operationId(delegation.id, `wake-${attempt}`)
        const content = aiDelegationReportArchived(delegation) ? delegation.reportArchive.content : await instruction(delegation, result)
        if (!current()) return
        if (!await save({ state: 'waking-parent', wakeOperationId, parentWakeAttempt: attempt,
          reportWaitReason: null, parentTurnId: null, parentDispatchState: 'intent-recorded', reportReceipt: null,
          parentError: null, parentRuntimeObservation: observation, parentWakeRetry: healthy('checking', 'dispatch-status'),
          reportPayloadHash: createHash('sha256').update(content).digest('hex'), reportResultAvailability: result.availability,
          reportResultHash: result.hash, reportResultTurnId: result.turnId, reportPreparedAt: stamp() })) return
        if (!current()) return
        phase = 'dispatch-submit'; method = 'POST'; pathname = '/api/internal/external-conversation-dispatches'
        const response = await fetchOn(machineId, pathname, { method, strictJson: true, noMutationRetry: true, singleTarget: true, body: {
          operationId: wakeOperationId, actorConversationId: delegation.parentConversationId, strategy: 'resume',
          targetConversationId: delegation.parentConversationId, instruction: content,
          ...(aiDelegationReportArchived(delegation) ? { historyMessageId: delegation.reportArchive.messageId } : {}),
        } })
        if (!current()) return
        const received = aiDelegationDeliveredReportPatch(delegation, response)
        if (received) { await save(received); return }
        // POST의 불완전한 응답도 다음 주기에 동일 operation을 조회하여 확인한다.
        await save({ parentDispatchState: 'unknown', parentWakeRetry: healthy('checking', 'dispatch-status') })
        return
      }
      phase = 'dispatch-status'
      if (!delegation.wakeOperationId) throw Object.assign(new Error('전달 요청 ID 없음'), { code: 'REPORT_OPERATION_MISSING', status: 409 })
      pathname = `/api/internal/external-conversation-dispatches/${encodeURIComponent(delegation.wakeOperationId)}`
      const status = await fetchOn(machineId, pathname, { strictJson: true, singleTarget: true })
      if (!current()) return
      const received = aiDelegationDeliveredReportPatch(delegation, status)
      if (received) { await save(received); return }
      if ((status.operationId && status.operationId !== delegation.wakeOperationId)
        || status.conversationId !== delegation.parentConversationId) {
        throw Object.assign(new Error('전달 대상 불일치'), { code: 'REPORT_RESPONSE_MISMATCH', status: 409 })
      }
      if (['starting', 'waiting_resource'].includes(status.state)
        || (!aiDelegationSucceeded(delegation) && ['running', 'waiting_resume'].includes(status.state))) {
        await save({ parentDispatchState: status.state.replaceAll('_', '-'), parentTurnId: status.turnId ?? delegation.parentTurnId ?? null,
          parentResource: status.resource ?? null, parentError: null, parentWakeRetry: healthy('checking', phase) })
        return
      }
      if (status.state === 'completed' && !aiDelegationSucceeded(delegation)) {
        await save({ state: 'failed', parentDispatchState: 'completed', completedAt: stamp(), reportWaitReason: null }); return
      }
      throw Object.assign(new Error('전달 근거 확인 필요'), { code: status.state === 'recovery_required' ? 'REPORT_DISPATCH_INTERRUPTED'
        : status.state === 'failed' ? 'REPORT_DISPATCH_FAILED' : 'REPORT_DELIVERY_UNVERIFIED', status: 409 })
    } catch (error) {
      throwIfRuntimeStopping(error, signal)
      if (!current()) return
      const sent = delegation.state === 'waking-parent'
      const failure = parentWakeFailureDiagnostic(error, { phase, machineId: phase === 'coordination' ? null : machineId, method, pathname, at: stamp() })
      const retryable = phase === 'dispatch-submit' || (phase !== 'prepare'
        && (!failure.status || [408, 429].includes(failure.status) || failure.status >= 500)
        && !['REPORT_OPERATION_MISSING', 'REPORT_RESPONSE_MISMATCH', 'MACHINE_UNREGISTERED', 'MACHINE_DISABLED', 'RUNNER_NOT_CONFIGURED'].includes(failure.code))
      const attempt = Number(delegation.parentWakeRetry?.attempt ?? 0) + 1
      const message = retryable ? sent ? '상위 재개 요청의 응답을 확인하지 못했습니다. 같은 요청의 접수 상태를 자동 재조회합니다.'
        : '상위 재개 전 조회에 실패했습니다. 보존된 결과로 자동 재시도합니다.'
        : '상위 보고의 접수·전달 근거를 확인할 수 없습니다. 결과를 보존했으며 새 실행 없이 확인이 필요합니다.'
      await save({ state: retryable ? sent ? 'waking-parent' : 'waiting-parent' : 'parent-wake-failed',
        parentDispatchState: sent ? 'unknown' : 'not-sent', reportWaitReason: null, parentError: message,
        parentWakeRetry: { status: retryable ? 'scheduled' : 'stopped', phase: sent ? 'dispatch-status' : 'preflight', attempt,
          lastAttemptAt: stamp(), nextAttemptAt: retryable ? new Date(now() + Math.min(60_000, 5_000 * 2 ** Math.min(attempt - 1, 4))).toISOString() : null,
          stopReason: retryable ? null : failure.code, lastFailure: failure },
        parentWakeFailures: [...(delegation.parentWakeFailures ?? []), failure].slice(-5) })
      warn('[AI parent wake]', { delegationId: input.id, operationId: delegation.wakeOperationId ?? null, retryable, ...failure })
    } finally { inFlight.delete(input.id) }
  }
}
