import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export class WorkspacePoolUnavailableError extends Error {
  constructor(message, details = []) {
    super(message)
    this.name = 'WorkspacePoolUnavailableError'
    this.code = 'WORKSPACE_POOL_UNAVAILABLE'
    this.details = details
  }
}

export class WorkspacePoolIntegrationError extends Error {
  constructor(message, details = null) {
    super(message)
    this.name = 'WorkspacePoolIntegrationError'
    this.code = 'WORKSPACE_POOL_INTEGRATION_FAILED'
    this.details = details
  }
}

function normalizedPath(value) {
  const resolved = path.resolve(String(value ?? '').trim()).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function atomicJson(file, value) {
  return (async () => {
    await mkdir(path.dirname(file), { recursive: true })
    const temporary = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await rename(temporary, file)
  })()
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback
    throw error
  }
}

async function exists(file) {
  try {
    await stat(file)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function defaultGitRunner(cwd, args) {
  const result = await execFileAsync('git', args, {
    cwd,
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  })
  return String(result.stdout ?? '').trim()
}

function normalizeRegistry(raw, registryFile) {
  const entries = Array.isArray(raw?.workspaces) ? raw.workspaces : []
  const workspaces = entries
    .filter((entry) => entry?.enabled !== false && String(entry?.id ?? '').trim() && String(entry?.root ?? '').trim())
    .map((entry) => ({
      ...entry,
      id: String(entry.id).trim(),
      root: path.resolve(String(entry.root).trim()),
      role: String(entry.role ?? '').trim() || (entry.id === 'main' ? 'integration' : 'worker'),
    }))
  const integration = workspaces.find((workspace) => workspace.role === 'integration')
    ?? workspaces.find((workspace) => workspace.id === 'main')
  return {
    schemaVersion: Number(raw?.schemaVersion) || 1,
    poolId: String(raw?.poolId ?? path.basename(String(raw?.sharedRoot ?? 'workspace-pool'))).trim() || 'workspace-pool',
    sharedRoot: path.resolve(String(raw?.sharedRoot ?? path.dirname(registryFile))),
    originUrl: String(raw?.originUrl ?? '').trim(),
    integration,
    workers: workspaces.filter((workspace) => workspace.role === 'worker' && workspace.id !== integration?.id),
    workspaces,
  }
}

function publicLease(lease) {
  return {
    poolId: lease.poolId,
    workspaceId: lease.workspaceId,
    jobId: lease.jobId,
    leaseId: lease.leaseId,
    projectRoot: lease.projectRoot,
    assetsPath: lease.assetsPath,
    unityInstanceHash: lease.unityInstanceHash,
    branch: lease.branch,
    baseBranch: lease.baseBranch,
    baseCommit: lease.baseCommit,
    startedAt: lease.startedAt,
  }
}

function checkpointMessage(cardLabel, completed) {
  const label = String(cardLabel ?? 'AI 위임 작업').replace(/\s+/g, ' ').trim().slice(0, 80)
  return {
    title: `[김용민] MNP 작업 체크포인트 - ${label}`,
    body: `[배경]\nMindNProgress가 독립 작업공간에 위임한 AI 작업 결과를 보존합니다.\n\n[원인]\n병렬 작업 결과는 통합 전에 작업별 커밋으로 고정해야 충돌과 누락을 판별할 수 있습니다.\n\n[수정]\n${completed ? '완료된 작업공간 변경을 체크포인트로 저장합니다.' : '완료되지 않은 작업의 현재 변경을 복구 가능한 체크포인트로 저장합니다.'}`,
  }
}

export function buildWorkspaceInstruction(lease) {
  if (!lease) return ''
  return `# 할당된 작업공간

- workspaceId: \`${lease.workspaceId}\`
- jobId: \`${lease.jobId}\`
- leaseId: \`${lease.leaseId}\`
- projectRoot: \`${lease.projectRoot}\`
- branch: \`${lease.branch}\`
- baseCommit: \`${lease.baseCommit}\`
- Unity assetsPath: \`${lease.assetsPath}\`
- Unity instance hash: \`${lease.unityInstanceHash}\`

이 작업에서는 위 \`projectRoot\`만 수정하세요. 다른 Holdem 작업공간으로 이동하거나 브랜치를 바꾸거나 lease를 직접 해제하지 마세요. \`.ai-session.json\`의 값이 위 정보와 일치하는지 먼저 확인하고, 공통 지식은 \`_AIShared\`에서 읽기 전용으로 사용하세요. 커밋과 작업공간 통합은 MindNProgress가 작업 종료 후 처리하므로 직접 커밋하지 마세요.`
}

export class WorkspacePoolManager {
  constructor({ registryFile, stateFile, gitRunner = defaultGitRunner } = {}) {
    this.registryFile = path.resolve(String(registryFile ?? '').trim())
    this.stateFile = path.resolve(String(stateFile ?? '').trim())
    this.git = gitRunner
    this.registry = null
    this.state = null
    this.queue = Promise.resolve()
  }

  runExclusive(operation) {
    const result = this.queue.catch(() => {}).then(operation)
    this.queue = result.catch(() => {})
    return result
  }

  async initialize() {
    return this.runExclusive(async () => {
      const rawRegistry = await readJson(this.registryFile, null)
      if (!rawRegistry) return false
      this.registry = normalizeRegistry(rawRegistry, this.registryFile)
      if (!this.registry.integration || this.registry.workers.length === 0) return false
      const stored = await readJson(this.stateFile, null)
      this.state = stored && typeof stored === 'object' ? stored : {
        schemaVersion: 1,
        poolId: this.registry.poolId,
        workspaces: {},
        leases: {},
        updatedAt: new Date().toISOString(),
      }
      this.state.workspaces ??= {}
      this.state.leases ??= {}
      this.state.integrationLeaseId ??= null
      this.state.poolId = this.registry.poolId
      for (const workspace of this.registry.workspaces) {
        this.state.workspaces[workspace.id] ??= {
          status: workspace.role === 'worker' ? 'idle' : 'integration',
          updatedAt: new Date().toISOString(),
        }
      }
      await this.persist()
      return true
    })
  }

  poolForWorkspace(workspace) {
    if (!this.registry || !String(workspace ?? '').trim()) return null
    const requested = normalizedPath(workspace)
    return this.registry.workspaces.some((candidate) => normalizedPath(candidate.root) === requested)
      ? this.registry
      : null
  }

  async acquire({ workspaceHint, mapId, cardId, conversationId, cardLabel } = {}) {
    return this.runExclusive(async () => {
      if (!this.poolForWorkspace(workspaceHint)) return null
      const integration = this.registry.integration
      const trackedChanges = await this.git(integration.root, ['status', '--porcelain', '--untracked-files=no'])
      if (trackedChanges) {
        throw new WorkspacePoolUnavailableError('통합 작업공간에 커밋되지 않은 추적 파일 변경이 있습니다.')
      }
      const [baseCommit, baseBranch] = await Promise.all([
        this.git(integration.root, ['rev-parse', 'HEAD']),
        this.git(integration.root, ['branch', '--show-current']),
      ])
      if (!baseCommit || !baseBranch) throw new WorkspacePoolUnavailableError('통합 작업공간의 Git 기준선을 확인하지 못했습니다.')

      const jobId = `job-${Date.now()}-${randomBytes(4).toString('hex')}`
      const leaseId = `lease-${randomBytes(16).toString('hex')}`
      const branch = `mnp/${jobId}`
      const failures = []
      for (const workspace of this.registry.workers) {
        const current = this.state.workspaces[workspace.id] ?? { status: 'idle' }
        if (current.status !== 'idle') continue
        this.state.workspaces[workspace.id] = {
          ...current,
          status: 'preparing',
          jobId,
          leaseId,
          updatedAt: new Date().toISOString(),
        }
        await this.persist()
        try {
          const sessionFile = path.join(workspace.root, '.ai-session.json')
          if (await exists(sessionFile)) throw new Error('.ai-session.json이 이미 존재합니다.')
          const dirty = await this.git(workspace.root, ['status', '--porcelain', '--untracked-files=all'])
          if (dirty) throw new Error('작업공간에 소유자를 확정할 수 없는 변경이 있습니다.')
          const originUrl = await this.git(workspace.root, ['remote', 'get-url', 'origin'])
          if (this.registry.originUrl && originUrl !== this.registry.originUrl) {
            throw new Error('작업공간 origin URL이 registry와 일치하지 않습니다.')
          }
          await this.git(workspace.root, ['fetch', '--no-tags', integration.root, `refs/heads/${baseBranch}`])
          await this.git(workspace.root, ['branch', branch, baseCommit])
          await this.git(workspace.root, ['switch', branch])
          const startedAt = new Date().toISOString()
          const lease = {
            schemaVersion: 1,
            poolId: this.registry.poolId,
            workspaceId: workspace.id,
            jobId,
            leaseId,
            projectRoot: workspace.root,
            assetsPath: workspace.assetsPath ?? path.join(workspace.root, 'Assets'),
            unityInstanceHash: String(workspace.unityInstanceHash ?? ''),
            branch,
            baseBranch,
            baseCommit,
            integrationWorkspaceId: integration.id,
            mapId: String(mapId ?? ''),
            cardId: String(cardId ?? ''),
            cardLabel: String(cardLabel ?? ''),
            conversationId: String(conversationId ?? ''),
            startedAt,
            status: 'leased',
          }
          await atomicJson(sessionFile, {
            schemaVersion: 1,
            workspaceId: lease.workspaceId,
            jobId,
            leaseId,
            conversationId: lease.conversationId,
            projectRoot: lease.projectRoot,
            branch,
            baseCommit,
            knowledgeMode: 'read-only',
            startedAt,
          })
          this.state.leases[leaseId] = lease
          this.state.workspaces[workspace.id] = {
            status: 'leased',
            jobId,
            leaseId,
            updatedAt: startedAt,
          }
          await this.persist()
          return publicLease(lease)
        } catch (error) {
          const reason = error?.message ?? String(error)
          failures.push({ workspaceId: workspace.id, reason })
          this.state.workspaces[workspace.id] = {
            status: 'quarantined',
            reason,
            jobId,
            leaseId,
            updatedAt: new Date().toISOString(),
          }
          await this.persist()
        }
      }
      throw new WorkspacePoolUnavailableError('사용 가능한 AI 작업공간이 없습니다.', failures)
    })
  }

  async reuseLease(leaseId, { mapId, cardId, conversationId } = {}) {
    return this.runExclusive(async () => {
      const normalizedLeaseId = String(leaseId ?? '').trim()
      const normalizedConversationId = String(conversationId ?? '').trim()
      const lease = this.state?.leases?.[normalizedLeaseId]
      if (!lease || lease.status !== 'leased') {
        throw new WorkspacePoolUnavailableError('이어갈 AI 작업공간 lease를 찾지 못했습니다.')
      }
      if (lease.mapId !== String(mapId ?? '') || lease.cardId !== String(cardId ?? '')) {
        throw new WorkspacePoolUnavailableError('이어갈 AI 작업공간 lease의 문서 또는 카드가 일치하지 않습니다.')
      }
      if (!normalizedConversationId) {
        throw new WorkspacePoolUnavailableError('이어갈 AI 작업공간 lease에 연결할 대화 ID가 없습니다.')
      }
      if (lease.conversationId && lease.conversationId !== normalizedConversationId) {
        throw new WorkspacePoolUnavailableError('이어갈 AI 작업공간 lease가 다른 대화에 연결되어 있습니다.')
      }

      const workspace = this.registry?.workspaces.find((candidate) => candidate.id === lease.workspaceId)
      const workspaceState = this.state?.workspaces?.[lease.workspaceId]
      if (!workspace || workspaceState?.status !== 'leased' || workspaceState?.leaseId !== normalizedLeaseId) {
        throw new WorkspacePoolUnavailableError('이어갈 AI 작업공간의 점유 상태가 lease와 일치하지 않습니다.')
      }
      const sessionFile = path.join(workspace.root, '.ai-session.json')
      const session = await readJson(sessionFile, null)
      if (!session
        || session.workspaceId !== lease.workspaceId
        || session.jobId !== lease.jobId
        || session.leaseId !== normalizedLeaseId) {
        throw new WorkspacePoolUnavailableError('이어갈 AI 작업공간의 세션 파일이 lease와 일치하지 않습니다.')
      }
      const currentBranch = await this.git(workspace.root, ['branch', '--show-current'])
      if (currentBranch !== lease.branch) {
        throw new WorkspacePoolUnavailableError(`이어갈 AI 작업공간 브랜치가 ${lease.branch}가 아닙니다.`)
      }

      const updatedAt = new Date().toISOString()
      lease.conversationId = normalizedConversationId
      lease.updatedAt = updatedAt
      this.state.workspaces[lease.workspaceId] = {
        ...workspaceState,
        updatedAt,
      }
      await atomicJson(sessionFile, {
        ...session,
        conversationId: normalizedConversationId,
        updatedAt,
      })
      await this.persist()
      return publicLease(lease)
    })
  }

  async bindConversation(leaseId, conversationId) {
    return this.runExclusive(async () => {
      const normalizedLeaseId = String(leaseId ?? '').trim()
      const normalizedConversationId = String(conversationId ?? '').trim()
      const lease = this.state?.leases?.[normalizedLeaseId]
      if (!lease || lease.status !== 'leased' || !normalizedConversationId) return null
      if (lease.conversationId && lease.conversationId !== normalizedConversationId) {
        throw new WorkspacePoolUnavailableError('AI 작업공간 lease가 이미 다른 대화에 연결되어 있습니다.')
      }
      const workspace = this.registry?.workspaces.find((candidate) => candidate.id === lease.workspaceId)
      if (!workspace) return null
      const sessionFile = path.join(workspace.root, '.ai-session.json')
      const session = await readJson(sessionFile, null)
      if (!session || session.leaseId !== normalizedLeaseId) {
        throw new WorkspacePoolUnavailableError('AI 작업공간의 세션 파일이 lease와 일치하지 않습니다.')
      }
      if (lease.conversationId === normalizedConversationId && session.conversationId === normalizedConversationId) {
        return publicLease(lease)
      }
      const updatedAt = new Date().toISOString()
      lease.conversationId = normalizedConversationId
      lease.updatedAt = updatedAt
      await atomicJson(sessionFile, {
        ...session,
        conversationId: normalizedConversationId,
        updatedAt,
      })
      await this.persist()
      return publicLease(lease)
    })
  }

  async finalize(leaseId, { childStatus, childError, cardLabel } = {}) {
    return this.runExclusive(async () => {
      const lease = this.state?.leases?.[leaseId]
      if (!lease) return null
      if (['completed', 'quarantined'].includes(lease.status)) return lease.result ?? null
      if (lease.status === 'awaiting-conflict-resolution') return lease.result ?? null
      if (lease.status === 'waiting-integration'
        && this.state.integrationLeaseId
        && this.state.integrationLeaseId !== leaseId) {
        return lease.result ?? null
      }
      const workspace = this.registry.workspaces.find((candidate) => candidate.id === lease.workspaceId)
      const integration = this.registry.integration
      if (!workspace || !integration) throw new WorkspacePoolIntegrationError('작업공간 registry 항목을 찾지 못했습니다.')
      const completed = childStatus === 'completed'
      this.state.workspaces[workspace.id] = {
        status: 'finalizing',
        jobId: lease.jobId,
        leaseId,
        updatedAt: new Date().toISOString(),
      }
      lease.status = 'finalizing'
      await this.persist()

      let headCommit = null
      let integratedCommit = null
      try {
        const currentBranch = await this.git(workspace.root, ['branch', '--show-current'])
        if (!lease.integrationBranch && currentBranch !== lease.branch) {
          throw new Error(`예상 브랜치 ${lease.branch}가 아닌 ${currentBranch}입니다.`)
        }
        const dirty = await this.git(workspace.root, ['status', '--porcelain', '--untracked-files=all'])
        if (dirty && !lease.integrationBranch) {
          const message = checkpointMessage(cardLabel ?? lease.cardLabel, completed)
          await this.git(workspace.root, ['add', '-A'])
          await this.git(workspace.root, ['commit', '-m', message.title, '-m', message.body])
        }
        headCommit = lease.headCommit ?? await this.git(workspace.root, ['rev-parse', 'HEAD'])
        if (headCommit !== lease.baseCommit) {
          await this.git(workspace.root, ['merge-base', '--is-ancestor', lease.baseCommit, headCommit])
        }
        const commits = lease.commits ?? (headCommit === lease.baseCommit
          ? []
          : (await this.git(workspace.root, ['rev-list', '--reverse', `${lease.baseCommit}..${headCommit}`]))
            .split(/\r?\n/).map((commit) => commit.trim()).filter(Boolean))
        lease.headCommit = headCommit
        lease.commits = commits

        if (!completed) {
          throw new WorkspacePoolIntegrationError('하위 AI 작업이 완료되지 않아 변경을 통합하지 않았습니다.', {
            childStatus,
            childError: childError ?? null,
            headCommit,
          })
        }
        if (commits.length === 0) {
          return await this.completeLease(lease, workspace, {
            status: 'completed',
            childStatus,
            childError: childError ?? null,
            headCommit,
            integratedCommit: null,
            completedAt: new Date().toISOString(),
          })
        }

        if (lease.integrationBranch
          && currentBranch === lease.integrationBranch
          && this.state.integrationLeaseId === leaseId) {
          const unmerged = await this.git(workspace.root, ['diff', '--name-only', '--diff-filter=U'])
          if (unmerged) return await this.awaitConflictResolution(lease, workspace, unmerged)
          if (await this.gitPathExists(workspace.root, 'CHERRY_PICK_HEAD')) {
            return await this.awaitConflictResolution(lease, workspace, '(cherry-pick --continue 필요)')
          }
          if (dirty) throw new Error('중단된 통합 브랜치에 소유자를 확정할 수 없는 변경이 있습니다.')
          integratedCommit = await this.applyIntegration(lease, workspace, integration)
          return await this.completeLease(lease, workspace, {
            status: 'completed',
            childStatus,
            childError: childError ?? null,
            headCommit,
            integratedCommit,
            integrationBaseCommit: lease.integrationBaseCommit,
            recoveredIntegration: true,
            completedAt: new Date().toISOString(),
          })
        }

        if (this.state.integrationLeaseId && this.state.integrationLeaseId !== leaseId) {
          const result = await this.writeResult(lease, {
            status: 'waiting-integration',
            childStatus,
            childError: childError ?? null,
            headCommit,
            blockingLeaseId: this.state.integrationLeaseId,
            updatedAt: new Date().toISOString(),
          })
          lease.status = 'waiting-integration'
          lease.result = result
          this.state.workspaces[workspace.id] = {
            status: 'waiting-integration',
            jobId: lease.jobId,
            leaseId,
            updatedAt: result.updatedAt,
          }
          await this.persist()
          return result
        }

        this.state.integrationLeaseId = leaseId
        const integrationDirty = await this.git(integration.root, ['status', '--porcelain', '--untracked-files=no'])
        if (integrationDirty) throw new Error('통합 작업공간에 커밋되지 않은 추적 파일 변경이 있습니다.')
        const integrationBranchName = await this.git(integration.root, ['branch', '--show-current'])
        if (integrationBranchName !== lease.baseBranch) {
          throw new Error(`통합 작업공간 브랜치가 ${lease.baseBranch}가 아닙니다.`)
        }
        const integrationBaseCommit = await this.git(integration.root, ['rev-parse', 'HEAD'])
        const integrationBranch = lease.integrationBranch ?? `mnp/integrate/${lease.jobId}`
        lease.integrationBranch = integrationBranch
        lease.integrationBaseCommit = integrationBaseCommit
        lease.integrationAttempt = Number(lease.integrationAttempt ?? 0) + 1
        lease.status = 'integrating'
        this.state.workspaces[workspace.id] = {
          status: 'integrating',
          jobId: lease.jobId,
          leaseId,
          updatedAt: new Date().toISOString(),
        }
        await this.persist()

        await this.git(workspace.root, ['fetch', '--no-tags', integration.root, `refs/heads/${lease.baseBranch}`])
        await this.git(workspace.root, ['switch', '-C', integrationBranch, integrationBaseCommit])
        try {
          await this.git(workspace.root, ['cherry-pick', ...commits])
        } catch (error) {
          const unmerged = await this.git(workspace.root, ['diff', '--name-only', '--diff-filter=U'])
          if (unmerged) return await this.awaitConflictResolution(lease, workspace, unmerged)
          throw error
        }
        integratedCommit = await this.applyIntegration(lease, workspace, integration)
        return await this.completeLease(lease, workspace, {
          status: 'completed',
          childStatus,
          childError: childError ?? null,
          headCommit,
          integratedCommit,
          integrationBaseCommit,
          completedAt: new Date().toISOString(),
        })
      } catch (error) {
        throw await this.quarantineIntegrationFailure(lease, workspace, error, {
          childStatus: childStatus ?? null,
          childError: childError ?? null,
          headCommit,
          integratedCommit,
        })
      }
    })
  }

  async completeConflictResolution(leaseId, { childStatus, childError } = {}) {
    return this.runExclusive(async () => {
      const lease = this.state?.leases?.[leaseId]
      if (!lease) return null
      if (['completed', 'quarantined'].includes(lease.status)) return lease.result ?? null
      const workspace = this.registry.workspaces.find((candidate) => candidate.id === lease.workspaceId)
      const integration = this.registry.integration
      if (!workspace || !integration) throw new WorkspacePoolIntegrationError('작업공간 registry 항목을 찾지 못했습니다.')
      try {
        if (this.state.integrationLeaseId !== leaseId) throw new Error('통합 잠금 소유권이 현재 lease와 일치하지 않습니다.')
        if (childStatus !== 'completed') {
          throw new WorkspacePoolIntegrationError('충돌 해결 AI 작업이 완료되지 않았습니다.', {
            childStatus,
            childError: childError ?? null,
          })
        }
        const currentBranch = await this.git(workspace.root, ['branch', '--show-current'])
        if (currentBranch !== lease.integrationBranch) {
          throw new Error(`통합 브랜치 ${lease.integrationBranch}가 아닌 ${currentBranch}입니다.`)
        }
        let unmerged = await this.git(workspace.root, ['diff', '--name-only', '--diff-filter=U'])
        if (unmerged) return await this.awaitConflictResolution(lease, workspace, unmerged)

        const cherryPickHead = await this.gitPathExists(workspace.root, 'CHERRY_PICK_HEAD')
        if (cherryPickHead) {
          await this.git(workspace.root, ['add', '-A'])
          try {
            await this.git(workspace.root, ['-c', 'core.editor=true', 'cherry-pick', '--continue'])
          } catch (error) {
            unmerged = await this.git(workspace.root, ['diff', '--name-only', '--diff-filter=U'])
            if (unmerged) return await this.awaitConflictResolution(lease, workspace, unmerged)
            throw error
          }
        }

        const remainingChanges = await this.git(workspace.root, ['status', '--porcelain', '--untracked-files=all'])
        if (remainingChanges) {
          const message = checkpointMessage(`${lease.cardLabel} 통합 보완`, true)
          await this.git(workspace.root, ['add', '-A'])
          await this.git(workspace.root, ['commit', '-m', message.title, '-m', message.body])
        }
        const integratedCommit = await this.applyIntegration(lease, workspace, integration)
        return await this.completeLease(lease, workspace, {
          status: 'completed',
          childStatus,
          childError: childError ?? null,
          headCommit: lease.headCommit,
          integratedCommit,
          integrationBaseCommit: lease.integrationBaseCommit,
          conflictResolvedByAi: true,
          completedAt: new Date().toISOString(),
        })
      } catch (error) {
        throw await this.quarantineIntegrationFailure(lease, workspace, error, {
          childStatus: childStatus ?? null,
          childError: childError ?? null,
          headCommit: lease.headCommit ?? null,
        })
      }
    })
  }

  async gitPathExists(root, name) {
    const gitPath = await this.git(root, ['rev-parse', '--git-path', name])
    return exists(path.resolve(root, gitPath))
  }

  async awaitConflictResolution(lease, workspace, unmerged) {
    lease.conflictRound = Number(lease.conflictRound ?? 0) + 1
    if (lease.conflictRound > 3) throw new Error('AI 충돌 해결 재시도 한도(3회)를 초과했습니다.')
    const updatedAt = new Date().toISOString()
    await atomicJson(path.join(workspace.root, '.ai-session.json'), {
      schemaVersion: 1,
      workspaceId: lease.workspaceId,
      jobId: lease.jobId,
      leaseId: lease.leaseId,
      projectRoot: lease.projectRoot,
      branch: lease.integrationBranch,
      baseCommit: lease.integrationBaseCommit,
      phase: 'integration-conflict',
      knowledgeMode: 'read-only',
      startedAt: lease.startedAt,
      updatedAt,
    })
    const result = await this.writeResult(lease, {
      status: 'awaiting-conflict-resolution',
      childStatus: 'completed',
      headCommit: lease.headCommit,
      integrationBaseCommit: lease.integrationBaseCommit,
      integrationBranch: lease.integrationBranch,
      conflictRound: lease.conflictRound,
      unmergedFiles: unmerged.split(/\r?\n/).map((file) => file.trim()).filter(Boolean),
      updatedAt,
    })
    lease.status = 'awaiting-conflict-resolution'
    lease.result = result
    this.state.workspaces[workspace.id] = {
      status: 'resolving-integration-conflict',
      jobId: lease.jobId,
      leaseId: lease.leaseId,
      updatedAt,
    }
    await this.persist()
    return result
  }

  async applyIntegration(lease, workspace, integration) {
    const remainingChanges = await this.git(workspace.root, ['status', '--porcelain', '--untracked-files=all'])
    if (remainingChanges) throw new Error('통합 브랜치에 커밋되지 않은 변경이 남아 있습니다.')
    const integrationHead = await this.git(workspace.root, ['rev-parse', 'HEAD'])
    const integrationDirty = await this.git(integration.root, ['status', '--porcelain', '--untracked-files=no'])
    if (integrationDirty) throw new Error('통합 작업공간에 커밋되지 않은 추적 파일 변경이 있습니다.')
    const integrationBranchName = await this.git(integration.root, ['branch', '--show-current'])
    if (integrationBranchName !== lease.baseBranch) {
      throw new Error(`통합 작업공간 브랜치가 ${lease.baseBranch}가 아닙니다.`)
    }
    const currentIntegrationHead = await this.git(integration.root, ['rev-parse', 'HEAD'])
    if (currentIntegrationHead === integrationHead) return integrationHead
    if (currentIntegrationHead !== lease.integrationBaseCommit) {
      throw new Error('충돌 해결 중 통합 작업공간의 HEAD가 변경되었습니다.')
    }
    await this.git(integration.root, ['fetch', '--no-tags', workspace.root, `refs/heads/${lease.integrationBranch}`])
    const verifiedIntegrationHead = await this.git(integration.root, ['rev-parse', 'HEAD'])
    if (verifiedIntegrationHead === integrationHead) return integrationHead
    if (verifiedIntegrationHead !== lease.integrationBaseCommit) {
      throw new Error('통합 직전에 통합 작업공간의 HEAD가 변경되었습니다.')
    }
    await this.git(integration.root, ['merge', '--ff-only', integrationHead])
    return this.git(integration.root, ['rev-parse', 'HEAD'])
  }

  async completeLease(lease, workspace, resultFields) {
    await this.git(workspace.root, ['switch', lease.baseBranch])
    await rm(path.join(workspace.root, '.ai-session.json'), { force: true })
    const result = await this.writeResult(lease, resultFields)
    lease.status = 'completed'
    lease.result = result
    if (this.state.integrationLeaseId === lease.leaseId) this.state.integrationLeaseId = null
    this.state.workspaces[workspace.id] = {
      status: 'idle',
      lastJobId: lease.jobId,
      lastLeaseId: lease.leaseId,
      updatedAt: result.completedAt,
    }
    await this.persist()
    return result
  }

  async quarantineIntegrationFailure(lease, workspace, error, resultFields = {}) {
    const reason = error?.message ?? String(error)
    const completedAt = new Date().toISOString()
    const result = await this.writeResult(lease, {
      status: 'quarantined',
      headCommit: lease.headCommit ?? lease.result?.headCommit ?? null,
      integrationBaseCommit: lease.integrationBaseCommit ?? lease.result?.integrationBaseCommit ?? null,
      integrationBranch: lease.integrationBranch ?? lease.result?.integrationBranch ?? null,
      conflictRound: lease.conflictRound ?? lease.result?.conflictRound ?? null,
      unmergedFiles: lease.result?.unmergedFiles ?? [],
      ...resultFields,
      error: reason,
      completedAt,
    })
    lease.status = 'quarantined'
    lease.result = result
    if (this.state.integrationLeaseId === lease.leaseId) this.state.integrationLeaseId = null
    this.state.workspaces[workspace.id] = {
      status: 'quarantined',
      reason,
      jobId: lease.jobId,
      leaseId: lease.leaseId,
      updatedAt: completedAt,
    }
    await this.persist()
    return new WorkspacePoolIntegrationError(reason, result)
  }

  async cancel(leaseId, reason = '작업 시작 전에 위임이 취소되었습니다.') {
    return this.runExclusive(async () => {
      const lease = this.state?.leases?.[leaseId]
      if (!lease || ['completed', 'cancelled', 'quarantined'].includes(lease.status)) return lease?.result ?? null
      const workspace = this.registry.workspaces.find((candidate) => candidate.id === lease.workspaceId)
      if (!workspace) return null
      try {
        const dirty = await this.git(workspace.root, ['status', '--porcelain', '--untracked-files=all'])
        if (dirty) throw new Error('취소된 작업공간에 변경이 남아 있어 자동 회수하지 않았습니다.')
        await this.git(workspace.root, ['switch', lease.baseBranch])
        await rm(path.join(workspace.root, '.ai-session.json'), { force: true })
        const result = await this.writeResult(lease, {
          status: 'cancelled',
          error: reason,
          completedAt: new Date().toISOString(),
        })
        lease.status = 'cancelled'
        lease.result = result
        this.state.workspaces[workspace.id] = {
          status: 'idle',
          lastJobId: lease.jobId,
          lastLeaseId: leaseId,
          updatedAt: result.completedAt,
        }
        await this.persist()
        return result
      } catch (error) {
        const quarantineReason = error?.message ?? String(error)
        const result = await this.writeResult(lease, {
          status: 'quarantined',
          error: quarantineReason,
          completedAt: new Date().toISOString(),
        })
        lease.status = 'quarantined'
        lease.result = result
        this.state.workspaces[workspace.id] = {
          status: 'quarantined',
          reason: quarantineReason,
          jobId: lease.jobId,
          leaseId,
          updatedAt: result.completedAt,
        }
        await this.persist()
        return result
      }
    })
  }

  async quarantine(leaseId, reason) {
    return this.runExclusive(async () => {
      const lease = this.state?.leases?.[leaseId]
      if (!lease) return null
      if (lease.status === 'quarantined') return lease.result ?? null
      const completedAt = new Date().toISOString()
      const result = await this.writeResult(lease, {
        status: 'quarantined',
        headCommit: lease.headCommit ?? lease.result?.headCommit ?? null,
        integrationBaseCommit: lease.integrationBaseCommit ?? lease.result?.integrationBaseCommit ?? null,
        integrationBranch: lease.integrationBranch ?? lease.result?.integrationBranch ?? null,
        conflictRound: lease.conflictRound ?? lease.result?.conflictRound ?? null,
        unmergedFiles: lease.result?.unmergedFiles ?? [],
        error: String(reason ?? '작업 상태를 확정할 수 없습니다.'),
        completedAt,
      })
      lease.status = 'quarantined'
      lease.result = result
      if (this.state.integrationLeaseId === leaseId) this.state.integrationLeaseId = null
      this.state.workspaces[lease.workspaceId] = {
        status: 'quarantined',
        reason: result.error,
        jobId: lease.jobId,
        leaseId,
        updatedAt: completedAt,
      }
      await this.persist()
      return result
    })
  }

  async writeResult(lease, result) {
    const stored = {
      schemaVersion: 1,
      poolId: lease.poolId,
      workspaceId: lease.workspaceId,
      jobId: lease.jobId,
      leaseId: lease.leaseId,
      mapId: lease.mapId,
      cardId: lease.cardId,
      conversationId: lease.conversationId,
      branch: lease.branch,
      baseBranch: lease.baseBranch,
      baseCommit: lease.baseCommit,
      ...result,
    }
    await atomicJson(path.join(this.registry.sharedRoot, 'job-results', `${lease.jobId}.json`), stored)
    return stored
  }

  async persist() {
    if (!this.state) return
    this.state.updatedAt = new Date().toISOString()
    await atomicJson(this.stateFile, this.state)
  }
}
