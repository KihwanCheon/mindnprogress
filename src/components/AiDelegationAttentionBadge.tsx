import type { AiDelegationAttention } from '../types/mindMap'

export function AiDelegationAttentionBadge({ attention, onOpen }: {
  attention?: AiDelegationAttention
  onOpen?: () => void
}) {
  if (!attention) return null
  return (
    <button
      type="button"
      className={`node-ai-delegation-attention ${attention.kind} nodrag nopan`}
      title={attention.title}
      aria-label={`${attention.label}${attention.count > 1 ? ` ${attention.count}건` : ''}. ${attention.title}`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => { event.stopPropagation(); onOpen?.() }}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        {attention.kind === 'recovery'
          ? <><path d="M12.75 5.75A5.25 5.25 0 1 0 13 9" /><path d="M12.75 2.75v3h-3" /></>
          : <><path d="M8 12.75v-9" /><path d="m4.75 7 3.25-3.25L11.25 7" /></>}
      </svg>
      <span>{attention.label}</span>
      {attention.count > 1 && <b>{attention.count}</b>}
    </button>
  )
}
