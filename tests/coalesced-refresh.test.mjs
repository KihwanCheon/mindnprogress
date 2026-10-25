import assert from 'node:assert/strict'
import test from 'node:test'
import { createCoalescedRefresh } from '../src/utils/coalescedRefresh.mjs'

test('연속 변경은 합치고 진행 중 추가 변경은 누락 없이 다음 조회에 반영한다', async () => {
  let calls = 0, release
  const refresh = createCoalescedRefresh(async () => {
    calls++
    if (calls === 1) await new Promise((resolve) => { release = resolve })
    return calls
  }, 1)
  const first = Array.from({ length: 20 }, () => refresh.request())
  while (!release) await new Promise((resolve) => setTimeout(resolve, 1))
  const next = refresh.request()
  release()
  assert.deepEqual(await Promise.all(first), Array(20).fill(1))
  assert.equal(await next, 2); assert.equal(calls, 2)
  refresh.dispose()
  await assert.rejects(refresh.request(), /종료/)
})
