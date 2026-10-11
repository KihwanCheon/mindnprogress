import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { WorkspacePoolManager } from '../server/lib/workspacePool.mjs'
import { RemoteWorkspacePool, remoteWorkspaceFacade } from '../server/lib/remoteWorkspacePool.mjs'
import { createWorkspaceAgent } from '../runner/lib/workspaceAgent.mjs'
import { git, jsonFile, saveJson, workspaceLock } from '../server/lib/remoteWorkspaceProtocol.mjs'
import { RemoteWorkspaceArtifacts } from '../server/lib/remoteWorkspaceArtifacts.mjs'

const message = { summary: '원격 Fork 기능 검증', background: '원격 작업 결과를 안전하게 전달해야 합니다.', cause: '머신 간 작업공간이 분리되어 있습니다.', changes: '의도한 기능 파일만 체크포인트로 전달했습니다.' }
async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'mnp-remote-test-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const integration = path.join(root, 'integration'), localRoot = path.join(root, 'local-worker'), worker = path.join(root, 'remote-worker')
  await mkdir(integration)
  await git(integration, ['init', '-b', 'main'])
  await git(integration, ['config', 'user.name', 'MnP test'])
  await git(integration, ['config', 'user.email', 'mnp@example.invalid'])
  await writeFile(path.join(integration, '.gitignore'), '.ai-session.json\n')
  await writeFile(path.join(integration, 'feature.txt'), 'baseline\n')
  await git(integration, ['add', '.']); await git(integration, ['commit', '-m', '[김용민] 테스트 기준선'])
  const originUrl = 'https://example.invalid/project.git'
  await git(integration, ['remote', 'add', 'origin', originUrl])
  for (const clone of [localRoot, worker]) {
    await git(integration, ['clone', integration, clone])
    await git(clone, ['remote', 'set-url', 'origin', originUrl])
    await git(clone, ['config', 'user.name', 'MnP test']); await git(clone, ['config', 'user.email', 'mnp@example.invalid'])
  }
  const registryFile = path.join(root, 'local.json')
  await saveJson(registryFile, { schemaVersion: 1, poolId: 'main-pool', sharedRoot: path.join(root, 'local-shared'), originUrl,
    workspaces: [{ id: 'integration', root: integration, role: 'integration' }, { id: 'fork1', root: localRoot, role: 'worker' }] })
  const local = new WorkspacePoolManager({ registryFile, stateFile: path.join(root, 'local-state.json') })
  await local.initialize()
  let agent, lostAction = null, active = false
  const remote = new RemoteWorkspacePool({ local, stateFile: path.join(root, 'remote-state.json'), mainMachineId: () => 'main',
    callRunner: async (machineId, pathname, { body }) => {
      assert.equal(machineId, 'macbook'); assert.equal(pathname, '/mnp/workspaces')
      const result = await agent.execute(body)
      if (lostAction === body.action) { lostAction = null; throw new Error('simulated lost response') }
      return result
    } })
  await remote.initialize()
  const remoteRegistry = path.join(root, 'remote.json')
  await saveJson(remoteRegistry, { schemaVersion: 1, coordinatorId: remote.state.coordinatorId, poolId: 'mac-pool', originUrl,
    sharedRoot: path.join(root, 'remote-shared'), workspaces: [{ id: 'fork1', root: worker, role: 'worker' }] })
  const buildAgent = () => createWorkspaceAgent({ registryFile: remoteRegistry, machineId: 'macbook', runtimeIdle: async () => !active,
    request: (pathname, body, method) => {
      const match = /^\/api\/machines\/([^/]+)\/runner\/workspace-artifacts\/([^/]+)\/([^/]+)\/(.*)$/.exec(pathname)
      return remote.artifactRequest(match[1], match[2], match[3], match[4], method, body)
    } })
  agent = await buildAgent()
  const observe = () => agent.report().then((report) => remote.observe('macbook', report))
  await observe()
  const report = remote.report('macbook')
  await remote.approve('macbook', { poolId: report.poolId, registryDigest: report.registryDigest, enabled: true })
  const acquire = (requestId = 'delegation-1') => remote.acquire({ machineId: 'macbook', requestId, mapId: 'map', cardId: 'card', conversationId: 'conversation-1', cardLabel: '검증' })
  const checkpoint = (lease, paths = ['feature.txt'], requestId = 'checkpoint-1') => remote.checkpoint(lease.leaseId, { requestId, jobId: lease.jobId, mapId: 'map', cardId: 'card', conversationId: 'conversation-1', paths, commitMessage: message })
  return { root, integration, localRoot, worker, local, remote, acquire, checkpoint, observe, facade: remoteWorkspaceFacade(local, remote),
    agent: () => agent, restartAgent: async () => { agent = await buildAgent() }, lose: (action) => { lostAction = action }, active: (value) => { active = value } }
}

