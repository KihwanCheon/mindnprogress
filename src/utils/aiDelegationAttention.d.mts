import type { AiDelegationSummary } from './aiDelegationManagement.mjs'
import type { AiDelegationAttention } from '../types/mindMap'

export function aiDelegationAttentionByCard(
  delegations: AiDelegationSummary[],
  mapId: string,
): Record<string, AiDelegationAttention>
