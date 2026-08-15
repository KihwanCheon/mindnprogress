export const AI_RUNTIME_SELECTIONS_VERSION: 2

export type AiRuntimeSelection = {
  modelId?: string
  mode?: string
  thoughtLevel?: string
}

export type AiRuntimeSelections = {
  version: 2
  lastAgentId: string
  selectionsByAgent: Record<string, AiRuntimeSelection>
}

export function normalizeAiRuntimeSelections(value: unknown): AiRuntimeSelections
export function getAiRuntimeSelection(value: unknown, agentId: unknown): AiRuntimeSelection
export function rememberAiRuntimeSelection(value: unknown, agentId: unknown, selection: unknown): AiRuntimeSelections
export function availableAiRuntimeOptionId(
  options: readonly { id: string }[] | unknown,
  preferredId?: unknown,
  defaultId?: unknown,
): string
