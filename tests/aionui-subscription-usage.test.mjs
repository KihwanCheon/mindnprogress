import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeAionUiSubscriptionUsage,
  readAionUiSubscriptionUsage,
} from '../server/lib/aionUiSubscriptionUsage.mjs'

const NOW = Date.parse('2026-07-31T03:00:00.000Z')

function readySnapshot() {
  return {
    schemaVersion: 1,
    state: 'ready',
    generatedAt: '2026-07-31T02:59:56.000Z',
    updatedAt: '2026-07-31T02:59:51.000Z',
    retryAfterMs: null,
    claude: {
      state: 'ready',
      updatedAt: '2026-07-31T02:59:51.000Z',
      session: { usedPercent: 0, resetsAt: '2026-07-31T04:30:00.000Z' },
      weekly: { usedPercent: 24, resetsAt: '2026-08-04T12:00:00.000Z' },
    },
    codex: {
      state: 'ready',
      updatedAt: '2026-07-31T02:59:45.000Z',
      weekly: {
        usedPercent: 31,
        resetsAt: '2026-08-05T04:09:16.000Z',
        windowDurationMins: 10080,
      },
      limitReached: false,
    },
  }
}

test('AionUi 사용량 스냅샷을 표시용 구조로 정규화한다', () => {
  const usage = normalizeAionUiSubscriptionUsage(readySnapshot(), { now: NOW })

  assert.equal(usage.available, true)
  assert.equal(usage.state, 'ready')
  assert.equal(usage.claude.session.usedPercent, 0)
  assert.equal(usage.claude.weekly.usedPercent, 24)
  assert.equal(usage.codex.weekly.usedPercent, 31)
  assert.equal(usage.codex.weekly.windowDurationMins, 10080)
  assert.equal(usage.claude.stale, false)
  assert.equal(usage.codex.stale, false)
})

test('Provider별 갱신 시각이 180초를 넘으면 오래된 정보로 표시한다', () => {
  const snapshot = readySnapshot()
  snapshot.claude.updatedAt = '2026-07-31T02:56:59.000Z'
  snapshot.codex.updatedAt = '2026-07-31T02:57:01.000Z'

  const usage = normalizeAionUiSubscriptionUsage(snapshot, { now: NOW, staleAfterMs: 180_000 })

  assert.equal(usage.claude.stale, true)
  assert.equal(usage.codex.stale, false)
})

test('로딩 재확인 간격은 안전한 범위로 제한한다', () => {
  const snapshot = readySnapshot()
  snapshot.state = 'loading'
  snapshot.retryAfterMs = 200

  const usage = normalizeAionUiSubscriptionUsage(snapshot, { now: NOW })
  assert.equal(usage.retryAfterMs, 1_000)
})

test('파일이 없거나 JSON이 손상되면 조용히 사용할 수 없는 상태를 반환한다', async () => {
  const missing = await readAionUiSubscriptionUsage('missing.json', {
    readText: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }) },
    now: NOW,
  })
  const invalid = await readAionUiSubscriptionUsage('invalid.json', {
    readText: async () => '{',
    now: NOW,
  })

  assert.equal(missing.available, false)
  assert.equal(invalid.available, false)
  assert.equal(missing.state, 'unavailable')
})

test('정의되지 않은 상태와 잘못된 값을 외부 응답에 그대로 노출하지 않는다', () => {
  const snapshot = readySnapshot()
  snapshot.state = 'unexpected'
  snapshot.claude.state = 'unexpected'
  snapshot.claude.session.usedPercent = 140
  snapshot.codex.weekly.resetsAt = 'not-a-date'

  const usage = normalizeAionUiSubscriptionUsage(snapshot, { now: NOW })

  assert.equal(usage.state, 'unavailable')
  assert.equal(usage.claude.state, 'unavailable')
  assert.equal(usage.claude.session.usedPercent, 100)
  assert.equal(usage.codex.weekly.resetsAt, null)
})