test('실제 Git: 원격 prepare → checkpoint → staging 통합 → 반환 확인', async (t) => {
  const f = await fixture(t)
  const localBefore = JSON.stringify(f.local.state.leases)
  const lease = await f.acquire()
  assert.equal(lease.ownership.machineId, 'macbook')
  assert.equal(lease.projectRoot, f.worker)
  const snapshot = f.facade.publicSnapshot({ machineId: 'macbook', conversationId: 'conversation-1' })
  assert.equal(snapshot.workspaces.length, 1)
  assert.equal(snapshot.workspaces[0].assignedToCurrentConversation, true)
  assert.equal(snapshot.workspaces[0].projectRoot, f.worker)
  await f.agent().validateDispatch({ workspaceLease: lease, strategy: 'resume', targetConversationId: 'conversation-1' })
  await writeFile(path.join(f.worker, 'feature.txt'), 'remote change\n')
  const checkpoint = await f.checkpoint(lease)
  assert.equal(checkpoint.lease.ownership.generation, 1)
  const result = await f.remote.finalize(lease.leaseId, { childStatus: 'completed' })
  assert.equal(result.status, 'completed'); assert.equal(result.remoteReleased, true)
  assert.equal(await readFile(path.join(f.integration, 'feature.txt'), 'utf8'), 'remote change\n')
  assert.equal(await jsonFile(path.join(f.worker, '.ai-session.json')), null)
  assert.equal(JSON.stringify(f.local.state.leases), localBefore)
  assert.equal(f.local.state.integrationLeaseId, null)
  await f.observe()
  const next = await f.acquire('delegation-2')
  assert.equal(next.ownership.generation, 2)
  assert.notEqual(next.leaseId, lease.leaseId)
})

test('원격 결과 통합은 최신 main 미커밋 변경을 보존하고 자동 대기한다', async (t) => {
  const f = await fixture(t), lease = await f.acquire()
  await writeFile(path.join(f.worker, 'feature.txt'), 'remote change\n'); await f.checkpoint(lease)
  await writeFile(path.join(f.integration, 'feature.txt'), 'user uncommitted\n')
  const result = await f.remote.finalize(lease.leaseId, { childStatus: 'completed' })
  assert.equal(result.status, 'waiting-integration')
  assert.equal(await readFile(path.join(f.integration, 'feature.txt'), 'utf8'), 'user uncommitted\n')
  assert.ok(await jsonFile(path.join(f.worker, '.ai-session.json')))
})

test('prepare 응답 유실·Runner 재시작은 같은 lease/receipt만 재사용한다', async (t) => {
  const f = await fixture(t)
  f.lose('prepare')
  await assert.rejects(f.acquire(), /lost response/)
  const stored = Object.values(f.remote.state.leases)[0]
  await f.restartAgent()
  const lease = await f.acquire()
  assert.equal(lease.leaseId, stored.leaseId)
  assert.equal(Object.keys(f.agent().state.leases).length, 1)
  const prepare = Object.values(stored.operations)[0]
  await assert.rejects(() => f.agent().execute({ ...prepare, lease: { ...prepare.lease, branch: 'other' } }), /REMOTE_WORKSPACE_OPERATION_CONFLICT/)
  await assert.rejects(() => f.agent().validateDispatch({ workspaceLease: { ...lease, ownership: { ...lease.ownership, generation: 2 } }, strategy: 'resume', targetConversationId: 'conversation-1' }), /ASSIGNMENT_MISMATCH/)
  await assert.rejects(() => f.agent().validateDispatch({ workspaceLease: lease, strategy: 'resume', targetConversationId: 'another' }), /CONVERSATION_MISMATCH/)
})

test('release 응답 유실은 통합 완료와 worker 반환을 구분하고 멱등 복구한다', async (t) => {
  const f = await fixture(t), lease = await f.acquire()
  await writeFile(path.join(f.worker, 'feature.txt'), 'remote change\n'); await f.checkpoint(lease)
  f.lose('release')
  await assert.rejects(() => f.remote.finalize(lease.leaseId, { childStatus: 'completed' }), /lost response/)
  assert.equal(f.remote.state.leases[lease.leaseId].status, 'release-pending')
  await assert.rejects(() => f.acquire('other'), /사용 가능한 원격 worker/)
  await f.restartAgent()
  const result = await f.remote.finalize(lease.leaseId, { childStatus: 'completed' })
  assert.equal(result.status, 'completed')
  assert.equal(result.remoteReleased, true)
})

