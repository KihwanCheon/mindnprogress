import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import {
  WorkspacePoolManager,
  WorkspacePoolUnavailableError,
  buildWorkspaceInstruction,
} from '../server/lib/workspacePool.mjs'

const execFileAsync = promisify(execFile)

async function git(cwd, ...args) {
  const result = await execFileAsync('git', args, { cwd, windowsHide: true })
  return String(result.stdout ?? '').trim()
}

test('작업공간 지침은 기존 대화에도 재배정 정보를 명확하게 전달한다', () => {
  const instruction = buildWorkspaceInstruction({
    workspaceId: 'fork2',
    jobId: 'job-12',
    leaseId: 'lease-12',
    projectRoot: 'C:\\Git\\Holdem_Fork2\\hdtf-client',
    branch: 'mnp/job-12',
    baseCommit: 'abc123',
    assetsPath: 'C:/Git/Holdem_Fork2/hdtf-client/Assets',
    unityInstanceHash: '35b9a6e8409bd02a',
  })
  assert.match(instruction, /workspaceId: `fork2`/)
  assert.match(instruction, /projectRoot: `C:\\Git\\Holdem_Fork2\\hdtf-client`/)
  assert.match(instruction, /다른 Holdem 작업공간으로 이동하거나/)
  assert.match(instruction, /직접 커밋하지 마세요/)
})

