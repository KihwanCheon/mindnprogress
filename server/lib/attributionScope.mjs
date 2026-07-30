// AI 귀속 토큰이 없거나 무효일 때 요청 카드에 발급된 귀속 또는
// 카드에 연결된 대화 귀속만 사용한다. 문서 수준 추정은 같은 편집자의
// 다른 AI 세션도 잘못 귀속할 수 있으므로 사용하지 않는다.

export function resolveScopedAttribution(scope, attributionList, conversationAttributionsByKey, now = Date.now()) {
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
