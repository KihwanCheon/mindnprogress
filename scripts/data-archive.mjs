import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const archiveProduct = 'MindNProgress'
const archiveFormatVersion = 1

function comparablePath(value) {
  const resolved = path.resolve(value).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

export function isSameOrInside(candidate, parent) {
  const candidatePath = comparablePath(candidate)
  const parentPath = comparablePath(parent)
  return candidatePath === parentPath || candidatePath.startsWith(`${parentPath}${path.sep}`)
}

function assertPathOutside(candidate, parent, message) {
  if (isSameOrInside(candidate, parent)) throw new Error(`${message}: ${candidate}`)
}

async function pathExists(candidate) {
  try {
    await stat(candidate)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function assertDirectory(candidate, description) {
  let info
  try {
    info = await stat(candidate)
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`${description}을(를) 찾지 못했습니다: ${candidate}`)
    throw error
  }
  if (!info.isDirectory()) throw new Error(`${description}이(가) 폴더가 아닙니다: ${candidate}`)
}

async function copyDirectory(source, destination) {
  await mkdir(destination, { recursive: true })
  const entries = await readdir(source, { withFileTypes: true })
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name)
    const destinationPath = path.join(destination, entry.name)
    const sourceInfo = await lstat(sourcePath)
    if (sourceInfo.isSymbolicLink()) {
      throw new Error(`백업 대상에 심볼릭 링크가 있어 중단했습니다: ${sourcePath}`)
    }
    if (sourceInfo.isDirectory()) {
      await copyDirectory(sourcePath, destinationPath)
    } else if (sourceInfo.isFile()) {
      await copyFile(sourcePath, destinationPath)
    } else {
      throw new Error(`지원하지 않는 파일 형식이 백업 대상에 있습니다: ${sourcePath}`)
    }
  }
}

async function listFiles(root, current = root) {
  const result = []
  const entries = await readdir(current, { withFileTypes: true })
  for (const entry of entries) {
    const candidate = path.join(current, entry.name)
    if (entry.isDirectory()) result.push(...await listFiles(root, candidate))
    else if (entry.isFile()) result.push(candidate)
  }
  return result
}

async function sha256(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex')
}

function relativeArchivePath(filePath, root) {
  const relativePath = path.relative(root, filePath).split(path.sep).join('/')
  if (!relativePath || relativePath.startsWith('../') || path.isAbsolute(relativePath)) {
    throw new Error(`파일이 백업 작업 폴더 밖에 있습니다: ${filePath}`)
  }
  return relativePath
}

function assertSafeArchiveEntry(entry) {
  const normalized = String(entry).replaceAll('\\', '/').replace(/^\.\//, '')
  if (!normalized || normalized === '.') return
  if (normalized.startsWith('/') || /^[a-z]:\//i.test(normalized)) {
    throw new Error(`ZIP에 절대 경로가 포함되어 있습니다: ${entry}`)
  }
  const segments = normalized.split('/').filter(Boolean)
  if (segments.includes('..')) throw new Error(`ZIP에 상위 폴더 경로가 포함되어 있습니다: ${entry}`)
}

async function runArchiveCommand(command, args, options = {}) {
  try {
    return await execFileAsync(command, args, {
      ...options,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    })
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`macOS 기본 명령 '${command}'을(를) 찾지 못했습니다.`)
    }
    const detail = String(error?.stderr ?? error?.message ?? '').trim()
    throw new Error(`${command} 실행에 실패했습니다${detail ? `: ${detail}` : '.'}`)
  }
}

async function createZip(sourceDirectory, archivePath) {
  if (process.platform === 'win32') {
    throw new Error('이 명령은 macOS/Linux용입니다. Windows에서는 MindNProgress_Backup.bat을 사용하세요.')
  }
  await runArchiveCommand('zip', ['-q', '-r', archivePath, '.'], { cwd: sourceDirectory })
}

