export function createLocalBackupNotice(mapId = null) {
  return { mapId, backupFailed: false, serverFailed: false, dismissed: false }
}

// 실패 상태와 사용자가 안내를 닫은 상태는 별개다. 저장소에는 기록하지 않는다.
export function localBackupNoticeReducer(state, event) {
  if (event.type === 'open') {
    if (state.mapId !== event.mapId) return createLocalBackupNotice(event.mapId)
    return state.dismissed ? { ...state, dismissed: false } : state
  }
  if (state.mapId !== event.mapId) return state
  switch (event.type) {
    case 'backup-failed':
      return state.backupFailed ? state : { ...state, backupFailed: true }
    case 'backup-saved':
      return state.backupFailed || state.dismissed ? { ...state, backupFailed: false, dismissed: false } : state
    case 'server-failed':
      return state.serverFailed ? state : { ...state, serverFailed: true, dismissed: false }
    case 'server-saved':
      return state.serverFailed ? { ...state, serverFailed: false } : state
    case 'dismiss':
      return state.backupFailed && !state.dismissed ? { ...state, dismissed: true } : state
    default:
      return state
  }
}
