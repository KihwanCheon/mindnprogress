import { createHash } from 'node:crypto'
import { aiDelegationWorkspaceLeaseMatches, retryableAiExecutionFailureCategory } from './aiDelegations.mjs'
import { sameExecutionWorkspace } from './doorayExecutionWorkspace.mjs'
import { readAiDelegationDispatchStatus } from './aiDelegationStatusLookup.mjs'

export class AiDelegationInterruptedRecoveryError extends Error {
  constructor(reason) {
    super(`중단된 원 실행·지시·대화·lease를 확증하지 못해 복구를 보류했습니다. (${reason})`)
    this.status = 409
    this.code = 'AI_DELEGATION_INTERRUPTED_SOURCE_UNCONFIRMED'
    this.proofHoldReason = reason
  }
}

const hold = reason => { throw new AiDelegationInterruptedRecoveryError(reason) }
const sha = value => createHash('sha256').update(value).digest('hex')
const fingerprint = value => sha(JSON.stringify(value))
const failure = delegation => delegation.workspaceResult?.childError ?? delegation.childError
const leaseKeys = ['workspaceId', 'jobId', 'leaseId', 'projectRoot', 'branch', 'baseCommit']
const PAGE_SIZE = 100, MAX_PAGES = 20

function failedSource(delegation) {
  const result = delegation?.workspaceResult, lease = delegation?.workspaceLease
  if (!lease || delegation.pendingRecovery || delegation.resultCorrection || delegation.childStatus !== 'failed'
    || !delegation.childOperationId || !delegation.childTurnId || result?.childStatus !== 'failed'
    || !['quarantined', 'failed-clean'].includes(result.status)
    || result.integratedCommit || result.integrationBranch || result.unmergedFiles?.length
    || retryableAiExecutionFailureCategory(failure(delegation)) !== 'upstream-interrupted') hold('failed-source-required')
  for (const [key, value] of Object.entries({ mapId: delegation.mapId, cardId: delegation.targetCardId,
    conversationId: delegation.targetConversationId })) {
    if (!value || result[key] !== value) hold('failed-source-scope-mismatch')
  }
  for (const key of leaseKeys.filter(key => key !== 'projectRoot')) {
    if (!lease[key] || result[key] !== lease[key]) hold('failed-source-lease-mismatch')
  }
}

function idleConversation(conversation, delegation) {
  const runtime = conversation?.runtime
  return conversation?.id === delegation.targetConversationId
    && sameExecutionWorkspace(conversation.extra?.workspace, delegation.workspaceLease.projectRoot)
    && runtime?.state === 'idle' && runtime.is_processing === false && runtime.pending_confirmations === 0
    && runtime.has_task === false && runtime.task_status === null && runtime.turn_id === null
}

function originalRequest(delegation, origin, conversation, message) {
  const content = typeof message.content === 'string' ? message.content : message.content?.content
  const lease = delegation.workspaceLease, createdAt = Number(conversation.created_at)
  const startedAt = Date.parse(lease.startedAt), requestedAt = Date.parse(delegation.createdAt)
  if (message.type !== 'text' || message.position !== 'right' || message.status !== 'finish'
    || message.conversation_id !== delegation.targetConversationId || typeof content !== 'string'
    || !Number.isSafeInteger(createdAt) || !Number.isFinite(startedAt) || !Number.isFinite(requestedAt)
    || createdAt > message.created_at || message.created_at < Math.max(requestedAt, startedAt - 1000)
    || message.created_at > startedAt + 300_000) return null
  if (!origin || origin.conversationId !== conversation.id || origin.mapId !== delegation.mapId
    || origin.cardId !== delegation.targetCardId || origin.startedBy !== delegation.startedBy) hold('origin-mismatch')
  const text = content.replace(/\r\n?/g, '\n'), marker = '\n# 상위 AI 지시\n\n'
  const split = text.indexOf(marker)
  if (!text.startsWith('# MindNProgress 하위 카드 위임 작업 요청\n') || split < 0
    || text.indexOf(marker, split + 1) >= 0) return null
  const instructionHash = sha(text.slice(split + marker.length).trim())
  if (!delegation.instructionHash || instructionHash !== delegation.instructionHash) return null
  const header = text.slice(0, split).split('\n')
  const field = key => {
    const prefix = `- ${key}: \``
    const lines = header.filter(line => line.startsWith(prefix) && line.endsWith('`'))
    if (lines.length !== 1) hold('original-header-ambiguous')
    return lines[0].slice(prefix.length, -1)
  }
  for (const [key, value] of Object.entries({ mapId: delegation.mapId, cardId: delegation.targetCardId, editorId: delegation.startedBy })) {
    if (!value || field(key) !== value) hold('original-header-scope-mismatch')
  }
  const workspaceLease = Object.fromEntries(leaseKeys.map(key => [key, field(key)]))
  if (!aiDelegationWorkspaceLeaseMatches(lease, workspaceLease) || workspaceLease.baseCommit !== lease.baseCommit) hold('original-header-lease-mismatch')
  return { messageId: message.id, instructionHash, messageCreatedAt: message.created_at, workspaceLease }
}