async function extractZip(archivePath, destination) {
  if (process.platform === 'win32') {
    throw new Error('이 명령은 macOS/Linux용입니다. Windows에서는 MindNProgress_Restore.bat을 사용하세요.')
  }
  const { stdout } = await runArchiveCommand('unzip', ['-Z1', archivePath])
  for (const entry of stdout.split(/\r?\n/).filter(Boolean)) assertSafeArchiveEntry(entry)
  await runArchiveCommand('unzip', ['-q', '-o', archivePath, '-d', destination])
}

async function gitValue(projectDirectory, args) {
  try {
    const { stdout } = await execFileAsync('git', ['-C', projectDirectory, ...args], { encoding: 'utf8' })
    return stdout.trim()
  } catch {
    return ''
  }
}

async function mindNProgressIsRunning(port = Number(process.env.MNP_API_PORT ?? 4176)) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(750),
    })
    if (!response.ok) return false
    const body = await response.json().catch(() => null)
    return body?.status === 'ok'
  } catch {
    return false
  }
}

function timestampParts(now) {
  const pad = (value) => String(value).padStart(2, '0')
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return { date, time }
}

async function nextArchivePath(dateDirectory, date, time) {
  const baseName = `${archiveProduct}_${date}_${time}`
  let sequence = 0
  while (true) {
    const suffix = sequence === 0 ? '' : `-${String(sequence).padStart(2, '0')}`
    const candidate = path.join(dateDirectory, `${baseName}${suffix}.zip`)
    if (!await pathExists(candidate)) return candidate
    sequence += 1
  }
}

async function buildManifest(stagingDirectory, projectDirectory, dataSource, now) {
  const files = (await listFiles(stagingDirectory))
    .filter((filePath) => path.basename(filePath) !== 'manifest.json')
    .sort((first, second) => first.localeCompare(second))
  const entries = []
  let totalBytes = 0
  for (const filePath of files) {
    const info = await stat(filePath)
    totalBytes += info.size
    entries.push({
      path: relativeArchivePath(filePath, stagingDirectory),
      size: info.size,
      sha256: await sha256(filePath),
    })
  }
  const [sourceCommit, sourceBranch, sourceStatus] = await Promise.all([
    gitValue(projectDirectory, ['rev-parse', 'HEAD']),
    gitValue(projectDirectory, ['branch', '--show-current']),
    gitValue(projectDirectory, ['status', '--porcelain']),
  ])
  return {
    formatVersion: archiveFormatVersion,
    product: archiveProduct,
    createdAt: now.toISOString(),
    sourceCommit,
    sourceBranch,
    sourceDirty: Boolean(sourceStatus),
    sourceDataPath: dataSource,
    fileCount: entries.length,
    totalBytes,
    files: entries,
  }
}

export async function verifyBackupPayload(extractedRoot) {
  const manifestPath = path.join(extractedRoot, 'manifest.json')
  let manifest
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch {
    throw new Error('백업 검증에 필요한 manifest.json이 없거나 올바르지 않습니다.')
  }
  if (manifest?.formatVersion !== archiveFormatVersion || manifest?.product !== archiveProduct) {
    throw new Error('지원하지 않는 MindNProgress 백업 형식입니다.')
  }
  if (!Array.isArray(manifest.files) || manifest.fileCount !== manifest.files.length) {
    throw new Error('백업 manifest의 파일 목록이 올바르지 않습니다.')
  }
  const seen = new Set()
  let totalBytes = 0
  for (const entry of manifest.files) {
    assertSafeArchiveEntry(entry?.path)
    const relativePath = String(entry.path).replaceAll('/', path.sep)
    if (seen.has(relativePath)) throw new Error(`백업 manifest에 중복 파일이 있습니다: ${entry.path}`)
    seen.add(relativePath)
    const filePath = path.resolve(extractedRoot, relativePath)
    if (!isSameOrInside(filePath, extractedRoot)) throw new Error(`백업 파일 경로가 올바르지 않습니다: ${entry.path}`)
    let info
    try {
      info = await stat(filePath)
    } catch {
      throw new Error(`백업 파일이 누락되었습니다: ${entry.path}`)
    }
    if (!info.isFile() || info.size !== entry.size) {
      throw new Error(`백업 파일 크기가 일치하지 않습니다: ${entry.path}`)
    }
    if (await sha256(filePath) !== String(entry.sha256).toLowerCase()) {
      throw new Error(`백업 파일 해시가 일치하지 않습니다: ${entry.path}`)
    }
    totalBytes += info.size
  }
  if (manifest.totalBytes !== totalBytes) throw new Error('백업의 전체 파일 크기가 manifest와 일치하지 않습니다.')
  return manifest
}

