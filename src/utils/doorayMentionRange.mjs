export const doorayMentionQuickRanges = [
  { id: 'today', calendarDays: 1, label: '오늘', title: '오늘 0시부터 현재까지' },
  { id: 'one-day', rollingHours: 24, label: '1일', title: '현재 시각 기준 최근 24시간' },
  { id: 'two-days', rollingHours: 48, label: '2일', title: '현재 시각 기준 최근 48시간' },
  { id: 'three-days', calendarDays: 3, label: '3일', title: '오늘을 포함한 최근 3개 날짜' },
  { id: 'seven-days', calendarDays: 7, label: '7일', title: '오늘을 포함한 최근 7개 날짜' },
  { id: 'thirty-days', calendarDays: 30, label: '30일', title: '오늘을 포함한 최근 30개 날짜' },
]

export function toLocalDateInputValue(date) {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

export function doorayMentionQuickRangeDates(rangeId, currentTime = new Date()) {
  const range = doorayMentionQuickRanges.find((candidate) => candidate.id === rangeId)
  if (!range) return null
  const start = new Date(currentTime)
  if (range.rollingHours) start.setTime(start.getTime() - range.rollingHours * 60 * 60 * 1_000)
  else start.setDate(start.getDate() - ((range.calendarDays ?? 1) - 1))
  return { since: toLocalDateInputValue(start), until: toLocalDateInputValue(currentTime) }
}

export function doorayMentionRequestRange({ quickRangeId, since, until }, currentTime = new Date()) {
  const range = doorayMentionQuickRanges.find((candidate) => candidate.id === quickRangeId)
  if (range?.rollingHours) {
    return {
      since: new Date(currentTime.getTime() - range.rollingHours * 60 * 60 * 1_000).toISOString(),
      until: currentTime.toISOString(),
    }
  }
  if (range?.calendarDays) {
    const start = new Date(currentTime)
    start.setDate(start.getDate() - (range.calendarDays - 1))
    start.setHours(0, 0, 0, 0)
    return { since: start.toISOString(), until: currentTime.toISOString() }
  }
  return {
    since: new Date(`${since}T00:00:00`).toISOString(),
    until: new Date(`${until}T23:59:59.999`).toISOString(),
  }
}
