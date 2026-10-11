import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { normalizeUntrackedMetaRecovery, preserveUntrackedMeta, consumePreservedMeta } from '../server/lib/workspaceMetaRecovery.mjs'

const relative = 'Assets/Scripts/Guard.cs.meta'
const guid = 'a15eb8176d53e3d4f868808613a85690'
const original = Buffer.from(`fileFormatVersion: 2\nguid: ${guid}`)
const canonical = `fileFormatVersion: 2\nguid: ${guid}\nMonoImporter:\n  executionOrder: 0\n`
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const mainCommit = 'c'.repeat(40), candidate = 'a'.repeat(40), sourceHead = 'b'.repeat(40)
const plan = { path: relative, expectedSha256: hash(original), mainCommit }

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'mnp-meta-recovery-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workerRoot = path.join(root, 'worker'), mainRoot = path.join(root, 'main'), sharedRoot = path.join(root, 'shared')
  await Promise.all([mkdir(path.join(workerRoot, 'Assets/Scripts'), { recursive: true }), mkdir(mainRoot), mkdir(sharedRoot)])
  const workerFile = path.join(workerRoot, relative)
  await writeFile(workerFile, original)
  const state = { mainHead: mainCommit, mainDirty: '', registered: canonical, blob: 'd'.repeat(40), currentBlob: 'd'.repeat(40), extraStatus: '', trackedMeta: false }
  const git = async (cwd, args) => {
    if (args[0] === 'status') {
      if (cwd === mainRoot) return state.mainDirty
      let exists = false
      try { await readFile(workerFile); exists = true } catch (error) { if (error.code !== 'ENOENT') throw error }
      return (exists ? `?? ${relative}\0` : '') + state.extraStatus
    }
    if (args[0] === 'branch') return 'mnp/integrate/job-test'
    if (args[0] === 'merge-base') return ''
    if (args[0] === 'show') return state.registered
    if (args[0] === 'ls-tree') return state.trackedMeta ? '100644 blob tracked\t' + relative : ''
    if (args[0] === 'rev-parse') {
      if (args[1] === '--git-path') return `.git/${args[2]}`
      if (args[1] === 'HEAD') return cwd === mainRoot ? state.mainHead : candidate
      return args[1].startsWith(mainCommit + ':') ? state.blob : state.currentBlob
    }
    throw new Error('예상하지 않은 Git 호출: ' + args.join(' '))
  }
  const lease = { leaseId: 'lease-test', jobId: 'job-test', workspaceId: 'fork1', poolId: 'holdem',
    mapId: 'map-test', cardId: 'card-test', conversationId: 'conversation-test', headCommit: sourceHead,
    integrationHeadCommit: candidate, integrationBranch: 'mnp/integrate/job-test', branch: 'mnp/job-test', baseCommit: 'f'.repeat(40) }
  await writeFile(path.join(workerRoot, '.ai-workspace.json'), JSON.stringify({ workspaceId: lease.workspaceId, projectRoot: workerRoot }))
  await writeFile(path.join(workerRoot, '.ai-session.json'), JSON.stringify({ ...lease, projectRoot: workerRoot }))
  const f = { git, workerRoot, mainRoot, sharedRoot, lease, plan, mainHead: mainCommit, candidate, workerFile, state }
  f.preserve = () => preserveUntrackedMeta(f)
  f.consume = () => consumePreservedMeta(f)
  f.prepare = async () => { lease.untrackedMetaRecovery = await f.preserve(); return lease.untrackedMetaRecovery }
  return f
}

test('승인된 메타는 접수 시 원문·해시·귀속을 보존하고 finalize에서만 이동한다', async t => {
  const f = await fixture(t)
  const record = await f.prepare()
  const backup = path.join(f.sharedRoot, record.archiveRelative, 'original.meta')
  assert.deepEqual(await readFile(backup), original)
  assert.deepEqual(await readFile(f.workerFile), original)
  assert.equal(record.sha256, plan.expectedSha256)
  assert.equal(record.bytes, 59)
  assert.equal(record.guid, guid)
  assert.equal((await f.consume()).phase, 'consumed')
  await assert.rejects(readFile(f.workerFile), { code: 'ENOENT' })
  assert.deepEqual(await readFile(backup), original)
})

