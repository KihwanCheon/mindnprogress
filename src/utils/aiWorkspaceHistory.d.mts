export const AI_WORKSPACE_HISTORY_LIMIT: number
export const AI_WORKSPACE_MAX_LENGTH: number

export function normalizeAiWorkspaceHistory(value: unknown, limit?: number): string[]
export function rememberAiWorkspace(history: unknown, value: unknown, limit?: number): string[]
export function removeAiWorkspace(history: unknown, value: unknown, limit?: number): string[]
