import assert from 'node:assert/strict'
import test from 'node:test'

import {
  doorayMentionQuickRangeDates,
  doorayMentionRequestRange,
  toLocalDateInputValue,
} from '../src/utils/doorayMentionRange.mjs'

test('저장된 1일 빠른 기간은 다음 날 다시 열면 오늘 기준 날짜로 이동한다', () => {
  const firstDay = new Date(2026, 8, 15, 23, 30)
  const nextDay = new Date(2026, 8, 16, 0, 30)

  assert.deepEqual(doorayMentionQuickRangeDates('one-day', firstDay), {
    since: toLocalDateInputValue(new Date(firstDay.getTime() - 24 * 60 * 60 * 1_000)),
    until: toLocalDateInputValue(firstDay),
  })
  assert.deepEqual(doorayMentionQuickRangeDates('one-day', nextDay), {
    since: toLocalDateInputValue(new Date(nextDay.getTime() - 24 * 60 * 60 * 1_000)),
    until: toLocalDateInputValue(nextDay),
  })
  assert.notDeepEqual(
    doorayMentionQuickRangeDates('one-day', firstDay),
    doorayMentionQuickRangeDates('one-day', nextDay),
  )
})

test('수집 직전의 1일 기간은 저장된 날짜가 아니라 현재 시각의 최근 24시간으로 계산한다', () => {
  const currentTime = new Date(2026, 8, 16, 11, 30)
  const range = doorayMentionRequestRange({
    quickRangeId: 'one-day',
    since: '2026-09-14',
    until: '2026-09-15',
  }, currentTime)

  assert.equal(range.since, new Date(currentTime.getTime() - 24 * 60 * 60 * 1_000).toISOString())
  assert.equal(range.until, currentTime.toISOString())
})

test('사용자가 직접 입력한 날짜는 빠른 기간처럼 자동 변경하지 않는다', () => {
  const range = doorayMentionRequestRange({
    quickRangeId: null,
    since: '2026-09-10',
    until: '2026-09-12',
  }, new Date(2026, 8, 16, 11, 30))

  assert.equal(range.since, new Date('2026-09-10T00:00:00').toISOString())
  assert.equal(range.until, new Date('2026-09-12T23:59:59.999').toISOString())
})