// resume 대화의 과거 작업 전문과 최신 수동 답변은 근거가 아니다.
// 같은 job의 시간창·원 지시 hash·서버 실패 기록으로만 원 요청을 찾는다.
export function verifyAiDelegationInterruptedHistory(delegation, origin, conversation, pages) {
  failedSource(delegation)
  if (!['new', 'resume'].includes(delegation.strategy) || delegation.childOperationId !== delegation.id
    || Number(delegation.recoveryAttempt ?? 0) !== 0 || delegation.recoveryOperationId
    || !idleConversation(conversation, delegation)) hold('original-failed-idle-source-required')
  if (!Array.isArray(pages) || !pages.length || pages.length > MAX_PAGES) hold('history-page-limit')
  const ids = new Set(), cursors = new Set(), matches = []
  for (const [index, page] of pages.entries()) {
    if (!Array.isArray(page?.items) || !page.items.length || page.items.length > PAGE_SIZE
      || typeof page.has_more_before !== 'boolean' || typeof page.has_more_after !== 'boolean'
      || page.has_more_before !== (index < pages.length - 1)
      || page.has_more_after !== (index > 0) || page.truncated === true
      || (page.has_more_before && page.items.length !== PAGE_SIZE)) hold('history-incomplete')
    if (typeof page.oldest_cursor !== 'string' || !page.oldest_cursor.trim()
      || typeof page.newest_cursor !== 'string' || !page.newest_cursor.trim()
      || cursors.has(page.oldest_cursor)) hold('history-cursor-unstable')
    cursors.add(page.oldest_cursor)
    for (const message of page.items) {
      if (!message?.id || ids.has(message.id) || message.conversation_id !== delegation.targetConversationId
        || !Number.isSafeInteger(message.created_at) || message.created_at <= 0
        || message.truncated === true || message.content?.truncated === true) hold('history-row-incomplete')
      ids.add(message.id)
      const original = originalRequest(delegation, origin, conversation, message)
      if (original) matches.push(original)
    }
  }
  if (matches.length !== 1) hold('original-request-not-unique')
  return { kind: 'interrupted-original-message-after-operation-expiry-v1',
    operationId: delegation.childOperationId, observedTurnId: delegation.childTurnId,
    conversationId: delegation.targetConversationId, failureHash: sha(failure(delegation)),
    originalRequest: matches[0], workspaceLease: matches[0].workspaceLease, historyHash: fingerprint(pages) }
}

export function assertAiDelegationInterruptedLease(lease, proof, scope) {
  const result = lease?.result ?? (lease?.status === 'leased' ? lease.recoveryHistory?.at(-1)?.previousResult : null)
  if (!['interrupted-original-message-after-operation-expiry-v1', 'interrupted-original-operation-v1'].includes(proof?.kind)
    || !proof.operationId || !proof.observedTurnId || !proof.failureHash || !lease
    || proof.conversationId !== scope.conversationId || !aiDelegationWorkspaceLeaseMatches(lease, proof.workspaceLease)
    || result?.childStatus !== 'failed' || result.integratedCommit || result.integrationBranch || result.unmergedFiles?.length
    || retryableAiExecutionFailureCategory(result.childError) !== 'upstream-interrupted'
    || sha(result.childError) !== proof.failureHash) hold('pool-failed-source-mismatch')
  for (const key of ['mapId', 'cardId', 'conversationId']) {
    if (!scope[key] || lease[key] !== scope[key] || result[key] !== scope[key]) hold('pool-failed-scope-mismatch')
  }
  for (const key of leaseKeys.filter(key => key !== 'projectRoot')) {
    if (result[key] !== lease[key]) hold('pool-failed-lease-mismatch')
  }
}

export async function readAiDelegationInterruptedProof(fetchOn, { machineId, delegation, origin }) {
  failedSource(delegation)
  const conversationPath = `/api/conversations/${encodeURIComponent(delegation.targetConversationId)}`
  const conversation = await fetchOn(machineId, conversationPath)
  if (!idleConversation(conversation, delegation)) hold('conversation-not-idle')
  try {
    const dispatch = await readAiDelegationDispatchStatus(fetchOn, { machineId, operationId: delegation.childOperationId })
    if (dispatch.state !== 'failed' || dispatch.operationId !== delegation.childOperationId
      || dispatch.turnId !== delegation.childTurnId || dispatch.conversationId !== delegation.targetConversationId
      || !aiDelegationWorkspaceLeaseMatches(delegation.workspaceLease, dispatch.workspaceLease)
      || dispatch.errorMessage !== failure(delegation)) hold('original-dispatch-mismatch')
    if (!idleConversation(await fetchOn(machineId, conversationPath), delegation)) hold('conversation-changed')
    return { kind: 'interrupted-original-operation-v1', operationId: dispatch.operationId, observedTurnId: dispatch.turnId,
      conversationId: dispatch.conversationId, failureHash: sha(dispatch.errorMessage), workspaceLease: dispatch.workspaceLease }
  } catch (error) {
    // route 404·네트워크 장애·다른 오류를 operation 만료로 추정하지 않는다.
    if (error.code !== 'AI_DELEGATION_STATUS_NOT_FOUND' || error.cause?.code !== 'EXTERNAL_DISPATCH_NOT_FOUND') throw error
  }
  const pages = [], pageCursors = [], cursors = new Set()
  const readPage = before => fetchOn(machineId, `${conversationPath}/messages?${new URLSearchParams({
    limit: String(PAGE_SIZE), content_mode: 'full', ...(before ? { before } : {}),
  })}`, { timeoutMs: 30_000 })
  let before = ''
  for (let index = 0; index < MAX_PAGES; index++) {
    const page = await readPage(before)
    pages.push(page); pageCursors.push(before)
    if (page?.has_more_before === false) break
    const next = page?.oldest_cursor
    if (!next || next === before || cursors.has(next)) hold('history-cursor-unstable')
    cursors.add(next); before = next
  }
  const proof = verifyAiDelegationInterruptedHistory(delegation, origin, conversation, pages)
  for (const [index, cursor] of pageCursors.entries()) {
    if (fingerprint(await readPage(cursor)) !== fingerprint(pages[index])) hold('history-changed-during-proof')
  }
  const current = await fetchOn(machineId, conversationPath)
  if (!idleConversation(current, delegation) || current.created_at !== conversation.created_at) hold('conversation-changed')
  return proof
}
