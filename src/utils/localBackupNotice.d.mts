export type LocalBackupNotice = {
  mapId: string | null
  backupFailed: boolean
  serverFailed: boolean
  dismissed: boolean
}

export type LocalBackupNoticeEvent = {
  mapId: string | null
  type: 'open' | 'backup-failed' | 'backup-saved' | 'server-failed' | 'server-saved' | 'dismiss'
}

export function createLocalBackupNotice(mapId?: string | null): LocalBackupNotice
export function localBackupNoticeReducer(state: LocalBackupNotice, event: LocalBackupNoticeEvent): LocalBackupNotice
