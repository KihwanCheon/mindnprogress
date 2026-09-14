export const AI_DIALOG_SECTION_KEYS = Object.freeze(['workspace', 'mcp', 'skills'])

export function normalizeAiDialogSections(value) {
  return Object.fromEntries(AI_DIALOG_SECTION_KEYS.map(key => [key, typeof value?.[key] === 'boolean' ? value[key] : true]))
}

export function isAiDialogSectionsPatch(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length > 0
    && Object.entries(value).every(([key, open]) => AI_DIALOG_SECTION_KEYS.includes(key) && typeof open === 'boolean'))
}
