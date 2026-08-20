// AI 귀속 토큰이 없거나 무효일 때 요청이 밝힌 conversationId, 요청 카드에 발급된
// 귀속 또는 카드에 연결된 대화 귀속만 사용한다. 문서 수준 추정은 같은 편집자의
// 다른 AI 세션도 잘못 귀속할 수 있으므로 사용하지 않는다.
//
// conversationId는 호출한 AI 세션을 그대로 가리키는 정확한 식별자이므로 문서 수준
// 추정과 달리 다른 세션을 잘못 귀속할 위험이 없다. 따라서 카드 위치와 무관하게
// 가장 먼저 사용한다. 이 값이 없을 때만 기존 카드 범위 판정으로 내려간다.

function matchByConversationId(scope, attributionList, conversationAttributionsByKey, now) {
  const conversationId = String(scope.conversationId ?? '').trim()
  if (!conversationId) return null
  const editorId = String(scope.editorId ?? '').trim()
  const usable = (candidate) => Boolean(candidate?.authorName)
    && String(candidate.conversationId ?? '').trim() === conversationId
    && (!editorId || candidate.startedBy === editorId)
  // 영속 대화 귀속이 우선이다. AionUi가 대화를 연결할 때 기록하므로 만료가 없다.
  for (const candidate of conversationAttributionsByKey?.values() ?? []) {
    if (usable(candidate)) return candidate
  }
  // 같은 대화로 발급된 카드 귀속 토큰은 만료 전까지만 사용한다.
  return (attributionList ?? [])
    .filter((candidate) => candidate.expiresAt > now && usable(candidate))
    .sort((first, second) => Number(second.createdAt ?? 0) - Number(first.createdAt ?? 0))[0] ?? null
}

export function resolveScopedAttribution(scope, attributionList, conversationAttributionsByKey, now = Date.now()) {
  const byConversationId = matchByConversationId(scope, attributionList, conversationAttributionsByKey, now)
  if (byConversationId) return { attribution: byConversationId, match: 'conversation-id', scope }
  // conversationId를 보낸 호출자는 자신의 정확한 대화 정체성을 밝힌 상태다.
  // 해당 대화를 찾지 못했다고 대상 카드에 연결된 다른 AI로 내려가면
  // 호출자와 작성자가 바뀌므로 명시된 대화가 있을 때는 카드 추정을 금지한다.
  if (String(scope.conversationId ?? '').trim()) return { attribution: null, match: null, scope }
  if (!scope.mapId) return { attribution: null, match: null, scope }
  const editorId = String(scope.editorId ?? '').trim()
  const candidates = (attributionList ?? [])
    .filter((candidate) => candidate.expiresAt > now
      && candidate.mapId === scope.mapId
      && (!editorId || candidate.startedBy === editorId))
    .sort((first, second) => Number(second.createdAt ?? 0) - Number(first.createdAt ?? 0))
  const exact = scope.cardId ? candidates.find((candidate) => candidate.cardId === scope.cardId) : null
  const scopedConversation = scope.cardId
    ? conversationAttributionsByKey.get(`${scope.mapId}:${scope.cardId}`) ?? null
    : null
  const conversation = scopedConversation && (!editorId || scopedConversation.startedBy === editorId)
    ? scopedConversation
    : null
  if (exact) return { attribution: exact, match: 'card', scope }
  if (conversation) return { attribution: conversation, match: 'conversation', scope }
  return { attribution: null, match: null, scope }
}

export function resolveAttributionWithoutToken(
  scope,
  declaredAuthorName,
  attributionList,
  conversationAttributionsByKey,
  now = Date.now(),
) {
  const normalizedDeclaredAuthorName = String(declaredAuthorName ?? '').trim()
  if (normalizedDeclaredAuthorName) {
    return {
      attribution: null,
      authorName: normalizedDeclaredAuthorName,
      match: 'self-declared',
      scope,
    }
  }
  return {
    ...resolveScopedAttribution(scope, attributionList, conversationAttributionsByKey, now),
    authorName: '',
  }
}
