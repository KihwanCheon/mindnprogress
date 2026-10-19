import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { backfillDailyBackupHistory } from '../server/lib/dailyBackupHistory.mjs'
import { replaceFileWithRetry } from '../server/lib/replaceFileWithRetry.mjs'

const day = value => new Date(new Date(value).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
const validMap = map => Array.isArray(map?.nodes) && Array.isArray(map?.edges)

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(value), 'utf8')
}

async function fixture(t, mapId = 'map-history-test', sharedDirectory) {
  const dataDirectory = sharedDirectory ?? await mkdtemp(path.join(tmpdir(), 'mnp-daily-history-'))
  if (!sharedDirectory) t.after(() => rm(dataDirectory, { recursive: true, force: true }))
  const map = { id: mapId, title: '현재 문서', nodes: [], edges: [], updatedAt: '2026-10-03T02:00:00Z', updatedBy: { id: 'editor' } }
  const indexFile = path.join(dataDirectory, '_migrations', 'daily-backup-history-v1', `${mapId}.json`)
  const historyDirectory = path.join(dataDirectory, '_history', mapId)
  const backupFile = date => path.join(dataDirectory, '_daily-backups', mapId, `${date}.json`)
  const historyReads = []
  const options = {
    dataDirectory, map,
    isValidMapId: id => /^[a-z0-9][a-z0-9-]{0,79}$/.test(id),
    isValidRevisionId: id => /^[a-z0-9-]{8,80}$/.test(id),
    isValidMap: validMap, dateString: day,
    readText: async (file, encoding) => {
      if (path.dirname(file) === historyDirectory) historyReads.push(path.basename(file))
      return readFile(file, encoding)
    },
    writeBackup: async (snapshot, user, date) => {
      const file = backupFile(date)
      try { await stat(file); return null } catch (error) { if (error.code !== 'ENOENT') throw error }
      const backup = { mapId, date, map: snapshot, backedUpBy: user }
      await writeJson(file, backup)
      return backup
    },
    writeIndex: async (file, value) => {
      const temporary = `${file}.tmp`
      await writeJson(temporary, value)
      await replaceFileWithRetry(temporary, file)
    },
  }
  const revision = async (name, updatedAt, title = name, overrides = {}) => {
    const file = path.join(historyDirectory, `${name}.json`)
    await writeJson(file, { mapId, archivedAt: '2026-10-04T00:00:00Z', archivedBy: { id: 'history-editor' },
      map: { ...map, title, updatedAt }, ...overrides })
    return file
  }
  const run = overrides => backfillDailyBackupHistory({ ...options, ...overrides })
  return { dataDirectory, map, options, indexFile, historyDirectory, backupFile, historyReads, revision, run }
}

test('최초 보정은 서울 날짜별 최신 원본을 선택하고 현재 문서와 기존 백업을 보존한다', async t => {
  const f = await fixture(t)
  await f.revision('revision-old', '2026-09-30T15:10:00Z', '10월 1일 이전 내용')
  await f.revision('revision-new', '2026-10-01T04:00:00Z', '10월 1일 최신 내용')
  await f.revision('revision-two', '2026-10-01T15:00:00Z', '덮어쓰면 안 되는 후보')
  await f.revision('revision-other', '2026-09-29T00:00:00Z', '다른 문서', { mapId: 'map-other' })
  await f.revision('revision-invalid', '2026-09-29T00:00:00Z', '', { map: { nodes: null } })
  await writeJson(path.join(f.historyDirectory, 'unfinished.json.tmp'), { incomplete: true })
  const preserved = { mapId: f.map.id, date: '2026-10-02', map: { ...f.map, title: '이미 저장된 백업' } }
  await writeJson(f.backupFile('2026-10-02'), preserved)
  const original = JSON.stringify(f.map)
  const result = await f.run()
  assert.equal(result.created, 2)
  assert.equal(JSON.parse(await readFile(f.backupFile('2026-10-01'), 'utf8')).map.title, '10월 1일 최신 내용')
  assert.deepEqual(JSON.parse(await readFile(f.backupFile('2026-10-02'), 'utf8')), preserved)
  assert.deepEqual(JSON.parse(await readFile(f.backupFile('2026-10-03'), 'utf8')).map, f.map)
  assert.equal(JSON.stringify(f.map), original)
  const index = JSON.parse(await readFile(f.indexFile, 'utf8'))
  assert.equal(Object.keys(index.revisions).length, 5)
  assert.equal(index.revisions['revision-invalid.json'].date, null)
  assert.equal(index.revisions['revision-other.json'].date, null)
  assert.equal(index.schemaVersion, 1)
})

