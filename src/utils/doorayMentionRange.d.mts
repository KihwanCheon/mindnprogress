export type DoorayMentionQuickRange = {
  id: string
  label: string
  title: string
  rollingHours?: number
  calendarDays?: number
}

export const doorayMentionQuickRanges: DoorayMentionQuickRange[]

export function toLocalDateInputValue(date: Date): string

export function doorayMentionQuickRangeDates(
  rangeId: string,
  currentTime?: Date,
): { since: string; until: string } | null

export function doorayMentionRequestRange(
  range: { quickRangeId: string | null; since: string; until: string },
  currentTime?: Date,
): { since: string; until: string }
