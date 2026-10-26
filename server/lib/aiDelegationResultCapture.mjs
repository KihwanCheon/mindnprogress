import { createHash } from 'node:crypto'

// 하위 AI 결과 원문은 상위 재개 전문·그룹 문맥에 그대로 실리므로 인라인 길이는
// 기존 12,000자를 유지한다. 넘는 원문은 절단 사실을 본문 끝에 명시하고,
// 위임 결과는 별도 보관본(childResultFull)으로 전체를 조회할 수 있게 한다.
export const AI_DELEGATION_RESULT_INLINE_LIMIT = 12_000
export const AI_DELEGATION_RESULT_FULL_LIMIT = 100_000
// resultHash/childResultHash/responseHash는 저장된 결과 문자열(절단 표시 포함)의 SHA-256이다.
export const AI_DELEGATION_RESULT_HASH_BASIS = 'stored-snapshot'

const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const formatCount = (value) => Number(value).toLocaleString('en-US')

function defaultReadContent(message) {
  const content = message?.content
  if (typeof content === 'string') return content
  if (content && typeof content === 'object' && typeof content.content === 'string') return content.content
  return ''
}

function isAssistantResultMessage(message, readContent) {
  return message?.position === 'left'
    && (message.type === 'text' || message.type === 'tips')
    && Boolean(readContent(message).trim())
}

function truncationMarker({ originalLength, fullTextStored, fullTextTruncated, fullPath }) {
  const head = `[MindNProgress 결과 절단] 원문 ${formatCount(originalLength)}자 중 앞 ${formatCount(AI_DELEGATION_RESULT_INLINE_LIMIT)}자만 이 결과에 포함했습니다.`
  if (fullPath === 'delegation' && fullTextStored) {
    return `${head} 전체 원문은 mindnprogress_list_ai_delegations(includeResult=true, includeFullResult=true)의 resultFull로 확인하세요.${fullTextTruncated
      ? ` 보관 원문도 앞 ${formatCount(AI_DELEGATION_RESULT_FULL_LIMIT)}자까지만 저장됐으므로 나머지는 실행 대화 전문(mindnprogress_get_ai_conversation_transcript)에서 확인하세요.`
      : ''}`
  }
  return `${head} 전체 원문은 대상 대화 전문(mindnprogress_get_ai_conversation_transcript)에서 확인하세요.`
}

/**
 * Select the assistant result message from an AionUi message page and build the stored
 * snapshot with truncation and message-shape metadata.
 * Only the final left text/tips message is captured (existing behavior). Earlier text
 * messages of the same turn are counted so the parent can detect a split final answer.
 */
export function buildAiDelegationResultCapture(messages, {
  readContent = defaultReadContent,
  fullPath = 'delegation',
} = {}) {
  const rows = Array.isArray(messages) ? messages : []
  let finalIndex = -1
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (isAssistantResultMessage(rows[index], readContent)) { finalIndex = index; break }
  }
  if (finalIndex < 0) return null
  const message = rows[finalIndex]
  const original = readContent(message).trim()
  let turnStart = 0
  for (let index = finalIndex - 1; index >= 0; index -= 1) {
    if (rows[index]?.position === 'right') { turnStart = index + 1; break }
  }
  const earlierTexts = rows.slice(turnStart, finalIndex)
    .filter((candidate) => candidate?.position === 'left' && candidate.type === 'text')
    .map((candidate) => readContent(candidate).trim())
    .filter(Boolean)
  const earlierTextMaxLength = earlierTexts.reduce((max, text) => Math.max(max, text.length), 0)
  const truncated = original.length > AI_DELEGATION_RESULT_INLINE_LIMIT
  const fullTextStored = truncated && fullPath === 'delegation'
  const fullText = fullTextStored ? original.slice(0, AI_DELEGATION_RESULT_FULL_LIMIT) : null
  const fullTextTruncated = Boolean(fullTextStored && original.length > AI_DELEGATION_RESULT_FULL_LIMIT)
  const snapshot = truncated
    ? `${original.slice(0, AI_DELEGATION_RESULT_INLINE_LIMIT)}\n\n${truncationMarker({ originalLength: original.length, fullTextStored, fullTextTruncated, fullPath })}`
    : original
  const snapshotHash = sha256(snapshot)
  return {
    snapshot,
    snapshotHash,
    full: fullText === null ? null : {
      text: fullText, hash: sha256(fullText), length: fullText.length,
      truncated: fullTextTruncated, snapshotHash,
    },
    capture: {
      hashBasis: AI_DELEGATION_RESULT_HASH_BASIS,
      snapshotHash,
      messageId: typeof message.id === 'string' ? message.id : null,
      messageType: message.type,
      originalLength: original.length,
      storedLength: snapshot.length,
      inlineLimit: AI_DELEGATION_RESULT_INLINE_LIMIT,
      truncated,
      fullTextStored,
      fullTextTruncated,
      turnTextMessageCount: earlierTexts.length + (message.type === 'text' ? 1 : 0),
      earlierTextMaxLength,
      // 추정: 같은 턴의 앞선 텍스트가 최종 메시지보다 길면 보고가 여러 메시지로 나뉘었을 수 있다.
      splitSuspected: earlierTextMaxLength > original.length,
    },
  }
}

/** Capture metadata is trusted only while it still describes the current stored snapshot. */
export function aiDelegationResultCaptureMetadata(record, text, hashKey = 'childResultCapture') {
  const capture = record?.[hashKey]
  if (!capture || typeof capture !== 'object' || typeof text !== 'string' || !text) return null
  return capture.snapshotHash === sha256(text) ? capture : null
}

/** Full original text kept for a truncated delegation result, bound to the stored snapshot hash. */
export function aiDelegationFullResult(delegation) {
  const full = delegation?.childResultFull
  const snapshot = delegation?.childResultSnapshot
  if (!full || typeof full.text !== 'string' || typeof snapshot !== 'string' || !snapshot) return null
  if (full.snapshotHash !== sha256(snapshot) || full.hash !== sha256(full.text)) return null
  return { text: full.text, hash: full.hash, length: full.text.length, truncated: full.truncated === true }
}
