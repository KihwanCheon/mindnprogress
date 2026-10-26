import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { gzip, gunzip } from 'node:zlib'

const compress = promisify(gzip)
const decompress = promisify(gunzip)
const lifetimeMs = 30 * 24 * 60 * 60 * 1000

export async function readCompletedJobResults(sharedRoot, leases) {
  const records = {}
  if (!Object.keys(leases).length) return records
  const root = path.resolve(sharedRoot, 'job-results')
  for (const lease of Object.values(leases)) {
    if (!/^[a-zA-Z0-9_-]+$/.test(lease.jobId ?? '')) continue
    const file = path.resolve(root, `${lease.jobId}.json`)
    if (path.dirname(file) !== root) throw new Error('작업 결과 파일 경로가 올바르지 않습니다.')
    try { records[lease.jobId] = await readFile(file, 'utf8') } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  return records
}

// 운영 조회에 포함하지 않는 한시 복원본. 저장·동기화·재독 검증이 끝나야 삭제를 허용한다.
export async function saveHistoryCleanupBackup(directory, records, now = Date.now()) {
  await mkdir(directory, { recursive: true })
  const name = `cleanup-${now}-${randomUUID()}.json.gz`
  const file = path.join(directory, name)
  const temporary = file + '.tmp'
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, createdAt: new Date(now).toISOString(), ...records }), 'utf8')
  const digest = createHash('sha256').update(bytes).digest('hex')
  try {
    const handle = await open(temporary, 'wx', 0o600)
    try {
      await handle.writeFile(await compress(bytes))
      await handle.sync()
    } finally { await handle.close() }
    const restored = await decompress(await readFile(temporary))
    if (createHash('sha256').update(restored).digest('hex') !== digest) throw new Error('완료 이력 복원본 검증에 실패했습니다.')
    await rename(temporary, file)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
  return { file, sha256: digest }
}

// 복원은 운영 파일을 직접 쓰지 않고 현재 자료와 합칠 후보만 만든다. 현재 기록이 항상 우선한다.
export async function readHistoryCleanupBackup(file) {
  const backup = JSON.parse((await decompress(await readFile(file))).toString('utf8'))
  if (backup.schemaVersion !== 1 || !Array.isArray(backup.delegations)
    || !backup.localLeases || typeof backup.localLeases !== 'object' || Array.isArray(backup.localLeases)
    || !backup.remoteLeases || typeof backup.remoteLeases !== 'object' || Array.isArray(backup.remoteLeases)
    || backup.delegations.some((record) => !record.id || record.state !== 'completed')
    || [...Object.entries(backup.localLeases), ...Object.entries(backup.remoteLeases)]
      .some(([id, record]) => record.leaseId !== id || record.status !== 'completed')
    || Object.entries(backup.localResultFiles ?? {}).some(([id, text]) => !/^[a-zA-Z0-9_-]+$/.test(id) || typeof text !== 'string')) {
    throw new Error('완료 이력 복원본 형식이 올바르지 않습니다.')
  }
  return backup
}

export function mergeHistoryCleanupBackup(backup, current) {
  const delegations = new Map(backup.delegations.map((record) => [record.id, record]))
  for (const record of current.delegations) delegations.set(record.id, record)
  return {
    delegations: [...delegations.values()],
    local: { ...current.local, leases: { ...backup.localLeases, ...current.local.leases } },
    remote: { ...current.remote, leases: { ...backup.remoteLeases, ...current.remote.leases } },
  }
}

export async function pruneHistoryCleanupBackups(directory, now = Date.now()) {
  let entries
  try { entries = await readdir(directory, { withFileTypes: true }) } catch (error) {
    if (error.code === 'ENOENT') return 0
    throw error
  }
  let removed = 0
  const root = path.resolve(directory)
  for (const entry of entries) {
    if (!entry.isFile() || !/^cleanup-\d+-[a-f0-9-]+\.json\.gz$/.test(entry.name)) continue
    const file = path.resolve(root, entry.name)
    if (path.dirname(file) !== root) continue
    const info = await stat(file)
    if (now - info.mtimeMs < lifetimeMs) continue
    await rm(file)
    removed++
  }
  return removed
}
