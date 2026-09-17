import type { AiDelegationSummary } from './aiDelegationManagement.mjs'
import type { AiDelegationCardStatus } from '../types/mindMap'

export function aiDelegationStatusByCard(
  delegations: AiDelegationSummary[],
  mapId: string,
): Record<string, AiDelegationCardStatus>
