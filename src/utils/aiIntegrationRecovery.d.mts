import type { AiDelegationSummary } from './aiDelegationManagement.mjs'
type RecoveryItem = Pick<AiDelegationSummary, 'id' | 'mapId' | 'parentMapId' | 'integrationRecoveryRequest'>
export function integrationRecoveryPending(item?: RecoveryItem): boolean
export function integrationRecoveryUnconfirmed(item: RecoveryItem): boolean
export function reconcileIntegrationRecoveryRequests(items: RecoveryItem[]): void
export function submitIntegrationRecovery(item: RecoveryItem, body: Record<string, unknown>, request: (url: string, init?: RequestInit) => Promise<unknown>): Promise<{ delegation?: AiDelegationSummary; message: string; unconfirmed?: boolean }>
