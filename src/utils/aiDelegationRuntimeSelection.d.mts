export type AiDelegationRuntime = { agentId: string; modelId: string; mode: string; thoughtLevel: string }
type StorageReader = Pick<Storage, 'getItem'>
type StorageWriter = Pick<Storage, 'setItem'>
type Agent = { id: string; models: readonly { id: string }[]; modes: readonly { id: string }[]; thoughtLevels: readonly { id: string }[] }

export function normalizeAiDelegationRuntime(value: unknown): AiDelegationRuntime
export function readAiDelegationRuntime(userId: string, machineId: string, storage?: StorageReader): AiDelegationRuntime | null
export function saveAiDelegationRuntime(userId: string, machineId: string, value: unknown, storage?: StorageWriter): boolean
export function resolveAiDelegationRuntime(value: unknown, agents: readonly Agent[]): { selection: AiDelegationRuntime; unavailableFields: string[] }
