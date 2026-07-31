export const structuredCommentFormat = 'summary-detail'
export const commentSummaryMaxLength = 240
export const commentDetailMaxLength = 6_000
export const legacyCommentTextMaxLength = 1_000

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function normalizedText(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength)
}

export function createCommentContent(body) {
  if (hasOwn(body, 'summary')) {
    const summary = normalizedText(body.summary, commentSummaryMaxLength)
    if (!summary) return { error: '댓글 요약을 입력해 주세요.' }
    const detail = normalizedText(body.detail, commentDetailMaxLength)
    return {
      content: {
        contentFormat: structuredCommentFormat,
        summary,
        text: summary,
        ...(detail ? { detail } : {}),
      },
    }
  }

  const text = normalizedText(body.text, legacyCommentTextMaxLength)
  if (!text) return { error: '댓글 내용을 입력해 주세요.' }
  return { content: { text } }
}

export function updateCommentContent(comment, body) {
  const hasSummary = hasOwn(body, 'summary')
  const hasText = hasOwn(body, 'text')
  const hasDetail = hasOwn(body, 'detail')
  if (!hasSummary && !hasText && !hasDetail) return { error: '수정할 댓글 내용을 입력해 주세요.' }

  const next = { ...comment }
  if (hasSummary) {
    const summary = normalizedText(body.summary, commentSummaryMaxLength)
    if (!summary) return { error: '댓글 요약을 입력해 주세요.' }
    next.contentFormat = structuredCommentFormat
    next.summary = summary
    next.text = summary
  } else if (hasText) {
    const maxLength = comment.contentFormat === structuredCommentFormat
      ? commentSummaryMaxLength
      : legacyCommentTextMaxLength
    const text = normalizedText(body.text, maxLength)
    if (!text) return { error: '댓글 내용을 입력해 주세요.' }
    next.text = text
    if (comment.contentFormat === structuredCommentFormat) next.summary = text
  }

  if (hasDetail) {
    if (next.contentFormat !== structuredCommentFormat) {
      return { error: '기존 댓글에 상세 내용을 추가할 때는 요약을 함께 입력해 주세요.' }
    }
    const detail = normalizedText(body.detail, commentDetailMaxLength)
    if (detail) next.detail = detail
    else delete next.detail
  }

  return { content: next }
}

export function commentForResponse(comment, includeDetail = true) {
  if (includeDetail) return comment
  const { detail, ...summaryComment } = comment
  return {
    ...summaryComment,
    hasDetail: typeof detail === 'string' && detail.trim().length > 0,
  }
}
