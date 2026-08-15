import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createBackup, isSameOrInside, restoreBackup } from '../scripts/data-archive.mjs'

test('경로가 같은 폴더이거나 하위 폴더인지 운영체제 경계에 맞게 확인한다', () => {
  assert.equal(isSameOrInside('/tmp/project', '/tmp/project'), true)
  assert.equal(isSameOrInside('/tmp/project/data', '/tmp/project'), true)
  assert.equal(isSameOrInside('/tmp/project-copy', '/tmp/project'), false)
})

test('macOS/Linux 백업은 manifest를 검증하고 기존 데이터를 보관한 뒤 복원한다', {
  skip: process.platform === 'win32' ? 'Windows는 PowerShell 백업을 사용합니다.' : false,
}, async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'mindnprogress-archive-test-'))
  const projectDirectory = path.join(temporaryRoot, 'project')
  const backupDirectory = path.join(temporaryRoot, 'backups')
  const dataDirectory = path.join(projectDirectory, 'server', 'data')
  try {
    await mkdir(path.join(dataDirectory, '_assets'), { recursive: true })
    await writeFile(path.join(dataDirectory, 'map.json'), '{"version":1}\n')
    await writeFile(path.join(dataDirectory, '_assets', 'image.bin'), Buffer.from([0, 1, 2, 3]))
    await writeFile(path.join(projectDirectory, '.env.local'), 'MNP_PUBLIC_URL=http://localhost\n')

    const backup = await createBackup({
      projectDirectory,
      destination: backupDirectory,
      checkServer: false,
      now: new Date('2026-08-06T12:34:56.000Z'),
    })
    assert.equal(path.extname(backup.archivePath), '.zip')
    assert.ok(backup.manifest.files.some((entry) => entry.path === 'server/data/map.json'))

    await writeFile(path.join(dataDirectory, 'map.json'), '{"version":2}\n')
    await writeFile(path.join(projectDirectory, '.env.local'), 'changed=true\n')
    const restored = await restoreBackup({
      archivePath: backup.archivePath,
      projectDirectory,
      checkServer: false,
      now: new Date('2026-08-06T13:00:00.000Z'),
    })

    assert.equal(await readFile(path.join(dataDirectory, 'map.json'), 'utf8'), '{"version":1}\n')
    assert.equal(await readFile(path.join(projectDirectory, '.env.local'), 'utf8'), 'MNP_PUBLIC_URL=http://localhost\n')
    assert.equal(await readFile(path.join(restored.rollbackDirectory, 'map.json'), 'utf8'), '{"version":2}\n')
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})
