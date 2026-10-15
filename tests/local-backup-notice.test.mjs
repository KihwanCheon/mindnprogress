import assert from 'node:assert/strict'
import test from 'node:test'
import { createLocalBackupNotice, localBackupNoticeReducer } from '../src/utils/localBackupNotice.mjs'

const next = (state, type, mapId = 'map-a') => localBackupNoticeReducer(state, { type, mapId })
const failed = () => next(createLocalBackupNotice('map-a'), 'backup-failed')

test('닫기는 실제 백업 실패 상태를 유지하며 동일 실패의 반복 표시만 막는다', () => {
  const dismissed = next(failed(), 'dismiss')
  assert.equal(dismissed.backupFailed, true)
  assert.equal(dismissed.dismissed, true)
  assert.equal(next(dismissed, 'backup-failed'), dismissed)
  assert.equal(next(dismissed, 'server-saved'), dismissed)
})

test('문서 재진입은 경고를 다시 표시하고 다른 문서에는 닫음 상태가 이어지지 않는다', () => {
  const dismissed = next(failed(), 'dismiss')
  assert.deepEqual(next(dismissed, 'open'), failed())
  assert.deepEqual(next(dismissed, 'open', 'map-b'), createLocalBackupNotice('map-b'))
  assert.equal(createLocalBackupNotice('map-a').dismissed, false, '페이지 재생성에는 닫음 상태가 없다.')
})

test('백업 복구 후 다시 실패하면 새로운 경고를 표시한다', () => {
  const recovered = next(next(failed(), 'dismiss'), 'backup-saved')
  assert.equal(recovered.backupFailed, false)
  assert.equal(recovered.dismissed, false)
  assert.deepEqual(next(recovered, 'backup-failed'), failed())
})

test('서버 저장까지 새로 실패하면 닫힌 경고를 다시 표시한다', () => {
  const escalated = next(next(failed(), 'dismiss'), 'server-failed')
  assert.equal(escalated.backupFailed, true)
  assert.equal(escalated.serverFailed, true)
  assert.equal(escalated.dismissed, false)
  const dismissedAgain = next(escalated, 'dismiss')
  assert.equal(next(dismissedAgain, 'server-failed'), dismissedAgain)
  assert.equal(next(dismissedAgain, 'backup-failed'), dismissedAgain)
  const recovered = next(dismissedAgain, 'server-saved')
  assert.equal(recovered.backupFailed, true, '서버 저장 성공은 로컬 백업 복구가 아니다.')
  assert.equal(next(recovered, 'server-failed').dismissed, false)
})

test('서버 실패 중에도 로컬 백업 복구와 재실패를 구분한다', () => {
  const recovered = next(next(failed(), 'server-failed'), 'backup-saved')
  assert.equal(recovered.serverFailed, true)
  assert.equal(recovered.backupFailed, false)
  const failedAgain = next(recovered, 'backup-failed')
  assert.equal(failedAgain.serverFailed, true)
  assert.equal(failedAgain.dismissed, false)
})

test('이전 문서의 늦은 저장 응답은 현재 문서의 경고를 바꾸지 않는다', () => {
  const dismissed = next(failed(), 'dismiss')
  for (const type of ['backup-failed', 'backup-saved', 'server-failed', 'server-saved', 'dismiss']) {
    assert.equal(next(dismissed, type, 'map-b'), dismissed)
  }
})
