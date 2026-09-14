const cleanConversationId = (value) => String(value ?? '').trim().slice(0, 120)

export function normalizeAiConversationName(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 240)
}

export function formatAiConversationDisplay(conversationId, name = '') {
  const id = cleanConversationId(conversationId)
  const normalizedName = normalizeAiConversationName(name)
  return {
    conversationId: id,
    name: normalizedName,
    displayLabel: normalizedName ? `${normalizedName} (${id})` : id,
    source: normalizedName ? 'live' : 'id-only',
  }
}

export async function resolveConversationDisplay(conversationId, readConversation) {
  const id = cleanConversationId(conversationId)
  if (!id) return formatAiConversationDisplay('', '')
  try {
    const conversation = await readConversation(id)
    if (String(conversation?.id ?? '').trim() !== id) return formatAiConversationDisplay(id, '')
    return formatAiConversationDisplay(id, conversation.name)
  } catch {
    return formatAiConversationDisplay(id, '')
  }
}
