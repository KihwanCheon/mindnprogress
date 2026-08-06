export const EVENT_STREAM_STALE_AFTER_MS: number

export function shouldReconnectEventStream(options?: {
  lastEventAt?: number
  now?: number
  online?: boolean
  visibilityState?: DocumentVisibilityState
  force?: boolean
}): boolean
