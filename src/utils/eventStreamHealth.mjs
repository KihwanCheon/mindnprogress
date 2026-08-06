export const EVENT_STREAM_STALE_AFTER_MS = 70_000

export function shouldReconnectEventStream({
  lastEventAt,
  now = Date.now(),
  online = true,
  visibilityState = 'visible',
  force = false,
} = {}) {
  if (!online) return false
  if (force) return true
  if (visibilityState !== 'visible') return false
  return !Number.isFinite(lastEventAt) || now - lastEventAt >= EVENT_STREAM_STALE_AFTER_MS
}
