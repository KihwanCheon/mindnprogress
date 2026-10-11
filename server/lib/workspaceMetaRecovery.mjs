import { createHash, randomBytes } from 'node:crypto'
import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

function unsafe(message) {
  throw Object.assign(new Error(message), {
    code: 'WORKSPACE_POOL_UNAVAILABLE', reasonCode: 'INTEGRATION_RECOVERY_UNSAFE',
  })
}
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

export function normalizeUntrackedMetaRecovery(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['path', 'expectedSha256', 'mainCommit'].includes(key))) unsafe('메타 보존 승인 형식이 올바르지 않습니다.')
  const relative = value.path
  if (typeof relative !== 'string' || !/^Assets\/.+\.cs\.meta$/.test(relative)
    || /[\\:*?[\]]/.test(relative) || [...relative].some(char => char.charCodeAt(0) < 32)
    || relative.split('/').some(segment => !segment || segment === '.' || segment === '..')
    || !/^[a-f0-9]{64}$/.test(value.expectedSha256 ?? '')
    || !/^[a-f0-9]{40}$/.test(value.mainCommit ?? '')) unsafe('정확한 Assets 스크립트 메타 경로·SHA-256·main 커밋이 필요합니다.')
  return { path: relative, expectedSha256: value.expectedSha256, mainCommit: value.mainCommit }
}

async function regularPath(root, relative, allowMissing = false) {
  const segments = relative.split('/')
  let current = root
  const rootInfo = await lstat(current)
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) unsafe('메타 보존 경로에 링크가 있습니다.')
  for (let index = 0; index < segments.length; index++) {
    current = path.join(current, segments[index])
    let info
    try { info = await lstat(current) } catch (error) {
      if (allowMissing && index === segments.length - 1 && error.code === 'ENOENT') return null
      throw error
    }
    if (info.isSymbolicLink() || (index < segments.length - 1 ? !info.isDirectory() : !info.isFile())) unsafe('메타 보존 대상은 링크가 없는 일반 파일이어야 합니다.')
    if (index === segments.length - 1 && info.size > 65_536) unsafe('메타 보존 대상의 크기가 허용 범위를 넘었습니다.')
  }
  return current
}

