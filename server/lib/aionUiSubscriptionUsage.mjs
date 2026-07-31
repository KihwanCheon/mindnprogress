const SNAPSHOT_STATES = new Set(['loading', 'ready', 'partial', 'unavailable'])
const PROVIDER_STATES = new Set(['loading', 'ready', 'unavailable'])

function isoDate(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

function normalizedPercent(value) {
  const percent = Number(value)
  if (!Number.isFinite(percent)) return null
  return Math.max(0, Math.min(100, percent))
}

function normalizeWindow(value, { includeDuration = false } = {}) {
  if (!value || typeof value !== 'object') return null
  const usedPercent = normalizedPercent(value.usedPercent)
  if (usedPercent === null) return null
  const window = {
    usedPercent,
    resetsAt: isoDate(value.resetsAt),
  }
  if (includeDuration) {
    const duration = Number(value.windowDurationMins)
    window.windowDurationMins = Number.isFinite(duration) && duration > 0 ? duration : null
  }
  return window
}

function providerIsStale(state, updatedAt, now, staleAfterMs) {
  if (state !== 'ready') return false
  if (!updatedAt) return true
  const age = now - Date.parse(updatedAt)
  return !Number.isFinite(age) || age > staleAfterMs
}

function normalizeClaude(value, now, staleAfterMs) {
  const state = PROVIDER_STATES.has(value?.state) ? value.state : 'unavailable'
  const updatedAt = isoDate(value?.updatedAt)
  return {
    state,
    updatedAt,
    stale: providerIsStale(state, updatedAt, now, staleAfterMs),
    session: normalizeWindow(value?.session),
    weekly: normalizeWindow(value?.weekly),
  }
}

function normalizeCodex(value, now, staleAfterMs) {
  const state = PROVIDER_STATES.has(value?.state) ? value.state : 'unavailable'
  const updatedAt = isoDate(value?.updatedAt)
  return {
    state,
    updatedAt,
    stale: providerIsStale(state, updatedAt, now, staleAfterMs),
    weekly: normalizeWindow(value?.weekly, { includeDuration: true }),
    limitReached: value?.limitReached === true,
  }
}

export function normalizeAionUiSubscriptionUsage(value, {
  now = Date.now(),
  staleAfterMs = 180_000,
} = {}) {
  if (!value || typeof value !== 'object' || value.schemaVersion !== 1) {
    return {
      available: false,
      state: 'unavailable',
      generatedAt: null,
      updatedAt: null,
      retryAfterMs: null,
      claude: null,
      codex: null,
    }
  }

  const retryAfterMs = Number(value.retryAfterMs)
  return {
    available: true,
    state: SNAPSHOT_STATES.has(value.state) ? value.state : 'unavailable',
    generatedAt: isoDate(value.generatedAt),
    updatedAt: isoDate(value.updatedAt),
    retryAfterMs: Number.isFinite(retryAfterMs) && retryAfterMs > 0
      ? Math.max(1_000, Math.min(60_000, retryAfterMs))
      : null,
    claude: normalizeClaude(value.claude, now, staleAfterMs),
    codex: normalizeCodex(value.codex, now, staleAfterMs),
  }
}

export async function readAionUiSubscriptionUsage(filePath, {
  readText,
  now = Date.now(),
  staleAfterMs = 180_000,
} = {}) {
  try {
    const text = await readText(filePath)
    return normalizeAionUiSubscriptionUsage(JSON.parse(text), { now, staleAfterMs })
  } catch {
    return normalizeAionUiSubscriptionUsage(null, { now, staleAfterMs })
  }
}
