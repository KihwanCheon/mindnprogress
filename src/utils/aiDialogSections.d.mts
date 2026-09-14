export type AiDialogSection = 'workspace' | 'mcp' | 'skills'
export type AiDialogSections = Record<AiDialogSection, boolean>
export const AI_DIALOG_SECTION_KEYS: readonly AiDialogSection[]
export function normalizeAiDialogSections(value: unknown): AiDialogSections
export function isAiDialogSectionsPatch(value: unknown): value is Partial<AiDialogSections>