test('registry 작업공간만 풀로 인식하고 유휴 worker에 원자적 lease를 만든다', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mnp-workspace-pool-'))
  try {
    const integrationRoot = path.join(root, 'main')
    const workerRoot = path.join(root, 'fork2')
    const sharedRoot = path.join(root, 'shared')
    await Promise.all([mkdir(integrationRoot), mkdir(workerRoot), mkdir(sharedRoot)])
    const registryFile = path.join(sharedRoot, 'workspaces.json')
    const stateFile = path.join(root, 'state.json')
    await writeFile(registryFile, JSON.stringify({
      schemaVersion: 1,
      poolId: 'holdem',
      sharedRoot,
      originUrl: 'https://example.invalid/holdem.git',
      workspaces: [
        { id: 'main', root: integrationRoot, role: 'integration', enabled: true },
        {
          id: 'fork2', root: workerRoot, role: 'worker', enabled: true,
          assetsPath: `${workerRoot}/Assets`, unityInstanceHash: 'hash-fork2',
        },
      ],
    }), 'utf8')

    const commands = []
    let workerBranch = 'japan-master'
    const manager = new WorkspacePoolManager({
      registryFile,
      stateFile,
      gitRunner: async (cwd, args) => {
        commands.push({ cwd, args })
        if (args[0] === 'status') return ''
        if (args[0] === 'rev-parse') return 'base123'
        if (args[0] === 'branch' && args[1] === '--show-current') return cwd === workerRoot ? workerBranch : 'japan-master'
        if (args[0] === 'remote') return 'https://example.invalid/holdem.git'
        if (args[0] === 'switch') {
          workerBranch = args[1]
          return ''
        }
        return ''
      },
    })
    assert.equal(await manager.initialize(), true)
    assert.equal(manager.poolForWorkspace(workerRoot)?.poolId, 'holdem')
    assert.equal(manager.poolForWorkspace(path.join(root, 'other')), null)

    const lease = await manager.acquire({
      workspaceHint: integrationRoot,
      mapId: 'map-a',
      cardId: 'card-b',
      conversationId: '',
      cardLabel: '하위 카드',
    })
    assert.equal(lease.workspaceId, 'fork2')
    assert.equal(lease.baseCommit, 'base123')
    assert.ok(commands.some(({ args }) => args[0] === 'fetch' && args.at(-1) === 'refs/heads/japan-master'))
    assert.ok(commands.some(({ args }) => args[0] === 'switch' && args[1] === lease.branch))

    const session = JSON.parse(await readFile(path.join(workerRoot, '.ai-session.json'), 'utf8'))
    assert.equal(session.leaseId, lease.leaseId)
    assert.equal(session.projectRoot, workerRoot)
    assert.equal(session.conversationId, '')

    await manager.bindConversation(lease.leaseId, 'conversation-c')
    const boundSession = JSON.parse(await readFile(path.join(workerRoot, '.ai-session.json'), 'utf8'))
    assert.equal(boundSession.conversationId, 'conversation-c')

    const reused = await manager.reuseLease(lease.leaseId, {
      mapId: 'map-a',
      cardId: 'card-b',
      conversationId: 'conversation-c',
    })
    assert.equal(reused.leaseId, lease.leaseId)
    assert.equal(reused.workspaceId, 'fork2')

    const noChangesCheckpoint = await manager.checkpoint(lease.leaseId, {
      jobId: lease.jobId,
      mapId: 'map-a',
      cardId: 'card-b',
      conversationId: '',
      paths: [],
      confirmNoChanges: true,
    })
    assert.equal(noChangesCheckpoint.noChanges, true)
    assert.equal(noChangesCheckpoint.checkpoint.noCodeChanges, true)

    await assert.rejects(
      () => manager.checkpoint(lease.leaseId, {
        jobId: lease.jobId,
        mapId: 'map-a',
        cardId: 'card-b',
        conversationId: 'conversation-other',
        paths: [],
        confirmNoChanges: true,
      }),
      (error) => error instanceof WorkspacePoolUnavailableError,
    )

    await assert.rejects(
      () => manager.reuseLease(lease.leaseId, {
        mapId: 'map-a',
        cardId: 'card-b',
        conversationId: 'conversation-other',
      }),
      (error) => error instanceof WorkspacePoolUnavailableError,
    )

    await assert.rejects(
      () => manager.acquire({ workspaceHint: integrationRoot }),
      (error) => error instanceof WorkspacePoolUnavailableError,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('변경 없는 완료도 명시적 no-change 체크포인트 뒤에만 lease를 회수한다', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mnp-workspace-no-change-'))
  try {
    const integrationRoot = path.join(root, 'main')
    const workerRoot = path.join(root, 'fork1')
    const sharedRoot = path.join(root, 'shared')
    await Promise.all([mkdir(integrationRoot), mkdir(workerRoot), mkdir(sharedRoot)])
    const registryFile = path.join(sharedRoot, 'workspaces.json')
    const stateFile = path.join(root, 'state.json')
    await writeFile(registryFile, JSON.stringify({
      schemaVersion: 1,
      poolId: 'holdem',
      sharedRoot,
      workspaces: [
        { id: 'main', root: integrationRoot, role: 'integration', enabled: true },
        { id: 'fork1', root: workerRoot, role: 'worker', enabled: true },
      ],
    }), 'utf8')

    let workerBranch = 'japan-master'
    const manager = new WorkspacePoolManager({
      registryFile,
      stateFile,
      gitRunner: async (cwd, args) => {
        const worker = cwd === workerRoot
        if (args[0] === 'status') return ''
        if (args[0] === 'remote') return ''
        if (args[0] === 'rev-parse') return 'base123'
        if (args[0] === 'branch' && args[1] === '--show-current') return worker ? workerBranch : 'japan-master'
        if (args[0] === 'switch') {
          workerBranch = args[1] === '-C' ? args[2] : args[1]
          return ''
        }
        return ''
      },
    })
    await manager.initialize()
    const lease = await manager.acquire({
      workspaceHint: integrationRoot,
      mapId: 'map-a',
      cardId: 'card-a',
      conversationId: 'conversation-a',
      cardLabel: '조사 전용 작업',
    })

    const checkpointRequired = await manager.finalize(lease.leaseId, { childStatus: 'completed' })
    assert.equal(checkpointRequired.status, 'checkpoint-required')
    assert.deepEqual(checkpointRequired.changedFiles, [])

    const checkpoint = await manager.checkpoint(lease.leaseId, {
      jobId: lease.jobId,
      mapId: 'map-a',
      cardId: 'card-a',
      conversationId: '',
      paths: [],
      confirmNoChanges: true,
    })
    assert.equal(checkpoint.checkpoint.noCodeChanges, true)

    const completed = await manager.finalize(lease.leaseId, { childStatus: 'completed' })
    assert.equal(completed.status, 'completed')
    assert.equal(completed.integratedCommit, null)
    const state = JSON.parse(await readFile(stateFile, 'utf8'))
    assert.equal(state.workspaces.fork1.status, 'idle')
    assert.equal(state.workspaces.fork1.idleBranch, 'mnp/idle/fork1')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('완료된 worker 변경을 체크포인트로 고정하고 main에 직렬 통합한 뒤 lease를 회수한다', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mnp-workspace-finalize-'))
  try {
    const integrationRoot = path.join(root, 'main')
    const workerRoot = path.join(root, 'fork2')
    const sharedRoot = path.join(root, 'shared')
    await Promise.all([mkdir(integrationRoot), mkdir(workerRoot), mkdir(sharedRoot)])
    const registryFile = path.join(sharedRoot, 'workspaces.json')
    const stateFile = path.join(root, 'state.json')
    await writeFile(registryFile, JSON.stringify({
      schemaVersion: 1,
      poolId: 'holdem',
      sharedRoot,
      originUrl: 'https://example.invalid/holdem.git',
      workspaces: [
        { id: 'main', root: integrationRoot, role: 'integration', enabled: true },
        { id: 'fork2', root: workerRoot, role: 'worker', enabled: true },
      ],
    }), 'utf8')

    let workerBranch = 'japan-master'
    let workerHead = 'base123'
    let integrationHead = 'base123'
    let leased = false
    const commands = []
    const manager = new WorkspacePoolManager({
      registryFile,
      stateFile,
      gitRunner: async (cwd, args) => {
        commands.push({ cwd, args })
        const worker = cwd === workerRoot
        if (args[0] === 'status') return worker && leased ? ' M Assets/changed.cs' : ''
        if (args[0] === 'remote') return 'https://example.invalid/holdem.git'
        if (args[0] === 'rev-parse') return worker ? workerHead : integrationHead
        if (args[0] === 'branch' && args[1] === '--show-current') return worker ? workerBranch : 'japan-master'
        if (args[0] === 'switch') {
          if (args[1] === '-C') {
            workerBranch = args[2]
            workerHead = args[3]
            leased = false
          } else {
            workerBranch = args[1]
            leased = args[1] !== 'japan-master'
          }
          return ''
        }
        if (args[0] === 'commit') {
          workerHead = 'checkpoint456'
          leased = false
          return ''
        }
        if (args[0] === 'rev-list') return 'checkpoint456'
        if (args[0] === 'cherry-pick' && worker) {
          workerHead = 'integrated789'
          return ''
        }
        if (args[0] === 'merge' && !worker) {
          integrationHead = args.at(-1)
          return ''
        }
        return ''
      },
    })
    await manager.initialize()
    const lease = await manager.acquire({ workspaceHint: integrationRoot, cardLabel: '로그인 보완' })
    await manager.checkpoint(lease.leaseId, {
      jobId: lease.jobId,
      mapId: '',
      cardId: '',
      conversationId: '',
      paths: ['Assets/changed.cs'],
      cardLabel: '로그인 보완',
    })
    const result = await manager.finalize(lease.leaseId, {
      childStatus: 'completed',
      cardLabel: '로그인 보완',
    })

    assert.equal(result.status, 'completed')
    assert.equal(result.headCommit, 'checkpoint456')
    assert.equal(result.integratedCommit, 'integrated789')
    assert.ok(commands.some(({ args }) => args[0] === 'commit' && args.includes('[김용민] MNP 작업 체크포인트 - 로그인 보완')))
    assert.ok(commands.some(({ cwd, args }) => cwd === workerRoot && args[0] === 'cherry-pick'))
    assert.ok(commands.some(({ cwd, args }) => cwd === integrationRoot && args[0] === 'merge' && args[1] === '--ff-only'))
    assert.equal(workerBranch, 'mnp/idle/fork2')
    const state = JSON.parse(await readFile(stateFile, 'utf8'))
    assert.equal(state.workspaces.fork2.status, 'idle')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('통합 충돌은 main을 건드리지 않고 같은 worker의 AI 해결 후 반영한다', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mnp-workspace-conflict-'))
  try {
    const integrationRoot = path.join(root, 'main')
    const workerRoot = path.join(root, 'fork1')
    const sharedRoot = path.join(root, 'shared')
    await Promise.all([
      mkdir(integrationRoot),
      mkdir(path.join(workerRoot, '.git'), { recursive: true }),
      mkdir(sharedRoot),
    ])
    const registryFile = path.join(sharedRoot, 'workspaces.json')
    const stateFile = path.join(root, 'state.json')
    await writeFile(registryFile, JSON.stringify({
      schemaVersion: 1,
      poolId: 'holdem',
      sharedRoot,
      originUrl: 'https://example.invalid/holdem.git',
      workspaces: [
        { id: 'main', root: integrationRoot, role: 'integration', enabled: true },
        { id: 'fork1', root: workerRoot, role: 'worker', enabled: true },
      ],
    }), 'utf8')

    let workerBranch = 'japan-master'
    let workerHead = 'base123'
    let integrationHead = 'base123'
    let workerDirty = false
    let unmerged = false
    const manager = new WorkspacePoolManager({
      registryFile,
      stateFile,
      gitRunner: async (cwd, args) => {
        const worker = cwd === workerRoot
        if (args[0] === 'status') return worker && workerDirty ? ' M Assets/conflict.cs' : ''
        if (args[0] === 'remote') return 'https://example.invalid/holdem.git'
        if (args[0] === 'rev-parse' && args[1] === '--git-path') return '.git/CHERRY_PICK_HEAD'
        if (args[0] === 'rev-parse') return worker ? workerHead : integrationHead
        if (args[0] === 'branch' && args[1] === '--show-current') return worker ? workerBranch : 'japan-master'
        if (args[0] === 'switch') {
          if (args[1] === '-C') {
            workerBranch = args[2]
            workerHead = args[3]
          } else {
            workerBranch = args[1]
          }
          return ''
        }
        if (args[0] === 'commit') {
          workerHead = workerBranch.startsWith('mnp/integrate/') ? 'resolved789' : 'checkpoint456'
          workerDirty = false
          return ''
        }
        if (args[0] === 'rev-list') return 'checkpoint456'
        if (args[0] === 'diff') return unmerged ? 'Assets/conflict.cs' : ''
        if (args[0] === 'cherry-pick' && !args.includes('--continue')) {
          unmerged = true
          workerDirty = true
          await writeFile(path.join(workerRoot, '.git', 'CHERRY_PICK_HEAD'), 'checkpoint456\n', 'utf8')
          throw new Error('CONFLICT')
        }
        if (args[0] === '-c' && args.includes('cherry-pick') && args.includes('--continue')) {
          unmerged = false
          workerDirty = false
          workerHead = 'resolved789'
          await rm(path.join(workerRoot, '.git', 'CHERRY_PICK_HEAD'), { force: true })
          return ''
        }
        if (args[0] === 'merge' && !worker) {
          integrationHead = args.at(-1)
          return ''
        }
        return ''
      },
    })
    await manager.initialize()
    const lease = await manager.acquire({ workspaceHint: integrationRoot, cardLabel: '충돌 작업' })
    workerDirty = true
    await manager.checkpoint(lease.leaseId, {
      jobId: lease.jobId,
      mapId: '',
      cardId: '',
      conversationId: '',
      paths: ['Assets/conflict.cs'],
      cardLabel: '충돌 작업',
    })

    const conflict = await manager.finalize(lease.leaseId, { childStatus: 'completed' })
    assert.equal(conflict.status, 'awaiting-conflict-resolution')
    assert.deepEqual(conflict.unmergedFiles, ['Assets/conflict.cs'])
    assert.equal(integrationHead, 'base123')

    unmerged = false
    const completed = await manager.completeConflictResolution(lease.leaseId, { childStatus: 'completed' })
    assert.equal(completed.status, 'completed')
    assert.equal(completed.conflictResolvedByAi, true)
    assert.equal(completed.integratedCommit, 'resolved789')
    assert.equal(integrationHead, 'resolved789')
    const state = JSON.parse(await readFile(stateFile, 'utf8'))
    assert.equal(state.integrationLeaseId, null)
    assert.equal(state.workspaces.fork1.status, 'idle')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('유휴 worker drift는 파일 종류와 관계없이 보존한 뒤 새 lease 전에 복원한다', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mnp-workspace-drift-unit-'))
  try {
    const integrationRoot = path.join(root, 'main')
    const workerRoot = path.join(root, 'fork2')
    const sharedRoot = path.join(root, 'shared')
    await Promise.all([mkdir(integrationRoot), mkdir(workerRoot), mkdir(sharedRoot)])
    await writeFile(path.join(workerRoot, 'tracked.txt'), 'runtime drift\n', 'utf8')
    await writeFile(path.join(workerRoot, 'generated.bin'), 'generated\n', 'utf8')
    const registryFile = path.join(sharedRoot, 'workspaces.json')
    const stateFile = path.join(root, 'state.json')
    await writeFile(registryFile, JSON.stringify({
      schemaVersion: 1,
      poolId: 'holdem',
      sharedRoot,
      workspaces: [
        { id: 'main', root: integrationRoot, role: 'integration', enabled: true },
        { id: 'fork2', root: workerRoot, role: 'worker', enabled: true },
      ],
    }), 'utf8')
    await writeFile(stateFile, JSON.stringify({
      schemaVersion: 1,
      poolId: 'holdem',
      workspaces: {
        main: { status: 'integration' },
        fork2: {
          status: 'quarantined',
          reason: '작업공간에 소유자를 확정할 수 없는 변경이 있습니다.',
          leaseId: 'missing-lease',
        },
      },
      leases: {},
    }), 'utf8')

    let restoreCount = 0
    let workerBranch = 'japan-master'
    const manager = new WorkspacePoolManager({
      registryFile,
      stateFile,
      gitRunner: async (cwd, args) => {
        const worker = cwd === workerRoot
        if (args[0] === 'status') {
          if (!worker || restoreCount >= 2) return ''
          return restoreCount === 0 ? ' M tracked.txt\0?? generated.bin\0' : ' M tracked.txt\0'
        }
        if (args[0] === 'diff' && args.includes('--cached')) return ''
        if (args[0] === 'diff') return 'diff --git a/tracked.txt b/tracked.txt\n+runtime drift\n'
        if (args[0] === 'ls-files') return worker && restoreCount === 0 ? 'generated.bin\0' : ''
        if (args[0] === 'restore') {
          restoreCount += 1
          await writeFile(path.join(workerRoot, 'tracked.txt'), 'base\n', 'utf8')
          return ''
        }
        if (args[0] === 'branch' && args[1] === '--show-current') return worker ? workerBranch : 'japan-master'
        if (args[0] === 'rev-parse') return 'base123'
        if (args[0] === 'remote') return ''
        if (args[0] === 'switch') {
          workerBranch = args[1]
          return ''
        }
        return ''
      },
    })
    await manager.initialize()
    await manager.acquire({ workspaceHint: integrationRoot, cardLabel: 'drift 복원' })

    assert.equal(await readFile(path.join(workerRoot, 'tracked.txt'), 'utf8'), 'base\n')
    await assert.rejects(() => readFile(path.join(workerRoot, 'generated.bin'), 'utf8'), { code: 'ENOENT' })
    assert.equal(restoreCount, 2)
    const state = JSON.parse(await readFile(stateFile, 'utf8'))
    const archive = state.workspaces.fork2.lastDriftArchive
    assert.ok(archive)
    const metadata = JSON.parse(await readFile(path.join(archive, 'metadata.json'), 'utf8'))
    assert.equal(metadata.attempt, 2)
    assert.equal(metadata.previousArchives.length, 1)
    assert.equal(await readFile(path.join(metadata.previousArchives[0], 'untracked', 'generated.bin'), 'utf8'), 'generated\n')
    assert.match(await readFile(path.join(archive, 'tracked.diff'), 'utf8'), /runtime drift/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('유휴 worker의 소유자 미확인 변경을 복구 자료로 보존하고 자동 회수한다', {
  skip: process.env.MNP_REAL_GIT_TEST !== '1' && 'MNP_REAL_GIT_TEST=1일 때 실행',
}, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mnp-workspace-drift-'))
  try {
    const integrationRoot = path.join(root, 'main')
    const workerRoot = path.join(root, 'fork2')
    const sharedRoot = path.join(root, 'shared')
    await Promise.all([mkdir(integrationRoot), mkdir(sharedRoot)])
    await git(integrationRoot, 'init', '-b', 'japan-master')
    await git(integrationRoot, 'config', 'user.name', 'MNP Test')
    await git(integrationRoot, 'config', 'user.email', 'mnp@example.invalid')
    await writeFile(path.join(integrationRoot, 'tracked.txt'), 'base\n', 'utf8')
    await git(integrationRoot, 'add', 'tracked.txt')
    await git(integrationRoot, 'commit', '-m', 'base')
    await git(root, 'clone', '--branch', 'japan-master', integrationRoot, workerRoot)
    await git(workerRoot, 'config', 'user.name', 'MNP Test')
    await git(workerRoot, 'config', 'user.email', 'mnp@example.invalid')
    await writeFile(path.join(workerRoot, 'tracked.txt'), 'unity drift\n', 'utf8')
    await writeFile(path.join(workerRoot, 'generated.txt'), 'generated\n', 'utf8')

    const registryFile = path.join(sharedRoot, 'workspaces.json')
    const stateFile = path.join(root, 'state.json')
    await writeFile(registryFile, JSON.stringify({
      schemaVersion: 1,
      poolId: 'holdem',
      sharedRoot,
      workspaces: [
        { id: 'main', root: integrationRoot, role: 'integration', enabled: true },
        { id: 'fork2', root: workerRoot, role: 'worker', enabled: true },
      ],
    }), 'utf8')
    await writeFile(stateFile, JSON.stringify({
      schemaVersion: 1,
      poolId: 'holdem',
      workspaces: {
        main: { status: 'integration' },
        fork2: {
          status: 'quarantined',
          reason: '작업공간에 소유자를 확정할 수 없는 변경이 있습니다.',
          leaseId: 'missing-lease',
        },
      },
      leases: {},
    }), 'utf8')

    const manager = new WorkspacePoolManager({ registryFile, stateFile })
    await manager.initialize()
    await manager.acquire({ workspaceHint: integrationRoot, cardLabel: 'drift 복구' })

    assert.equal((await readFile(path.join(workerRoot, 'tracked.txt'), 'utf8')).replace(/\r\n/g, '\n'), 'base\n')
    await assert.rejects(() => readFile(path.join(workerRoot, 'generated.txt'), 'utf8'), { code: 'ENOENT' })
    const state = JSON.parse(await readFile(stateFile, 'utf8'))
    const archive = state.workspaces.fork2.lastDriftArchive
    assert.ok(archive)
    assert.equal(JSON.parse(await readFile(path.join(archive, 'metadata.json'), 'utf8')).workspaceId, 'fork2')
    assert.equal(await readFile(path.join(archive, 'untracked', 'generated.txt'), 'utf8'), 'generated\n')
    assert.match(await readFile(path.join(archive, 'tracked.diff'), 'utf8'), /unity drift/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('명시적 체크포인트만 main에 통합하고 검증 후 drift는 보존·제거한다', {
  skip: process.env.MNP_REAL_GIT_TEST !== '1' && 'MNP_REAL_GIT_TEST=1일 때 실행',
}, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mnp-workspace-checkpoint-'))
  try {
    const integrationRoot = path.join(root, 'main')
    const workerRoot = path.join(root, 'fork1')
    const sharedRoot = path.join(root, 'shared')
    await Promise.all([mkdir(integrationRoot), mkdir(sharedRoot)])
    await git(integrationRoot, 'init', '-b', 'japan-master')
    await git(integrationRoot, 'config', 'user.name', 'MNP Test')
    await git(integrationRoot, 'config', 'user.email', 'mnp@example.invalid')
    await writeFile(path.join(integrationRoot, 'intended.txt'), 'base\n', 'utf8')
    await writeFile(path.join(integrationRoot, 'runtime.txt'), 'base\n', 'utf8')
    await git(integrationRoot, 'add', 'intended.txt', 'runtime.txt')
    await git(integrationRoot, 'commit', '-m', 'base')
    await git(root, 'clone', '--branch', 'japan-master', integrationRoot, workerRoot)
    await git(workerRoot, 'config', 'user.name', 'MNP Test')
    await git(workerRoot, 'config', 'user.email', 'mnp@example.invalid')

    const registryFile = path.join(sharedRoot, 'workspaces.json')
    const stateFile = path.join(root, 'state.json')
    await writeFile(registryFile, JSON.stringify({
      schemaVersion: 1,
      poolId: 'holdem',
      sharedRoot,
      workspaces: [
        { id: 'main', root: integrationRoot, role: 'integration', enabled: true },
        { id: 'fork1', root: workerRoot, role: 'worker', enabled: true },
      ],
    }), 'utf8')

    const manager = new WorkspacePoolManager({ registryFile, stateFile })
    await manager.initialize()
    const lease = await manager.acquire({
      workspaceHint: integrationRoot,
      mapId: 'map-a',
      cardId: 'card-a',
      conversationId: 'conversation-a',
      cardLabel: '명시적 체크포인트',
    })
    await writeFile(path.join(workerRoot, 'intended.txt'), 'intended\n', 'utf8')
    const checkpoint = await manager.checkpoint(lease.leaseId, {
      jobId: lease.jobId,
      mapId: 'map-a',
      cardId: 'card-a',
      conversationId: 'conversation-a',
      paths: ['intended.txt'],
      cardLabel: '명시적 체크포인트',
    })
    assert.equal(checkpoint.noChanges, false)

    await writeFile(path.join(workerRoot, 'runtime.txt'), 'play mode drift\n', 'utf8')
    const result = await manager.finalize(lease.leaseId, { childStatus: 'completed' })
    assert.equal(result.status, 'completed')
    assert.equal((await readFile(path.join(integrationRoot, 'intended.txt'), 'utf8')).replace(/\r\n/g, '\n'), 'intended\n')
    assert.equal((await readFile(path.join(integrationRoot, 'runtime.txt'), 'utf8')).replace(/\r\n/g, '\n'), 'base\n')
    assert.equal(await git(integrationRoot, 'status', '--porcelain'), '')
    assert.equal(await git(workerRoot, 'status', '--porcelain'), '')
    const state = JSON.parse(await readFile(stateFile, 'utf8'))
    const archive = state.workspaces.fork1.lastDriftArchive
    assert.ok(archive)
    assert.match(await readFile(path.join(archive, 'tracked.diff'), 'utf8'), /play mode drift/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('실제 Git 저장소에서도 충돌을 worker에서 해결한 뒤 main을 fast-forward한다', {
  skip: process.env.MNP_REAL_GIT_TEST !== '1' && 'MNP_REAL_GIT_TEST=1일 때 실행',
}, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mnp-workspace-real-git-'))
  try {
    const integrationRoot = path.join(root, 'main')
    const workerRoot = path.join(root, 'fork1')
    const sharedRoot = path.join(root, 'shared')
    await Promise.all([mkdir(integrationRoot), mkdir(sharedRoot)])
    await git(integrationRoot, 'init', '-b', 'japan-master')
    await git(integrationRoot, 'config', 'user.name', 'MNP Test')
    await git(integrationRoot, 'config', 'user.email', 'mnp@example.invalid')
    await writeFile(path.join(integrationRoot, 'shared.txt'), 'base\n', 'utf8')
    await git(integrationRoot, 'add', 'shared.txt')
    await git(integrationRoot, 'commit', '-m', 'base')
    await git(root, 'clone', '--branch', 'japan-master', integrationRoot, workerRoot)
    await git(workerRoot, 'config', 'user.name', 'MNP Test')
    await git(workerRoot, 'config', 'user.email', 'mnp@example.invalid')
    await writeFile(path.join(workerRoot, '.git', 'info', 'exclude'), '/.ai-session.json\n', { flag: 'a' })

    const registryFile = path.join(sharedRoot, 'workspaces.json')
    const stateFile = path.join(root, 'state.json')
    await writeFile(registryFile, JSON.stringify({
      schemaVersion: 1,
      poolId: 'holdem',
      sharedRoot,
      workspaces: [
        { id: 'main', root: integrationRoot, role: 'integration', enabled: true },
        { id: 'fork1', root: workerRoot, role: 'worker', enabled: true },
      ],
    }), 'utf8')

    const manager = new WorkspacePoolManager({ registryFile, stateFile })
    await manager.initialize()
    const lease = await manager.acquire({ workspaceHint: integrationRoot, cardLabel: '실제 충돌 작업' })
    await writeFile(path.join(workerRoot, 'shared.txt'), 'worker change\n', 'utf8')
    await manager.checkpoint(lease.leaseId, {
      jobId: lease.jobId,
      mapId: '',
      cardId: '',
      conversationId: '',
      paths: ['shared.txt'],
      cardLabel: '실제 충돌 작업',
    })
    await writeFile(path.join(integrationRoot, 'shared.txt'), 'main change\n', 'utf8')
    await git(integrationRoot, 'add', 'shared.txt')
    await git(integrationRoot, 'commit', '-m', 'main change')

    const conflict = await manager.finalize(lease.leaseId, { childStatus: 'completed' })
    assert.equal(conflict.status, 'awaiting-conflict-resolution')
    assert.deepEqual(conflict.unmergedFiles, ['shared.txt'])
    assert.equal(await readFile(path.join(integrationRoot, 'shared.txt'), 'utf8'), 'main change\n')

    await writeFile(path.join(workerRoot, 'shared.txt'), 'resolved change\n', 'utf8')
    await git(workerRoot, 'add', 'shared.txt')
    const completed = await manager.completeConflictResolution(lease.leaseId, { childStatus: 'completed' })
    assert.equal(completed.status, 'completed')
    assert.equal(completed.conflictResolvedByAi, true)
    assert.equal((await readFile(path.join(integrationRoot, 'shared.txt'), 'utf8')).replace(/\r\n/g, '\n'), 'resolved change\n')
    assert.equal(await git(integrationRoot, 'status', '--porcelain'), '')
    assert.equal(await git(workerRoot, 'status', '--porcelain'), '')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
