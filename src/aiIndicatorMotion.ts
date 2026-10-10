export type AiIndicatorMotion = 'system' | 'always'

export const AI_INDICATOR_MOTION_STORAGE_KEY = 'mindnprogress-ai-indicator-motion'

export function storedAiIndicatorMotion(value: string | null): AiIndicatorMotion {
  return value === 'always' ? 'always' : 'system'
}

export function initialAiIndicatorMotion(): AiIndicatorMotion {
  try {
    return storedAiIndicatorMotion(localStorage.getItem(AI_INDICATOR_MOTION_STORAGE_KEY))
  } catch {
    return 'system'
  }
}

export function applyAiIndicatorMotion(motion: AiIndicatorMotion, persist = false) {
  document.documentElement.dataset.aiIndicatorMotion = motion
  if (!persist) return
  try {
    localStorage.setItem(AI_INDICATOR_MOTION_STORAGE_KEY, motion)
  } catch {
    // 저장이 제한된 브라우저에서도 현재 탭의 선택은 유지한다.
  }
}