test('이동 직후 풀 저장 전 재시작과 동일 해시 재생성은 원본을 잃지 않는다', async t => {
  const f = await fixture(t)
  const record = structuredClone(await f.prepare())
  await f.consume()
  f.lease.untrackedMetaRecovery = record
  assert.equal((await f.consume()).phase, 'consumed')
  await writeFile(f.workerFile, original)
  assert.equal((await f.consume()).phase, 'consumed')
  assert.deepEqual(await readFile(path.join(f.sharedRoot, record.archiveRelative, 'original.meta')), original)
})

for (const [name, value] of [
  ['다른 해시', { ...plan, expectedSha256: 'e'.repeat(64) }],
  ['경로 이탈', { ...plan, path: 'Assets/../Guard.cs.meta' }],
  ['임의 파일', { ...plan, path: 'Assets/file.txt' }],
  ['미지원 필드', { ...plan, automatic: true }],
  ['절대 경로', { ...plan, path: 'C:/Assets/Guard.cs.meta' }],
]) {
  test(`메타 보존은 ${name}을 거부하고 원본을 그대로 둔다`, async t => {
    const f = await fixture(t)
    f.plan = value
    await assert.rejects(f.preserve(), { reasonCode: 'INTEGRATION_RECOVERY_UNSAFE' })
    assert.deepEqual(await readFile(f.workerFile), original)
  })
}

for (const [name, update] of [
  ['다른 변경', f => { f.state.extraStatus = '?? other.txt\0' }],
  ['후보에 이미 있는 메타', f => { f.state.trackedMeta = true }],
  ['main HEAD 이동', f => { f.state.mainHead = 'e'.repeat(40) }],
  ['등록 GUID 불일치', f => { f.state.registered = canonical.replace(guid, 'f'.repeat(32)) }],
  ['등록 blob 변경', f => { f.state.mainHead = 'e'.repeat(40); f.state.currentBlob = 'e'.repeat(40) }],
]) {
  test(`메타 보존은 ${name}을 검증해 다른 변경을 정리하지 않는다`, async t => {
    const f = await fixture(t)
    update(f)
    await assert.rejects(f.preserve())
    assert.deepEqual(await readFile(f.workerFile), original)
  })
}

test('동일 GUID라도 importer 편집 내용이 있는 메타는 자동 생성본으로 취급하지 않는다', async t => {
  const f = await fixture(t)
  await writeFile(f.workerFile, canonical)
  f.plan = { ...plan, expectedSha256: hash(canonical) }
  await assert.rejects(f.preserve(), /형식/)
  assert.equal(await readFile(f.workerFile, 'utf8'), canonical)
})

for (const [name, update] of [
  ['원본 drift', async f => { await writeFile(f.workerFile, canonical) }],
  ['백업 손상', async f => { await writeFile(path.join(f.sharedRoot, f.lease.untrackedMetaRecovery.archiveRelative, 'original.meta'), '손상') }],
  ['main dirty', async f => { f.state.mainDirty = ' M base.txt' }],
  ['추가 파일', async f => { f.state.extraStatus = '?? other.txt\0' }],
  ['lease 변경', async f => { f.lease.leaseId = 'other' }],
  ['세션 변경', async f => { await writeFile(path.join(f.workerRoot, '.ai-session.json'), '{}') }],
  ['Git 잠금', async f => { await mkdir(path.join(f.workerRoot, '.git')); await writeFile(path.join(f.workerRoot, '.git/index.lock'), '잠금') }],
]) {
  test(`접수 후 ${name}이면 승인 파일도 이동하지 않는다`, async t => {
    const f = await fixture(t)
    await f.prepare()
    await update(f)
    const before = await readFile(f.workerFile)
    await assert.rejects(f.consume(), { reasonCode: 'INTEGRATION_RECOVERY_UNSAFE' })
    assert.deepEqual(await readFile(f.workerFile), before)
  })
}

test('메타 경로의 디렉터리 링크는 승인해도 따라가지 않는다', async t => {
  const f = await fixture(t)
  const external = path.join(f.workerRoot, 'outside')
  await mkdir(external)
  await writeFile(path.join(external, 'Guard.cs.meta'), original)
  await rm(path.join(f.workerRoot, 'Assets/Scripts'), { recursive: true })
  await symlink(external, path.join(f.workerRoot, 'Assets/Scripts'), 'junction')
  await assert.rejects(f.preserve(), /링크/)
  assert.deepEqual(await readFile(path.join(external, 'Guard.cs.meta')), original)
})

test('메타 옵션은 유일한 경로와 지문만 정규화한다', () => {
  assert.deepEqual(normalizeUntrackedMetaRecovery(plan), plan)
  assert.throws(() => normalizeUntrackedMetaRecovery(null), /형식/)
})
