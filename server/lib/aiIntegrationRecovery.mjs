import { createHash, randomUUID } from 'node:crypto'

export function integrationRecoveryPending(delegation) {
  return ['queued', 'checking'].includes(delegation?.integrationRecoveryRequest?.status)
}

export function integrationRecoveryPublicView(request) {
  if (!request) return null
  const { requestId, status, message, reasonCode, requestedAt, startedAt, completedAt } = request
  return { requestId, status, message, reasonCode, requestedAt, startedAt: startedAt ?? null, completedAt: completedAt ?? null }
}

export function integrationRecoverySnapshot(delegation) {
  return createHash('sha256').update(JSON.stringify([
    delegation.id, delegation.state, delegation.mapId, delegation.parentMapId, delegation.parentCardId,
    delegation.targetCardId, delegation.parentConversationId, delegation.targetConversationId,
    delegation.startedBy, delegation.parentHomeMachineId, delegation.targetHomeMachineId,
    delegation.groupId, delegation.groupProjectVersion, delegation.strategy, delegation.instructionHash,
    delegation.childOperationId, delegation.childTurnId, delegation.childStatus,
    delegation.childResultHash, delegation.childResultTurnId, delegation.childResultSnapshot, delegation.workspaceLease, delegation.workspaceResult,
  ])).digest('hex')
}

function requestFingerprint(body, authorization) {
  const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value
  return createHash('sha256').update(JSON.stringify(stable([
    authorization, body.expectedUpdatedAt, body.sourceRevision, body.targetRevision, body.groupVersion,
    body.confirmApprovedScope, String(body.instruction ?? '').trim(), body.untrackedMetaRecovery ?? null,
  ]))).digest('hex')
}

