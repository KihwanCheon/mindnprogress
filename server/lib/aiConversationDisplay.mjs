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

export async function resolveConversationSource(conversationId, {
  sourceMachineId, targetMachineId, readConversation, createConversationUrl,
}) {
  const display = await resolveConversationDisplay(conversationId, readConversation)
  if (sourceMachineId === targetMachineId) return display
  // A missing remote address must never route to an unrelated local conversation.
  let externalUrl = null
  try {
    externalUrl = createConversationUrl(display.conversationId)
  } catch {
    // Display metadata must not prevent the delegation or report from being sent.
  }
  return { ...display, externalUrl }
}

export function prependAiConversationSource(content, kind, conversation) {
  if (!conversation?.conversationId || !['delegation', 'report'].includes(kind)) return content
  const { conversationId, name } = formatAiConversationDisplay(conversation.conversationId, conversation.name)
  if (!conversationId) return content
  const source = {
    kind, conversationId, name,
    ...(conversation.externalUrl !== undefined ? { externalUrl: conversation.externalUrl } : {}),
  }
  // This is display metadata only; it adds no reply or workflow instructions.
  return `[[MNP_CONVERSATION_SOURCE]]\n${JSON.stringify(source)}\n[[/MNP_CONVERSATION_SOURCE]]\n\n${content}`
}

export function stripAiConversationSource(content) {
  const block = /^\[\[MNP_CONVERSATION_SOURCE\]\]\r?\n([^\r\n]+)\r?\n\[\[\/MNP_CONVERSATION_SOURCE\]\]\r?\n\r?\n/.exec(content)
  if (!block) return content
  try {
    const source = JSON.parse(block[1])
    if (!['delegation', 'report'].includes(source?.kind)
      || typeof source.conversationId !== 'string' || !source.conversationId.trim()) return content
    return content.slice(block[0].length)
  } catch {
    return content
  }
}