test('원격 통합 충돌은 main을 보존하고 메인 staging 수동 복구로만 해제한다', async (t) => {
  const f = await fixture(t), lease = await f.acquire()
  await writeFile(path.join(f.worker, 'feature.txt'), 'remote change\n'); await f.checkpoint(lease)
  await writeFile(path.join(f.integration, 'feature.txt'), 'main change\n')
  await git(f.integration, ['add', 'feature.txt']); await git(f.integration, ['commit', '-m', '[김용민] 메인 변경'])
  const result = await f.remote.finalize(lease.leaseId, { childStatus: 'completed' })
  assert.equal(result.status, 'quarantined'); assert.equal(result.reasonCode, 'REMOTE_INTEGRATION_CONFLICT_MANUAL_REVIEW')
  assert.notEqual(result.stagingRoot, f.worker)
  assert.equal(await readFile(path.join(f.integration, 'feature.txt'), 'utf8'), 'main change\n')
  await writeFile(path.join(result.stagingRoot, 'feature.txt'), 'merged result\n')
  await git(result.stagingRoot, ['add', 'feature.txt'])
  const recovered = await f.remote.retryIntegration(lease.leaseId, { confirmed: true, expectedHead: await git(result.stagingRoot, ['rev-parse', 'HEAD']) })
  assert.equal(recovered.status, 'completed')
  assert.equal(await readFile(path.join(f.integration, 'feature.txt'), 'utf8'), 'merged result\n')
})

test('물리 잠금과 coordinator 소유권은 다른 풀의 동시 점유를 차단한다', async (t) => {
  const f = await fixture(t)
  await workspaceLock(f.worker, () => assert.rejects(() => f.acquire(), /REMOTE_WORKSPACE_LOCKED/))
  assert.equal(await git(f.worker, ['branch', '--show-current']), 'main')
  assert.equal(await jsonFile(path.join(f.worker, '.ai-session.json')), null)
  const localWorker = { id: 'fork1', root: f.worker }
  const release = await f.local.claimLocalWorkspace(localWorker)
  await release()
  assert.ok(await jsonFile(path.join(f.worker, '.git', 'mnp-local-owner.json')))
})

test('artifact 크기·hash·chunk 중복/변조·경로 탈출을 검증한다', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'mnp-artifact-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const sender = new RemoteWorkspaceArtifacts(path.join(root, 'send')), receiver = new RemoteWorkspaceArtifacts(path.join(root, 'receive'))
  await mkdir(path.dirname(sender.file('lease-1', 'result')), { recursive: true })
  await writeFile(sender.file('lease-1', 'result'), Buffer.alloc(300_000, 42))
  const manifest = await sender.publish('lease-1', 'result')
  const first = await sender.chunk('lease-1', 'result', 0)
  await receiver.receive('lease-1', 'result', manifest, first)
  await receiver.receive('lease-1', 'result', manifest, first)
  await assert.rejects(() => receiver.receive('lease-1', 'result', manifest, { ...first, sha256: 'a'.repeat(64) }), /HASH_MISMATCH/)
  await assert.rejects(() => receiver.finish('lease-1', 'result'))
  await receiver.receive('lease-1', 'result', manifest, await sender.chunk('lease-1', 'result', 1))
  assert.deepEqual(await receiver.finish('lease-1', 'result'), manifest)
  assert.throws(() => receiver.file('../escape', 'result'), /ID_INVALID/)
  assert.throws(() => receiver.validate({ size: 9 * 1024 ** 3, sha256: 'a'.repeat(64) }), /MANIFEST_INVALID/)
})

test('체크포인트 requestId는 중복 커밋을 방지하고 새 변경과 입력 충돌을 구분한다', async (t) => {
  const f = await fixture(t), lease = await f.acquire()
  await writeFile(path.join(f.worker, 'feature.txt'), 'first\n')
  const first = await f.checkpoint(lease)
  assert.deepEqual((await f.checkpoint(lease)).checkpoint, first.checkpoint)
  await assert.rejects(() => f.checkpoint(lease, ['another.txt']), /OPERATION_CONFLICT/)
  await writeFile(path.join(f.worker, 'feature.txt'), 'second\n')
  const second = await f.checkpoint(lease, ['feature.txt'], 'checkpoint-2')
  assert.notEqual(first.checkpoint.commit, second.checkpoint.commit)
  assert.equal(f.agent().state.leases[lease.leaseId].checkpoints.length, 2)
})