// 접수 기록은 실행·통합 성공과 별개다. 긴 검증을 HTTP 요청이나 전체 위임 폴링에서 기다리지 않는다.
export function createIntegrationRecoveryQueue({ get, save, check, recover, successPatch, isStopping = () => false, failureMessage = error => error.message }) {
  const running = new Map()
  const accepting = new Map()
  const mismatch = () => Object.assign(new Error('통합 복구 요청 ID가 다른 요청에 사용됐습니다.'), { status: 409, code: 'AI_DELEGATION_INTEGRATION_RECOVERY_REQUEST_MISMATCH' })
  const persist = async (id, patch) => {
    try { return await save(id, patch) } catch (error) { error.integrationRecoveryStorageError = true; throw error }
  }

  function repeat(id, body, authorization) {
    const delegation = get(id)
    const current = delegation?.integrationRecoveryRequest
    if (!current) return null
    const fingerprint = requestFingerprint(body, authorization)
    if (current.requestId === body.recoveryRequestId || (body.recoveryRequestId === undefined && current.fingerprint === fingerprint)) {
      if (current.fingerprint !== fingerprint) throw mismatch()
      return { delegation, repeated: true }
    }
    if (integrationRecoveryPending(delegation)) {
      if (current.authorization.editorId !== authorization.editorId) throw mismatch()
      return { delegation, repeated: true }
    }
    return null
  }

  async function accept(id, body, authorization, failureCategory, { untrackedMetaRecovery } = {}) {
    const previous = accepting.get(id) ?? Promise.resolve()
    const work = previous.catch(() => {}).then(async () => {
      const delegation = get(id)
      const fingerprint = requestFingerprint(body, authorization)
      if (body.recoveryRequestId !== undefined && !/^[A-Za-z0-9_-]{8,128}$/u.test(body.recoveryRequestId)) {
        throw Object.assign(new Error('통합 복구 요청 ID가 올바르지 않습니다.'), { status: 400 })
      }
      const repeated = repeat(id, body, authorization)
      if (repeated) return repeated
      const request = {
        requestId: body.recoveryRequestId ?? randomUUID(), fingerprint, failureCategory,
        authorization, snapshot: integrationRecoverySnapshot(delegation),
        scope: { sourceRevision: body.sourceRevision, targetRevision: body.targetRevision,
          groupVersion: body.groupVersion, confirmApprovedScope: body.confirmApprovedScope },
        ...((untrackedMetaRecovery ?? body.untrackedMetaRecovery) ? { untrackedMetaRecovery: untrackedMetaRecovery ?? body.untrackedMetaRecovery } : {}),
        status: 'queued', requestedAt: new Date().toISOString(), reasonCode: 'AI_DELEGATION_INTEGRATION_RECOVERY_QUEUED',
        message: '통합 재시도 요청을 접수했습니다. 안전 검증을 기다리고 있으며 하위 AI 작업은 다시 실행하지 않습니다.',
      }
      const previousRequest = delegation.integrationRecoveryRequest
      return { delegation: await persist(id, { integrationRecoveryRequest: request,
        ...(previousRequest ? { integrationRecoveryRequestHistory: [...(delegation.integrationRecoveryRequestHistory ?? []), integrationRecoveryPublicView(previousRequest)].slice(-20) } : {}),
      }), repeated: false }
    })
    accepting.set(id, work)
    try { return await work } finally { if (accepting.get(id) === work) accepting.delete(id) }
  }

  function run(id) {
    if (running.has(id)) return running.get(id)
    const work = Promise.resolve().then(async () => {
      let delegation = get(id)
      if (!integrationRecoveryPending(delegation) || isStopping()) return
      let request = delegation.integrationRecoveryRequest
      try {
        if (request.snapshot !== integrationRecoverySnapshot(delegation)) throw Object.assign(new Error('통합 재시도 접수 후 원 위임·결과·작업공간이 변경됐습니다.'), { reasonCode: 'AI_DELEGATION_INTEGRATION_RECOVERY_STALE' })
        request = { ...request, status: 'checking', startedAt: request.startedAt ?? new Date().toISOString(),
          reasonCode: 'AI_DELEGATION_INTEGRATION_RECOVERY_CHECKING',
          message: '보존된 완료 결과의 소유권·세션·Git·체크포인트를 검증 중입니다. 같은 요청을 다시 실행하지 마세요.' }
        delegation = await persist(id, { integrationRecoveryRequest: request })
        await check(delegation, request)
        if (isStopping()) return
        const latest = get(id)
        if (latest.integrationRecoveryRequest?.requestId !== request.requestId || request.snapshot !== integrationRecoverySnapshot(latest)) throw Object.assign(new Error('검증 중 원 위임 또는 복구 요청이 변경됐습니다.'), { reasonCode: 'AI_DELEGATION_INTEGRATION_RECOVERY_STALE' })
        const result = await recover(latest, request)
        if (isStopping()) return // pool 기록 저장 후 중단돼도 동일 요청·lease의 내구 결과로 재대사한다.
        const current = get(id)
        if (current.integrationRecoveryRequest?.requestId !== request.requestId) throw mismatch()
        await persist(id, { ...successPatch(current, result), integrationRecoveryRequest: {
          ...request, status: 'accepted', completedAt: new Date().toISOString(),
          reasonCode: 'AI_DELEGATION_INTEGRATION_RECOVERY_ACCEPTED',
          message: result.status === 'completed' ? '같은 요청의 이미 완료된 통합 결과를 확인했습니다. 중복 반영하지 않았습니다.'
            : '안전 검증을 통과해 기존 완료 커밋의 통합 대기로 전환했습니다. 통합 완료는 후속 상태에서 확인하세요.',
        } })
      } catch (error) {
        if (isStopping()) return
        if (error.integrationRecoveryStorageError) throw error // 저장 불확실성을 실행 실패로 바꾸지 않는다. 같은 내구 요청으로 재대사한다.
        if (get(id)?.integrationRecoveryRequest?.requestId !== request.requestId) return
        await persist(id, { integrationRecoveryRequest: { ...request, status: 'failed', completedAt: new Date().toISOString(),
          reasonCode: error.reasonCode ?? error.code ?? 'AI_DELEGATION_INTEGRATION_RECOVERY_FAILED',
          message: `통합 재시도를 시작하지 못했습니다: ${failureMessage(error)}` } })
      }
    }).finally(() => running.delete(id))
    running.set(id, work)
    return work
  }

  return { accept, repeat, run, running }
}
