import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { listWorkspaceDirectory, listWorkspaceRoots } from '../server/lib/workspaceBrowse.mjs'
import { isLocalLoopbackRequest } from '../server/lib/localLoopbackRedirect.mjs'

async function createWorkspaceTree() {
  const root = await mkdtemp(path.join(tmpdir(), 'mnp-browse-'))
  await mkdir(path.join(root, 'Repo', '.git'), { recursive: true })
  await mkdir(path.join(root, 'Plain'), { recursive: true })
  await mkdir(path.join(root, 'Plain', 'Nested'), { recursive: true })
  await writeFile(path.join(root, 'note.txt'), '파일은 목록에 넣지 않는다')
  return root
}

test('폴더만 이름순으로 돌려주고 Git 작업공간을 표시한다', async (t) => {
  const root = await createWorkspaceTree()
  t.after(() => rm(root, { recursive: true, force: true }))

  const listing = await listWorkspaceDirectory(root)
  assert.deepEqual(listing.entries.map((entry) => entry.name), ['Plain', 'Repo'])
  assert.equal(listing.entries.find((entry) => entry.name === 'Repo')?.git, true)
  assert.equal(listing.entries.find((entry) => entry.name === 'Plain')?.git, false)
  assert.equal(listing.path, path.resolve(root))
  assert.equal(listing.parent, path.dirname(path.resolve(root)))
  assert.equal(listing.truncated, false)
  assert.equal(listing.git, false)
})

test('Git 작업공간 안으로 들어가면 현재 폴더를 Git으로 표시한다', async (t) => {
  const root = await createWorkspaceTree()
  t.after(() => rm(root, { recursive: true, force: true }))

  const listing = await listWorkspaceDirectory(path.join(root, 'Repo'))
  assert.equal(listing.git, true)
  // .git은 폴더지만 작업공간 후보가 아니어도 목록에는 그대로 보인다.
  assert.deepEqual(listing.entries.map((entry) => entry.name), ['.git'])
})

test('상한을 넘으면 잘라내고 잘렸음을 알린다', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'mnp-browse-limit-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await Promise.all([...Array(5).keys()].map((index) => mkdir(path.join(root, `dir-${index}`))))

  const listing = await listWorkspaceDirectory(root, { entryLimit: 3 })
  assert.equal(listing.entries.length, 3)
  assert.equal(listing.truncated, true)
})

test('폴더가 아니거나 없는 경로는 코드를 붙여 실패한다', async (t) => {
  const root = await createWorkspaceTree()
  t.after(() => rm(root, { recursive: true, force: true }))

  await assert.rejects(listWorkspaceDirectory(path.join(root, 'note.txt')), (error) => error.code === 'ENOTDIR')
  await assert.rejects(listWorkspaceDirectory(path.join(root, '없는폴더')), (error) => error.code === 'ENOENT')
})

test('드라이브 목록은 상위가 없고 windows가 아니면 루트 하나만 준다', async () => {
  const roots = await listWorkspaceRoots({ platform: 'linux' })
  assert.equal(roots.parent, null)
  assert.equal(roots.path, '')
  assert.deepEqual(roots.entries.map((entry) => entry.path), ['/'])

  const windowsRoots = await listWorkspaceRoots({ platform: 'win32' })
  assert.equal(windowsRoots.parent, null)
  assert.ok(windowsRoots.entries.every((entry) => /^[A-Z]:\\$/.test(entry.path)))
})

test('작업공간 탐색은 같은 PC 요청만 허용한다', () => {
  const allow = [
    ['서버에 직접 접속', { headers: { host: '127.0.0.1:4176' }, socket: { remoteAddress: '127.0.0.1' } }],
    ['localhost 접속', { headers: { host: 'localhost:4175' }, socket: { remoteAddress: '::1' } }],
    ['같은 PC에서 개발 서버 프록시 경유', { headers: { host: 'localhost:4175', 'x-forwarded-for': '127.0.0.1' }, socket: { remoteAddress: '127.0.0.1' } }],
  ]
  const deny = [
    ['같은 PC라도 LAN 주소로 접속', { headers: { host: '10.77.15.110:4175' }, socket: { remoteAddress: '127.0.0.1' } }],
    ['다른 기기에서 프록시 경유', { headers: { host: '10.77.15.110:4175', 'x-forwarded-for': '10.77.15.55' }, socket: { remoteAddress: '127.0.0.1' } }],
    ['다른 기기가 Host를 위조', { headers: { host: 'localhost:4175', 'x-forwarded-for': '10.77.15.55' }, socket: { remoteAddress: '127.0.0.1' } }],
    ['전달 목록 앞쪽만 위조', { headers: { host: 'localhost:4175', 'x-forwarded-for': '127.0.0.1, 10.77.15.55' }, socket: { remoteAddress: '127.0.0.1' } }],
    ['x-real-ip가 원격', { headers: { host: 'localhost:4175', 'x-real-ip': '10.77.15.55' }, socket: { remoteAddress: '127.0.0.1' } }],
    ['Forwarded가 원격', { headers: { host: 'localhost:4175', forwarded: 'for=10.77.15.55' }, socket: { remoteAddress: '127.0.0.1' } }],
    ['서버에 직접 원격 접속', { headers: { host: '10.77.15.110:4176' }, socket: { remoteAddress: '10.77.15.55' } }],
    ['Host가 없음', { headers: {}, socket: { remoteAddress: '127.0.0.1' } }],
  ]

  for (const [name, request] of allow) assert.equal(isLocalLoopbackRequest(request), true, name)
  for (const [name, request] of deny) assert.equal(isLocalLoopbackRequest(request), false, name)
})
