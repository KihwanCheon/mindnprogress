export type ClaudeAccountOption = { id: string; number: number; label: string }
export type ClaudeAccountRole = 'coordinator' | 'others'
export type ClaudeAccountPolicy = { coordinator?: string; others?: string }

export function claudeAccountMark(number: unknown): string
export function claudeAccountRole(purpose: string | undefined): ClaudeAccountRole
export const CLAUDE_ACCOUNT_ROLE_LABELS: Readonly<Record<ClaudeAccountRole, string>>
export function mostUsedClaudeUsageEntry<T extends {
  value?: {
    state?: string
    session?: { usedPercent: number } | null
    weekly?: { usedPercent: number } | null
  } | null
}>(entries: readonly T[]): T | null
export function resolveDialogClaudeAccountId(
  accounts: ClaudeAccountOption[] | undefined,
  chosenId: string | undefined,
  policyId: string | undefined,
): string
