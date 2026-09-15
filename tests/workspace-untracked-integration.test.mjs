import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import test, { describe } from 'node:test'
import {
  WorkspacePoolManager, integrationUntrackedCollisionReasonCode, legacyUntrackedIntegrationHead,
} from '../server/lib/workspacePool.mjs'

const exec = promisify(execFile)
const realGit = { skip: process.env.MNP_REAL_GIT_TEST !== '1' && 'MNP_REAL_GIT_TEST=1일 때 실행' }
const assetPaths = ['Assets/번역 자료/I2LanguagesJP.asset', 'Assets/번역 자료/I2LanguagesJP.asset.meta']
const commitMessage = {
  summary: '통합 재시도 검증', background: '미추적 충돌을 재현합니다.',
  cause: '통합 경로에 사용자 파일이 있습니다.', changes: '검증용 번역 파일을 추가합니다.',
}
async function git(cwd, args) {
  const result = await exec('git', args, { cwd, windowsHide: true, maxBuffer: 16 * 1024 * 1024 })
  return String(result.stdout ?? '').trim()
}
async function put(root, relative, content) {
  const target = path.join(root, relative)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, content)
}
async function fixture(t, files = assetPaths) {
  const root = await mkdtemp(path.join(tmpdir(), 'mnp-untracked-integration-'))
  t.after(async () => {
    assert.ok(path.resolve(root).startsWith(`${path.resolve(tmpdir())}${path.sep}mnp-untracked-integration-`))
    await rm(root, { recursive: true, force: true })
  })
  const main = path.join(root, 'main')
  const worker = path.join(root, 'worker')
  const sharedRoot = path.join(root, 'shared')
  await Promise.all([mkdir(main), mkdir(sharedRoot)])
  await git(main, ['init', '-b', 'japan-master'])
  async function config(cwd) {
    await git(cwd, ['config', 'user.name', 'MNP Test'])
    await git(cwd, ['config', 'user.email', 'mnp@example.invalid'])
    await git(cwd, ['config', 'core.autocrlf', 'false'])
    await git(cwd, ['config', 'core.hooksPath', path.join(root, 'no-hooks')])
  }
  await config(main)
  await put(main, '.gitignore', '/.ai-session.json\n/.ai-workspace.json\n')
  await put(main, 'base.txt', 'base\n')
  await git(main, ['add', '.'])
  await git(main, ['commit', '-m', 'base'])
  await git(root, ['clone', '--branch', 'japan-master', main, worker])
  await config(worker)
  await put(worker, '.ai-workspace.json', JSON.stringify({ workspaceId: 'fork2', projectRoot: worker }))
  const registryFile = path.join(sharedRoot, 'workspaces.json')
  const stateFile = path.join(root, 'state.json')
  await writeFile(registryFile, JSON.stringify({ schemaVersion: 1, poolId: 'holdem', sharedRoot,
    workspaces: [{ id: 'main', root: main, role: 'integration', enabled: true },
      { id: 'fork2', root: worker, role: 'worker', enabled: true }] }))
  const manager = new WorkspacePoolManager({ registryFile, stateFile })
  await manager.initialize()
  const lease = await manager.acquire({ workspaceHint: main, mapId: 'map-test', cardId: 'card-test', conversationId: 'conversation-test' })
  for (const relative of files) await put(worker, relative, `worker:${relative}\n`)
  await manager.checkpoint(lease.leaseId, { jobId: lease.jobId, mapId: 'map-test', cardId: 'card-test',
    conversationId: 'conversation-test', paths: files, commitMessage })
  return { root, main, worker, sharedRoot, registryFile, stateFile, manager, lease }
}

async function oldQuarantine(f) {
  const current = f.manager.state.leases[f.lease.leaseId]
  const head = current.integrationHeadCommit
  const error = new Error(`Command failed: git merge --ff-only ${head}\nerror: The following untracked working tree files would be overwritten by merge:\n\t${assetPaths.join('\n\t')}\nPlease move or remove them before you merge.\nAborting\n`)
  await f.manager.quarantineIntegrationFailure(current, { id: 'fork2', root: f.worker }, error, { childStatus: 'completed', childError: null })
  // 구버전에는 integrationHeadCommit이 없었다. 오류에 기록된 커밋을 검증해 복구해야 한다.
  delete current.integrationHeadCommit
  await f.manager.persist()
  return head
}