// GUID만 같다고 파일 전체가 같거나 사용자 편집이 아니라고 판단하지 않는다.
// 명시적인 경로·원본 해시 승인과 두 줄짜리 자동 생성 형식 모두 필요하다.
export async function inspectUntrackedMeta({ git, workerRoot, mainRoot, plan, candidate, sourceHead, allowMissing = false }) {
  plan = normalizeUntrackedMetaRecovery(plan)
  const status = await git(workerRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  if (status !== `?? ${plan.path}\0` && !(allowMissing && status === '')) unsafe('승인된 메타 이외의 로컬 변경이 있거나 Git 상태가 변경됐습니다.')
  const mainHead = await git(mainRoot, ['rev-parse', 'HEAD'])
  await git(mainRoot, ['merge-base', '--is-ancestor', plan.mainCommit, mainHead])
  const [registeredBlob, currentBlob, registered, oldPath, sourcePath] = await Promise.all([
    git(mainRoot, ['rev-parse', `${plan.mainCommit}:${plan.path}`]),
    git(mainRoot, ['rev-parse', `${mainHead}:${plan.path}`]),
    git(mainRoot, ['show', `${plan.mainCommit}:${plan.path}`]),
    git(workerRoot, ['ls-tree', candidate, '--', plan.path]),
    git(workerRoot, ['ls-tree', sourceHead, '--', plan.path]),
  ])
  if (registeredBlob !== currentBlob || oldPath || sourcePath) unsafe('main 등록 메타 또는 보존된 source·후보의 초기 부재 상태가 달라졌습니다.')
  const registeredGuid = /^guid: ([a-f0-9]{32})\r?$/m.exec(registered)?.[1]
  if (!registeredGuid || !/^MonoImporter:\r?$/m.test(registered)) unsafe('main의 등록 메타 GUID·MonoImporter를 확인할 수 없습니다.')
  const file = await regularPath(workerRoot, plan.path, allowMissing)
  if (!file) return { plan, status, registeredBlob, registeredGuid, bytes: null }
  const bytes = await readFile(file)
  const generatedGuid = /^fileFormatVersion: 2\r?\nguid: ([a-f0-9]{32})(?:\r?\n)?$/.exec(bytes.toString('utf8'))?.[1]
  if (sha256(bytes) !== plan.expectedSha256 || generatedGuid !== registeredGuid) unsafe('승인한 자동 생성 메타의 원본 해시·형식·GUID가 변경됐습니다.')
  return { plan, status, registeredBlob, registeredGuid, bytes }
}

export async function preserveUntrackedMeta({ git, workerRoot, mainRoot, sharedRoot, lease, plan, mainHead, candidate }) {
  plan = normalizeUntrackedMetaRecovery(plan)
  if (plan.mainCommit !== mainHead || await git(mainRoot, ['rev-parse', 'HEAD']) !== mainHead) unsafe('메타 보존 승인 이후 main HEAD가 변경됐습니다. 최신 기준으로 다시 승인하세요.')
  const inspected = await inspectUntrackedMeta({ git, workerRoot, mainRoot, plan,
    candidate, sourceHead: lease.headCommit })
  const archiveRelative = `workspace-drift/${lease.workspaceId}/meta-recovery-${randomBytes(12).toString('hex')}`
  const archiveRoot = path.join(sharedRoot, archiveRelative)
  await mkdir(archiveRoot, { recursive: true })
  await regularPath(sharedRoot, `${archiveRelative}/original.meta`, true)
  await writeFile(path.join(archiveRoot, 'original.meta'), inspected.bytes, { flag: 'wx' })
  if (!(await readFile(path.join(archiveRoot, 'original.meta'))).equals(inspected.bytes)) unsafe('메타 원본 백업의 바이트 검증에 실패했습니다.')
  const record = { schemaVersion: 1, phase: 'preserved', plan, archiveRelative,
    poolId: lease.poolId, workspaceId: lease.workspaceId, jobId: lease.jobId, leaseId: lease.leaseId,
    mapId: lease.mapId, cardId: lease.cardId, conversationId: lease.conversationId,
    preservedBranch: lease.integrationBranch, preservedHead: candidate,
    sourceHead: lease.headCommit, gitStatus: inspected.status, bytes: inspected.bytes.length,
    sha256: plan.expectedSha256, registeredBlob: inspected.registeredBlob, guid: inspected.registeredGuid,
    preservedAt: new Date().toISOString() }
  await writeFile(path.join(archiveRoot, 'metadata.json'), `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' })
  return record
}

export async function consumePreservedMeta({ git, workerRoot, mainRoot, sharedRoot, lease }) {
  const record = lease.untrackedMetaRecovery
  if (!record || record.leaseId !== lease.leaseId || record.jobId !== lease.jobId
    || record.workspaceId !== lease.workspaceId || record.sourceHead !== lease.headCommit
    || record.mapId !== lease.mapId || record.cardId !== lease.cardId || record.conversationId !== lease.conversationId
    || typeof record.archiveRelative !== 'string'
    || !record.archiveRelative.startsWith(`workspace-drift/${lease.workspaceId}/`)
    || !/^meta-recovery-[a-f0-9]{24}$/.test(record.archiveRelative.split('/')[2] ?? '')
    || record.archiveRelative.split('/').length !== 3) unsafe('메타 보존 기록의 귀속을 확인할 수 없습니다.')
  const archiveRoot = path.join(sharedRoot, record.archiveRelative)
  const [workspace, session] = await Promise.all([
    readFile(path.join(workerRoot, '.ai-workspace.json'), 'utf8').then(JSON.parse),
    readFile(path.join(workerRoot, '.ai-session.json'), 'utf8').then(JSON.parse),
  ])
  const sameRoot = value => {
    const actual = path.resolve(String(value ?? ''))
    return process.platform === 'win32' ? actual.toLowerCase() === path.resolve(workerRoot).toLowerCase() : actual === path.resolve(workerRoot)
  }
  if (workspace.workspaceId !== lease.workspaceId || !sameRoot(workspace.projectRoot)
    || session.workspaceId !== lease.workspaceId || session.leaseId !== lease.leaseId || session.jobId !== lease.jobId
    || session.conversationId !== lease.conversationId || session.branch !== lease.branch
    || session.baseCommit !== lease.baseCommit || !sameRoot(session.projectRoot)) unsafe('메타 정리 전 작업공간 메타데이터 또는 AI 세션이 변경됐습니다.')
  const archiveFile = await regularPath(sharedRoot, `${record.archiveRelative}/original.meta`)
  const archived = await readFile(archiveFile)
  const metadataFile = await regularPath(sharedRoot, `${record.archiveRelative}/metadata.json`)
  const metadata = JSON.parse(await readFile(metadataFile, 'utf8'))
  if (sha256(archived) !== record.plan.expectedSha256
    || JSON.stringify(metadata.plan) !== JSON.stringify(record.plan) || metadata.leaseId !== lease.leaseId
    || metadata.preservedHead !== record.preservedHead || metadata.registeredBlob !== record.registeredBlob) unsafe('메타 원본 백업 또는 승인 기록이 변경됐습니다.')
  const [branch, head, mainDirty] = await Promise.all([
    git(workerRoot, ['branch', '--show-current']), git(workerRoot, ['rev-parse', 'HEAD']),
    git(mainRoot, ['status', '--porcelain=v1', '--untracked-files=no']),
  ])
  if (branch !== record.preservedBranch || head !== record.preservedHead || mainDirty) unsafe('메타 정리 전 보존된 후보 또는 main 추적 상태가 변경됐습니다.')
  await Promise.all([workerRoot, mainRoot].flatMap(root =>
    ['index.lock', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'REBASE_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer'].map(async entry => {
      const target = path.resolve(root, await git(root, ['rev-parse', '--git-path', entry]))
      try { await lstat(target); unsafe('메타 정리 전 Git 잠금 또는 진행 중인 Git 작업을 발견했습니다.') }
      catch (error) { if (error.code !== 'ENOENT') throw error }
    })))
  const inspected = await inspectUntrackedMeta({ git, workerRoot, mainRoot, plan: record.plan,
    candidate: record.preservedHead, sourceHead: record.sourceHead, allowMissing: true })
  if (inspected.registeredBlob !== record.registeredBlob) unsafe('main 메타의 등록 내용이 변경됐습니다.')
  if (inspected.bytes) {
    // 원본을 삭제하는 대신 고유 경로로 원자 이동한다. 경계에서 바뀐 파일도 보존하며 덮어쓰지 않는다.
    const moved = `removed-${randomBytes(12).toString('hex')}.meta`
    await rename(path.join(workerRoot, record.plan.path), path.join(archiveRoot, moved))
    const movedHash = sha256(await readFile(path.join(archiveRoot, moved)))
    await writeFile(path.join(archiveRoot, `${moved}.json`), JSON.stringify({ moved, sha256: movedHash, at: new Date().toISOString() }), { flag: 'wx' })
    if (movedHash !== record.plan.expectedSha256) unsafe('정리 경계에서 메타가 변경되어 격리를 유지합니다. 이동된 원문도 복구 폴더에 보존했습니다.')
  }
  record.phase = 'consumed'
  record.consumedAt = new Date().toISOString()
  return record
}
