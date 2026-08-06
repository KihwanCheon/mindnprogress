import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EVENT_STREAM_STALE_AFTER_MS,
  shouldReconnectEventStream,
} from '../src/utils/eventStreamHealth.mjs'

test('최근 heartbeat를 받은 연결은 유지한다', () => {
  assert.equal(shouldReconnectEventStream({
    lastEventAt: 10_000,
    now: 10_000 + EVENT_STREAM_STALE_AFTER_MS - 1,
  }), false)
})

test('화면이 보이는 동안 heartbeat가 오래 없으면 재연결한다', () => {
  assert.equal(shouldReconnectEventStream({
    lastEventAt: 10_000,
    now: 10_000 + EVENT_STREAM_STALE_AFTER_MS,
  }), true)
})

test('숨겨진 화면과 오프라인 상태에서는 불필요한 재연결을 하지 않는다', () => {
  assert.equal(shouldReconnectEventStream({ lastEventAt: 0, now: EVENT_STREAM_STALE_AFTER_MS, visibilityState: 'hidden' }), false)
  assert.equal(shouldReconnectEventStream({ lastEventAt: 0, now: EVENT_STREAM_STALE_AFTER_MS, online: false }), false)
})

test('온라인 복귀처럼 명시한 재연결은 heartbeat 시각과 관계없이 수행한다', () => {
  assert.equal(shouldReconnectEventStream({ lastEventAt: Date.now(), force: true }), true)
  assert.equal(shouldReconnectEventStream({ lastEventAt: 0, force: true, online: false }), false)
})