describe('미추적 파일 충돌 통합 복구', { concurrency: 3 }, () => {
test('충돌 경로 조회 지연은 격리가 아니라 다음 폴링 대기로 보존한다', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'mnp-untracked-probe-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const worker = { id: 'fork2', root: path.join(root, 'worker') }
  const lease = { leaseId: 'lease-test', jobId: 'job-test', workspaceId: worker.id,
    status: 'waiting-integration', baseBranch: 'japan-master', integrationHeadCommit: 'candidate',
    result: { reasonCode: integrationUntrackedCollisionReasonCode } }
  const manager = new WorkspacePoolManager({ stateFile: path.join(root, 'state.json'), registryFile: path.join(root, 'registry.json'),
    gitRunner: async (_cwd, _args, options) => {
      assert.ok(options.timeoutMs > 0)
      throw Object.assign(new Error('Git probe timeout'), { code: 'GIT_COMMAND_TIMEOUT' })
    } })
  manager.registry = { sharedRoot: root, workspaces: [worker], integration: { root: path.join(root, 'main') } }
  manager.state = { integrationLeaseId: lease.leaseId, leases: { [lease.leaseId]: lease }, workspaces: { fork2: { status: 'waiting-integration' } } }
  const waiting = await manager.finalize(lease.leaseId, { childStatus: 'completed' })
  assert.equal(waiting.status, 'waiting-integration')
  assert.equal(waiting.reasonCode, 'INTEGRATION_STATUS_RETRY')
  assert.equal(manager.state.integrationLeaseId, lease.leaseId)
  assert.equal(waiting.integrationHeadCommit, 'candidate')
})

test('과거 오류 분류는 완료된 fast-forward 미추적 충돌만 허용한다', () => {
  const result = { status: 'quarantined', childStatus: 'completed', integrationBranch: 'mnp/integrate/job-test',
    error: `Command failed: git merge --ff-only ${'a'.repeat(40)}\nerror: The following untracked working tree files would be overwritten by merge:\nfile` }
  assert.equal(legacyUntrackedIntegrationHead(result), 'a'.repeat(40))
  for (const patch of [{ childStatus: 'failed' }, { status: 'waiting-integration' }, { integratedCommit: 'abc' },
    { conflictRound: 1 }, { unmergedFiles: ['file'] }, { error: 'fatal: permission denied' }]) {
    assert.equal(legacyUntrackedIntegrationHead({ ...result, ...patch }), null)
  }
})

test('미추적 파일을 보존하며 대기하고 재시작·정리 후 동일 커밋을 한 번만 통합한다', realGit, async (t) => {
  const f = await fixture(t)
  for (const relative of assetPaths) await put(f.main, relative, `user:${relative}\n`)
  await put(f.main, 'unrelated.txt', '사용자 파일\n')
  const waiting = await f.manager.finalize(f.lease.leaseId, { childStatus: 'completed' })
  assert.equal(waiting.status, 'waiting-integration')
  assert.equal(waiting.reasonCode, integrationUntrackedCollisionReasonCode)
  assert.deepEqual(waiting.untrackedChanges, assetPaths)
  assert.equal(await git(f.main, ['rev-parse', 'HEAD']), f.lease.baseCommit)
  const candidate = waiting.integrationHeadCommit
  const workerBranch = await git(f.worker, ['branch', '--show-current'])
  const again = await f.manager.finalize(f.lease.leaseId, { childStatus: 'completed' })
  assert.equal(again.updatedAt, waiting.updatedAt)
  assert.equal(await git(f.worker, ['rev-parse', 'HEAD']), candidate)
  const restarted = new WorkspacePoolManager(f)
  await restarted.initialize()
  assert.equal(restarted.state.integrationLeaseId, f.lease.leaseId)
  for (let i = 0; i < assetPaths.length; i += 1) {
    assert.equal(await readFile(path.join(f.main, assetPaths[i]), 'utf8'), `user:${assetPaths[i]}\n`)
    await rename(path.join(f.main, assetPaths[i]), path.join(f.root, `backup-${i}`))
  }
  const completed = await restarted.finalize(f.lease.leaseId, { childStatus: 'completed' })
  assert.equal(completed.status, 'completed')
  assert.equal(completed.integratedCommit, candidate)
  assert.equal(await git(f.main, ['rev-parse', 'HEAD']), candidate)
  assert.equal(await git(f.worker, ['rev-parse', workerBranch]), candidate)
  assert.equal(await git(f.worker, ['branch', '--show-current']), 'mnp/idle/fork2')
  assert.equal(restarted.state.workspaces.fork2.status, 'idle')
  assert.equal(restarted.state.integrationLeaseId, null)
  await assert.rejects(readFile(path.join(f.worker, '.ai-session.json')), { code: 'ENOENT' })
  for (const relative of assetPaths) assert.equal(await readFile(path.join(f.main, relative), 'utf8'), `worker:${relative}\n`)
  assert.equal(await readFile(path.join(f.main, 'unrelated.txt'), 'utf8'), '사용자 파일\n')
  assert.deepEqual(await restarted.finalize(f.lease.leaseId, { childStatus: 'completed' }), completed)
})

test('과거 격리를 검증해 복구하고 위임 레코드 저장 전 재시작도 이어 처리한다', realGit, async (t) => {
  const f = await fixture(t)
  await put(f.main, assetPaths[0], '사용자 데이터\n')
  await f.manager.finalize(f.lease.leaseId, { childStatus: 'completed' })
  const candidate = await oldQuarantine(f)
  const saved = structuredClone(f.manager.state.leases[f.lease.leaseId].result)
  const restarted = new WorkspacePoolManager(f)
  await restarted.initialize()
  const recovered = await restarted.recoverUntrackedIntegrationFailure(f.lease.leaseId)
  assert.equal(recovered.status, 'waiting-integration')
  assert.equal(recovered.recoveredFromQuarantine, true)
  assert.equal(recovered.integrationHeadCommit, candidate)
  assert.deepEqual(restarted.state.leases[f.lease.leaseId].integrationRecoveryHistory[0].previousResult, saved)
  const restartedAgain = new WorkspacePoolManager(f)
  await restartedAgain.initialize()
  assert.deepEqual(await restartedAgain.recoverUntrackedIntegrationFailure(f.lease.leaseId), recovered)
  restartedAgain.state.integrationLeaseId = 'another-integration'
  assert.deepEqual(await restartedAgain.finalize(f.lease.leaseId, { childStatus: 'completed' }), recovered)
  assert.equal(await git(f.main, ['rev-parse', 'HEAD']), f.lease.baseCommit)
  restartedAgain.state.integrationLeaseId = null
  await rename(path.join(f.main, assetPaths[0]), path.join(f.root, 'backup'))
  const completed = await restartedAgain.finalize(f.lease.leaseId, { childStatus: 'completed' })
  assert.equal(completed.integratedCommit, candidate)
  assert.equal(restartedAgain.state.workspaces.fork2.status, 'idle')
})

test('과거 격리의 세션·체크포인트·후보 HEAD·main 기준 불일치는 자동 복구하지 않는다', realGit, async (t) => {
  const f = await fixture(t)
  await put(f.main, assetPaths[0], '사용자 데이터\n')
  await f.manager.finalize(f.lease.leaseId, { childStatus: 'completed' })
  const waitingState = structuredClone(f.manager.state)
  await oldQuarantine(f)
  const original = structuredClone(f.manager.state)
  const sessionPath = path.join(f.worker, '.ai-session.json')
  const session = await readFile(sessionPath, 'utf8')
  await writeFile(sessionPath, JSON.stringify({ ...JSON.parse(session), leaseId: 'wrong' }))
  assert.equal(await f.manager.recoverUntrackedIntegrationFailure(f.lease.leaseId), null)
  assert.deepEqual(f.manager.state, original)
  await writeFile(sessionPath, session)
  f.manager.state.leases[f.lease.leaseId].checkpoints = []
  assert.equal(await f.manager.recoverUntrackedIntegrationFailure(f.lease.leaseId), null)
  f.manager.state = structuredClone(original)
  const lease = f.manager.state.leases[f.lease.leaseId]
  lease.result.error = lease.result.error.replace(/--ff-only [a-f0-9]{40}/, `--ff-only ${f.lease.baseCommit}`)
  assert.equal(await f.manager.recoverUntrackedIntegrationFailure(f.lease.leaseId), null)
  f.manager.state = structuredClone(original)
  await git(f.main, ['commit', '--allow-empty', '-m', '사용자가 변경한 기준'])
  assert.equal(await f.manager.recoverUntrackedIntegrationFailure(f.lease.leaseId), null)
  assert.equal(f.manager.state.workspaces.fork2.status, 'quarantined')
  assert.equal(await readFile(path.join(f.main, assetPaths[0]), 'utf8'), '사용자 데이터\n')
  f.manager.state = waitingState
  await assert.rejects(f.manager.finalize(f.lease.leaseId, { childStatus: 'completed' }), /기준 커밋/)
  assert.equal(f.manager.state.workspaces.fork2.status, 'quarantined')
})

test('ignored 파일·상위 파일·디렉터리 내부의 미추적 파일도 자동으로 덮어쓰지 않는다', realGit, async (t) => {
  const f = await fixture(t, ['ignored.asset', 'parent/child.txt', 'directory'])
  await put(f.main, '.git/info/exclude', '/ignored.asset\n')
  await put(f.main, 'ignored.asset', 'ignored 사용자 데이터')
  await put(f.main, 'parent', '상위 경로를 차지한 사용자 파일')
  await put(f.main, 'directory/user.txt', '디렉터리 내부 사용자 파일')
  const result = await f.manager.finalize(f.lease.leaseId, { childStatus: 'completed' })
  assert.equal(result.status, 'waiting-integration')
  assert.deepEqual(result.untrackedChanges, ['directory/user.txt', 'ignored.asset', 'parent'])
  assert.equal(await readFile(path.join(f.main, 'ignored.asset'), 'utf8'), 'ignored 사용자 데이터')
  assert.equal(await git(f.main, ['rev-parse', 'HEAD']), f.lease.baseCommit)
})

test('검사 직후 생긴 파일도 대기로 전환하고 무관한 Git 오류는 격리한다', realGit, async (t) => {
  const f = await fixture(t)
  const baseRunner = f.manager.git
  let raced = false
  f.manager.git = async (cwd, args, options) => {
    if (cwd === f.main && args[0] === 'merge' && !raced) {
      raced = true
      await put(f.main, assetPaths[0], '경쟁 상태에서 생성된 사용자 파일')
    }
    return baseRunner(cwd, args, options)
  }
  const result = await f.manager.finalize(f.lease.leaseId, { childStatus: 'completed' })
  assert.equal(result.reasonCode, integrationUntrackedCollisionReasonCode)
  assert.equal(await readFile(path.join(f.main, assetPaths[0]), 'utf8'), '경쟁 상태에서 생성된 사용자 파일')
  await rename(path.join(f.main, assetPaths[0]), path.join(f.root, 'backup'))
  f.manager.git = async (cwd, args, options) => {
    if (cwd === f.main && args[0] === 'merge') throw new Error('fatal: permission denied')
    return baseRunner(cwd, args, options)
  }
  await assert.rejects(f.manager.finalize(f.lease.leaseId, { childStatus: 'completed' }), /permission denied/)
  assert.equal(f.manager.state.workspaces.fork2.status, 'quarantined')
})

test('통합 직후 서버가 종료돼도 이미 반영된 파일을 새 충돌로 오인하지 않는다', realGit, async (t) => {
  const f = await fixture(t)
  await put(f.main, assetPaths[0], '사용자 파일')
  await f.manager.finalize(f.lease.leaseId, { childStatus: 'completed' })
  await rename(path.join(f.main, assetPaths[0]), path.join(f.root, 'backup'))
  const candidate = f.manager.state.leases[f.lease.leaseId].integrationHeadCommit
  await git(f.main, ['fetch', f.worker, candidate])
  await git(f.main, ['merge', '--ff-only', candidate])
  const restarted = new WorkspacePoolManager(f)
  await restarted.initialize()
  const completed = await restarted.finalize(f.lease.leaseId, { childStatus: 'completed' })
  assert.equal(completed.integratedCommit, candidate)
  assert.equal(restarted.state.workspaces.fork2.status, 'idle')
})
})
