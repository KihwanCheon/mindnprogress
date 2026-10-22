/**
 * update_card replaces the whole waitingItems array. When an item with an existing id is resent
 * without a note key (for example rebuilt from a response that omitted notes), keep the stored note.
 * An explicit note value, including an empty string, still replaces or clears the stored note.
 */
export function preserveOmittedWaitingItemNotes(previousItems, nextItems) {
  if (!Array.isArray(previousItems) || !Array.isArray(nextItems)) return nextItems
  const storedNotes = new Map(previousItems
    .filter((item) => item && typeof item.id === 'string' && item.id && typeof item.note === 'string')
    .map((item) => [item.id, item.note]))
  return nextItems.map((item) => {
    if (!item || typeof item !== 'object' || !item.id || item.note !== undefined) return item
    return storedNotes.has(item.id) ? { ...item, note: storedNotes.get(item.id) } : item
  })
}