test('다음 기동은 보정된 이력 본문을 한 번도 읽거나 인덱스를 다시 쓰지 않는다', async t => {
  const f = await fixture(t)
  for (let i = 0; i < 256; i += 1) await f.revision(`revision-${String(i).padStart(4, '0')}`, '2026-10-01T01:00:00Z', `이력 ${i} ${'가'.repeat(2048)}`)
  const first = await f.run()
  const indexBefore = await readFile(f.indexFile, 'utf8')
  f.historyReads.length = 0
  const second = await f.run({ writeIndex: () => assert.fail('변경 없는 인덱스를 다시 저장하면 안 됩니다.') })
  assert.equal(second.created, 0)
  assert.equal(second.historyReadCount, 0)
  assert.equal(second.reusedHistoryCount, 256)
  assert.equal(second.indexWritten, false)
  assert.deepEqual(f.historyReads, [])
  assert.equal(await readFile(f.indexFile, 'utf8'), indexBefore)
  t.diagnostic(`이력 256개: 최초 본문 읽기 ${first.historyReadCount}회 → 반복 기동 ${second.historyReadCount}회`)
})

test('추가된 이력만 읽으며 같은 날짜의 기존 백업은 덮어쓰지 않는다', async t => {
  const f = await fixture(t)
  await f.revision('revision-original', '2026-10-01T01:00:00Z', '원본')
  await f.run()
  const preserved = await readFile(f.backupFile('2026-10-01'), 'utf8')
  await f.revision('revision-later', '2026-10-01T02:00:00Z', '같은 날짜의 후속 이력')
  await f.revision('revision-import', '2026-09-20T01:00:00Z', '뒤늦게 반입된 과거 이력')
  f.historyReads.length = 0
  const result = await f.run()
  assert.equal(result.created, 1)
  assert.equal(result.reusedHistoryCount, 1)
  assert.ok(!f.historyReads.includes('revision-original.json'))
  assert.equal(await readFile(f.backupFile('2026-10-01'), 'utf8'), preserved)
  assert.equal(JSON.parse(await readFile(f.backupFile('2026-09-20'), 'utf8')).map.title, '뒤늦게 반입된 과거 이력')
})

test('누락된 백업만 최신 이력에서 복원하고 다른 과거 본문은 읽지 않는다', async t => {
  const f = await fixture(t)
  await f.revision('revision-old', '2026-10-01T01:00:00Z', '이전')
  await f.revision('revision-new', '2026-10-01T03:00:00Z', '최신')
  await f.revision('revision-other', '2026-10-02T01:00:00Z', '다른 날')
  await f.run()
  await rm(f.backupFile('2026-10-01'))
  f.historyReads.length = 0
  const result = await f.run()
  assert.equal(result.created, 1)
  assert.deepEqual(f.historyReads, ['revision-new.json'])
  assert.equal(JSON.parse(await readFile(f.backupFile('2026-10-01'), 'utf8')).map.title, '최신')
})

test('수정 시각을 유지한 이력 교체도 변경 메타데이터로 감지하고 삭제된 이력은 인덱스에서만 제외한다', async t => {
  const f = await fixture(t)
  const source = await f.revision('revision-changed', '2026-10-01T01:00:00Z', '교체 전')
  const removed = await f.revision('revision-removed', '2026-10-02T01:00:00Z', '보존할 백업')
  await f.run()
  const before = await stat(source)
  await f.revision('revision-changed', '2026-09-29T01:00:00Z', '교체 후')
  await utimes(source, before.atime, before.mtime)
  await rm(removed)
  f.historyReads.length = 0
  const result = await f.run()
  assert.ok(result.historyReadCount > 0)
  assert.equal(JSON.parse(await readFile(f.backupFile('2026-09-29'), 'utf8')).map.title, '교체 후')
  assert.equal(JSON.parse(await readFile(f.backupFile('2026-10-02'), 'utf8')).map.title, '보존할 백업')
  const index = JSON.parse(await readFile(f.indexFile, 'utf8'))
  assert.deepEqual(Object.keys(index.revisions), ['revision-changed.json'])
})

test('인덱스 손상·스키마 불일치·삭제는 기존 백업을 보존하며 안전하게 재구축한다', async t => {
  const f = await fixture(t)
  await f.revision('revision-original', '2026-10-01T01:00:00Z')
  await f.run()
  const backupBefore = await readFile(f.backupFile('2026-10-01'), 'utf8')
  for (const corrupt of ['{', JSON.stringify({ schemaVersion: 99, revisions: {} }), JSON.stringify({ schemaVersion: 1, mapId: 'other', revisions: {} }), null]) {
    if (corrupt === null) await rm(f.indexFile)
    else await writeFile(f.indexFile, corrupt, 'utf8')
    f.historyReads.length = 0
    const result = await f.run()
    assert.equal(result.historyReadCount, 1)
    assert.equal(result.indexWritten, true)
    assert.equal(await readFile(f.backupFile('2026-10-01'), 'utf8'), backupBefore)
  }
})

