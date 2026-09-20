// 알림 목록의 제목 문구. AI 위임 알림은 차단(⛔)과 완료(✅)를 타입으로 구분해 한눈에 알아볼 수 있게 한다.
export function notificationTitle(notification) {
  const actor = String(notification?.actor?.name ?? '').trim()
  switch (notification?.type) {
    case 'assignment':
      return `${actor}님이 담당자로 지정했습니다.`
    case 'schedule':
      return '담당 업무 일정 알림'
    case 'waiting-released':
      return `${actor}님이 외부 대기를 해제했습니다.`
    case 'ai-delegation':
      return '⛔ AI 위임 차단 알림'
    case 'ai-delegation-completed':
      return '✅ AI 위임 완료 알림'
    case 'mention':
      return `${actor}님이 회원님을 멘션했습니다.`
    case 'reply':
      return `${actor}님이 답글을 남겼습니다.`
    default:
      return `${actor}님이 댓글을 남겼습니다.`
  }
}