export async function createBackup({
  projectDirectory,
  destination,
  dataDirectory,
  checkServer = true,
  now = new Date(),
} = {}) {
  const resolvedProject = path.resolve(projectDirectory ?? path.join(import.meta.dirname, '..'))
  const dataSource = path.resolve(resolvedProject, dataDirectory ?? process.env.MNP_DATA_DIR ?? path.join('server', 'data'))
  const backupRoot = path.resolve(
    resolvedProject,
    destination ?? process.env.MNP_BACKUP_DIR ?? path.join(homedir(), 'Documents', 'MindNProgress_Backup'),
  )
  await assertDirectory(dataSource, '백업할 MindNProgress 데이터 폴더')
  assertPathOutside(backupRoot, resolvedProject, '백업 폴더를 Git 저장소 내부에 둘 수 없습니다')
  assertPathOutside(backupRoot, dataSource, '백업 폴더를 데이터 폴더 내부에 둘 수 없습니다')
  if (checkServer && await mindNProgressIsRunning()) {
    throw new Error('일관된 백업을 위해 실행 중인 MindNProgress를 먼저 Ctrl+C로 종료해 주세요.')
  }

  const { date, time } = timestampParts(now)
  const dateDirectory = path.join(backupRoot, date)
  await mkdir(dateDirectory, { recursive: true })
  const archivePath = await nextArchivePath(dateDirectory, date, time)
  const operationId = `${process.pid}-${Date.now()}`
  const stagingDirectory = path.join(dateDirectory, `.staging-${operationId}`)
  const verificationDirectory = path.join(dateDirectory, `.verify-${operationId}`)
  const partialArchive = `${archivePath}.partial.zip`

  try {
    await mkdir(path.join(stagingDirectory, 'server'), { recursive: true })
    await copyDirectory(dataSource, path.join(stagingDirectory, 'server', 'data'))

    const projectEntries = await readdir(resolvedProject, { withFileTypes: true })
    const localConfigs = projectEntries.filter((entry) => entry.isFile()
      && (entry.name === '.env' || entry.name.startsWith('.env.') || entry.name.endsWith('.local')))
    if (localConfigs.length > 0) {
      const localConfigDirectory = path.join(stagingDirectory, 'local-config')
      await mkdir(localConfigDirectory, { recursive: true })
      for (const entry of localConfigs) {
        await copyFile(path.join(resolvedProject, entry.name), path.join(localConfigDirectory, entry.name))
      }
    }

    const restoreGuide = `MindNProgress 전체 데이터 백업\n\n생성 시각: ${now.toISOString()}\n\n권장 복원 방법\n1. 이 백업을 만든 소스와 동일한 MindNProgress 버전을 준비합니다.\n2. macOS에서는 MindNProgress_Restore.command에 이 ZIP을 전달하고, Windows에서는 MindNProgress_Restore.bat을 사용합니다.\n3. 복원 도구가 manifest.json의 크기와 SHA-256을 검증한 뒤 server/data를 교체합니다.\n\n주의: 복원 전에 MindNProgress를 종료해야 합니다. 이 백업에는 계정, 세션, MCP 토큰이 포함되므로 외부에 공유하지 마세요.\n데이터 마이그레이션은 수행하지 않으므로 다른 버전으로 복원하는 것은 보장하지 않습니다.\n`
    await writeFile(path.join(stagingDirectory, 'RESTORE.txt'), restoreGuide, 'utf8')
    const manifest = await buildManifest(stagingDirectory, resolvedProject, dataSource, now)
    await writeFile(path.join(stagingDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

    await createZip(stagingDirectory, partialArchive)
    await mkdir(verificationDirectory, { recursive: true })
    await extractZip(partialArchive, verificationDirectory)
    await verifyBackupPayload(verificationDirectory)
    await rename(partialArchive, archivePath)
    const archiveInfo = await stat(archivePath)
    return { archivePath, archiveBytes: archiveInfo.size, manifest }
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true })
    await rm(verificationDirectory, { recursive: true, force: true })
    await rm(partialArchive, { force: true })
  }
}

