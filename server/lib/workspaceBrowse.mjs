// AI 대화 작업공간을 고르기 위한 폴더 탐색.
// 브라우저는 폴더 선택 대화상자에서 절대 경로를 알려주지 않으므로 서버가 목록을 내려준다.

import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'

// 폴더가 많은 위치에서도 응답이 커지지 않도록 상한을 둔다.
export const WORKSPACE_BROWSE_ENTRY_LIMIT = 400

const DRIVE_LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']

async function isGitWorkspace(directory) {
  return stat(path.join(directory, '.git')).then(() => true, () => false)
}

export async function listWorkspaceRoots({ platform = process.platform } = {}) {
  if (platform !== 'win32') {
    return { path: '', parent: null, git: false, entries: [{ name: '/', path: '/', git: await isGitWorkspace('/') }], truncated: false }
  }
  const drives = await Promise.all(DRIVE_LETTERS.map((letter) => {
    const drivePath = `${letter}:\\`
    return stat(drivePath).then(() => drivePath, () => null)
  }))
  return {
    path: '',
    parent: null,
    git: false,
    entries: drives.filter(Boolean).map((drivePath) => ({ name: drivePath, path: drivePath, git: false })),
    truncated: false,
  }
}

export async function listWorkspaceDirectory(requestedPath, { entryLimit = WORKSPACE_BROWSE_ENTRY_LIMIT } = {}) {
  const directory = path.resolve(requestedPath)
  const directoryStat = await stat(directory)
  if (!directoryStat.isDirectory()) {
    const error = new Error('폴더가 아닙니다.')
    error.code = 'ENOTDIR'
    throw error
  }

  const dirents = await readdir(directory, { withFileTypes: true })
  const names = dirents.filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((first, second) => first.localeCompare(second, 'ko'))
  const visible = names.slice(0, entryLimit)
  const entries = await Promise.all(visible.map(async (name) => {
    const entryPath = path.join(directory, name)
    return { name, path: entryPath, git: await isGitWorkspace(entryPath) }
  }))

  const parent = path.dirname(directory)
  return {
    path: directory,
    // 드라이브 루트는 dirname이 자기 자신이므로 상위를 드라이브 목록으로 되돌린다.
    parent: parent === directory ? '' : parent,
    git: await isGitWorkspace(directory),
    entries,
    truncated: names.length > visible.length,
  }
}