test('백업 쓰기 실패 시 완료 기록을 남기지 않고 재시도는 이미 저장된 백업을 보존한다', async t => {
  const f = await fixture(t)
  await f.revision('revision-original', '2026-10-01T01:00:00Z')
  await assert.rejects(f.run({ writeBackup: async (map, user, date) => {
    if (date === '2026-10-03') throw Object.assign(new Error('격리 디스크 오류'), { code: 'ENOSPC' })
    return f.options.writeBackup(map, user, date)
  } }), { code: 'ENOSPC' })
  await assert.rejects(stat(f.indexFile), { code: 'ENOENT' })
  const stored = await readFile(f.backupFile('2026-10-01'), 'utf8')
  const result = await f.run()
  assert.equal(result.created, 1)
  assert.equal(await readFile(f.backupFile('2026-10-01'), 'utf8'), stored)
  assert.equal(result.indexWritten, true)
})

test('인덱스 저장 실패 후에도 완료 백업을 유지하고 다음 실행에서 인덱스만 재확정한다', async t => {
  const f = await fixture(t)
  await f.revision('revision-original', '2026-10-01T01:00:00Z')
  await f.run()
  const indexBefore = await readFile(f.indexFile, 'utf8')
  await f.revision('revision-added', '2026-10-02T01:00:00Z')
  await assert.rejects(f.run({ writeIndex: async () => { throw Object.assign(new Error('격리 저장 거부'), { code: 'EACCES' }) } }), { code: 'EACCES' })
  assert.equal(await readFile(f.indexFile, 'utf8'), indexBefore)
  const stored = await readFile(f.backupFile('2026-10-02'), 'utf8')
  const result = await f.run()
  assert.equal(result.created, 0)
  assert.equal(result.historyReadCount, 1)
  assert.equal(await readFile(f.backupFile('2026-10-02'), 'utf8'), stored)
})

test('원본 JSON 손상이나 인덱스 읽기 권한 오류를 완료로 숨기지 않는다', async t => {
  const f = await fixture(t)
  const source = await f.revision('revision-original', '2026-10-01T01:00:00Z')
  await writeFile(source, '{', 'utf8')
  await assert.rejects(f.run(), SyntaxError)
  await assert.rejects(stat(f.indexFile), { code: 'ENOENT' })
  await assert.rejects(f.run({ readText: async () => { throw Object.assign(new Error('읽기 거부'), { code: 'EACCES' }) } }), { code: 'EACCES' })
})

test('읽는 도중 원본이 변경되면 성공 인덱스를 남기지 않는다', async t => {
  const f = await fixture(t)
  const source = await f.revision('revision-original', '2026-10-01T01:00:00Z')
  await assert.rejects(f.run({ readText: async (file, encoding) => {
    const text = await readFile(file, encoding)
    if (file === source) await writeFile(file, text + ' ', 'utf8')
    return text
  } }), /이력 파일이 변경/)
  await assert.rejects(stat(f.indexFile), { code: 'ENOENT' })
})

test('이력이 없는 새 문서도 현재 스냅샷을 보존하고 다음 날짜는 정상 추가한다', async t => {
  const f = await fixture(t)
  assert.equal((await f.run()).created, 1)
  f.map.updatedAt = '2026-10-04T01:00:00Z'
  const result = await f.run()
  assert.equal(result.created, 1)
  assert.equal(result.historyReadCount, 0)
  await stat(f.backupFile('2026-10-03'))
  await stat(f.backupFile('2026-10-04'))
})

test('문서 간 완료 인덱스가 섞이지 않고 잘못된 문서 경로를 거부한다', async t => {
  const first = await fixture(t, 'map-first')
  const second = await fixture(t, 'map-second', first.dataDirectory)
  await first.revision('revision-original', '2026-10-01T01:00:00Z')
  await first.run()
  await second.revision('revision-original', '2026-10-02T01:00:00Z')
  assert.ok((await second.run()).historyReadCount > 0)
  assert.equal((await first.run()).historyReadCount, 0)
  await assert.rejects(first.run({ map: { ...first.map, id: '../outside' } }), /유효한 문서/)
})

test('이력의 내부 문서 ID가 다르면 다른 문서의 백업을 쓰지 않는다', async t => {
  const f = await fixture(t)
  await f.revision('revision-mismatch', '2026-10-01T01:00:00Z', '', { map: { ...f.map, id: 'map-other' } })
  let writes = 0
  await assert.rejects(f.run({ writeBackup: async () => { writes += 1 } }), /문서 ID/)
  assert.equal(writes, 0)
  await assert.rejects(stat(f.indexFile), { code: 'ENOENT' })
})