export async function restoreBackup({
  archivePath,
  projectDirectory,
  dataDirectory,
  checkServer = true,
  now = new Date(),
} = {}) {
  if (!archivePath) throw new Error('복원할 ZIP 파일 경로를 지정해 주세요.')
  const resolvedArchive = path.resolve(archivePath)
  const resolvedProject = path.resolve(projectDirectory ?? path.join(import.meta.dirname, '..'))
  const dataTarget = path.resolve(resolvedProject, dataDirectory ?? process.env.MNP_DATA_DIR ?? path.join('server', 'data'))
  if (!await pathExists(resolvedArchive)) throw new Error(`복원할 ZIP 파일을 찾지 못했습니다: ${resolvedArchive}`)
  if (path.extname(resolvedArchive).toLowerCase() !== '.zip') throw new Error('MindNProgress ZIP 백업만 복원할 수 있습니다.')
  if (checkServer && await mindNProgressIsRunning()) {
    throw new Error('안전한 복원을 위해 실행 중인 MindNProgress를 먼저 Ctrl+C로 종료해 주세요.')
  }

  await mkdir(path.dirname(dataTarget), { recursive: true })
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'MindNProgress-Restore-'))
  const newDataDirectory = await mkdtemp(path.join(path.dirname(dataTarget), '.data-restore-new-'))
  const rollbackRoot = path.join(resolvedProject, '.mindnprogress')
  const { date, time } = timestampParts(now)
  let rollbackDirectory = path.join(rollbackRoot, `pre-restore-data-${date.replaceAll('-', '')}-${time}`)
  let rollbackSequence = 1
  while (await pathExists(rollbackDirectory)) {
    rollbackDirectory = path.join(rollbackRoot, `pre-restore-data-${date.replaceAll('-', '')}-${time}-${rollbackSequence}`)
    rollbackSequence += 1
  }
  let currentDataMoved = false
  let newDataInstalled = false

  try {
    await extractZip(resolvedArchive, temporaryRoot)
    const manifest = await verifyBackupPayload(temporaryRoot)
    const payloadData = path.join(temporaryRoot, 'server', 'data')
    await assertDirectory(payloadData, '백업의 server/data 폴더')
    await copyDirectory(payloadData, newDataDirectory)

    if (await pathExists(dataTarget)) {
      await mkdir(rollbackRoot, { recursive: true })
      await rename(dataTarget, rollbackDirectory)
      currentDataMoved = true
    }
    await rename(newDataDirectory, dataTarget)
    newDataInstalled = true

    const localConfigDirectory = path.join(temporaryRoot, 'local-config')
    if (await pathExists(localConfigDirectory)) {
      const configs = await readdir(localConfigDirectory, { withFileTypes: true })
      for (const entry of configs) {
        if (entry.isFile()) await copyFile(path.join(localConfigDirectory, entry.name), path.join(resolvedProject, entry.name))
      }
    }
    return { archivePath: resolvedArchive, manifest, rollbackDirectory: currentDataMoved ? rollbackDirectory : null }
  } catch (error) {
    if (newDataInstalled) await rm(dataTarget, { recursive: true, force: true })
    if (currentDataMoved && await pathExists(rollbackDirectory)) await rename(rollbackDirectory, dataTarget)
    throw error
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
    if (!newDataInstalled) await rm(newDataDirectory, { recursive: true, force: true })
  }
}