test('빈 변경 체크포인트는 개수를 늘리지 않고 격리 후 재시도로 lease를 활성화하지 않는다', async (t) => {
  const f = await fixture(t), lease = await f.acquire()
  const empty = await f.checkpoint(lease)
  assert.equal(empty.checkpoint, null)
  assert.equal(empty.lease.checkpointCount, 0)
  assert.equal(f.agent().state.leases[lease.leaseId].checkpoints.length, 0)
  await f.remote.quarantine(lease.leaseId, '실행 확인 필요')
  await assert.rejects(() => f.checkpoint(lease), /RECOVERY_REQUIRED/)
  assert.equal(f.remote.state.leases[lease.leaseId].status, 'quarantined')
  assert.equal(f.agent().state.leases[lease.leaseId].status, 'quarantined')
})

test('local 통합 잠금을 가진 진행 중 lease는 remote 통합에서 변경하지 않는다', async (t) => {
  const f = await fixture(t), lease = await f.acquire()
  f.local.state.integrationLeaseId = 'existing-local-lease'
  f.local.state.leases['existing-local-lease'] = { status: 'integrating', marker: 'user-owned' }
  await f.local.persist()
  await writeFile(path.join(f.worker, 'feature.txt'), 'remote change\n'); await f.checkpoint(lease)
  const result = await f.remote.finalize(lease.leaseId, { childStatus: 'completed' })
  assert.equal(result.status, 'waiting-integration')
  assert.equal(f.local.state.integrationLeaseId, 'existing-local-lease')
  assert.deepEqual(f.local.state.leases['existing-local-lease'], { status: 'integrating', marker: 'user-owned' })
  assert.equal(await readFile(path.join(f.integration, 'feature.txt'), 'utf8'), 'baseline\n')
})

test('등록 승인·보고 만료·artifact 머신 귀속 및 원격 소유 Fork 로컬 동기화를 차단한다', async (t) => {
  const f = await fixture(t), report = f.remote.report('macbook')
  await assert.rejects(() => f.remote.approve('macbook', { poolId: report.poolId, registryDigest: 'b'.repeat(64), enabled: true }), /REGISTRATION_MISMATCH/)
  const lease = await f.acquire()
  await assert.rejects(() => f.remote.artifactRequest('other-machine', lease.leaseId, 'baseline', 'manifest', 'GET'), /ASSIGNMENT_MISMATCH/)
  assert.equal(await f.local.claimLocalWorkspace({ id: 'fork1', root: f.worker }), null)
  const localGuard = new WorkspacePoolManager({ stateFile: path.join(f.root, 'guard.json') })
  localGuard.registry = { ...f.local.registry, workers: [{ id: 'fork1', root: f.worker }], workspaces: [f.local.registry.integration, { id: 'fork1', root: f.worker }] }
  localGuard.state = { integrationLeaseId: null, leases: {}, workspaces: { fork1: { status: 'idle' } } }
  await assert.rejects(() => localGuard.synchronizeIdleWorkersToIntegration(), /원격 coordinator/)
  await f.remote.observe('macbook', undefined)
  assert.equal(f.remote.snapshot('macbook').remotePools[0].stale, true)
  assert.ok(f.remote.poolForWorkspace(f.worker, 'macbook'))
  assert.throws(() => f.remote.pool('macbook'), /RUNNER_STALE/)
})

test('runtime 경합은 Git을 변경하지 않고 명시적 prepare 복구 뒤 같은 lease만 준비한다', async (t) => {
  const f = await fixture(t)
  const head = await git(f.worker, ['rev-parse', 'HEAD'])
  f.active(true)
  await assert.rejects(() => f.acquire(), /RUNTIME_ACTIVE/)
  const lease = Object.values(f.remote.state.leases)[0]
  assert.equal(await git(f.worker, ['rev-parse', 'HEAD']), head)
  assert.equal(await git(f.worker, ['branch', '--show-current']), 'main')
  assert.equal(await jsonFile(path.join(f.worker, '.ai-session.json')), null)
  await assert.rejects(() => f.remote.retryPreparation(lease.leaseId, { confirmed: true, expectedLeaseId: lease.leaseId, generation: 2 }), /CONFIRMATION_REQUIRED/)
  f.active(false)
  const prepared = await f.remote.retryPreparation(lease.leaseId, { confirmed: true, expectedLeaseId: lease.leaseId, generation: 1 })
  assert.equal(prepared.leaseId, lease.leaseId)
  assert.equal(Object.keys(f.agent().state.leases).length, 1)
})

test('최초 Runner 보고 전에도 coordinator ID는 서버 재시작 후 유지된다', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'mnp-coordinator-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const options = { local: {}, stateFile: path.join(root, '_state.json'), mainMachineId: () => 'main' }
  const first = new RemoteWorkspacePool(options)
  await first.initialize()
  const restarted = new RemoteWorkspacePool(options)
  await restarted.initialize()
  assert.equal(restarted.state.coordinatorId, first.state.coordinatorId)
})
