import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const projectDirectory = path.resolve(import.meta.dirname, '..')

async function waitForServer(baseUrl, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`)
      if (response.ok) return
    } catch {
      // 서버 시작 대기
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('공개 뷰어 설정 시험 서버가 제한 시간 안에 시작되지 않았습니다.')
}

test('공개 뷰어는 설정으로만 명시적으로 활성화된다', { timeout: 30_000 }, async () => {
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'mindnprogress-public-viewer-config-'))
  const probe = createServer()
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const port = probe.address().port
  await new Promise((resolve) => probe.close(resolve))
  const baseUrl = `http://127.0.0.1:${port}`
  const server = spawn(process.execPath, ['server/index.mjs'], {
    cwd: projectDirectory,
    env: {
      ...process.env,
      MNP_DATA_DIR: dataDirectory,
      MNP_API_HOST: '127.0.0.1',
      MNP_API_PORT: String(port),
      MNP_WEB_PORT: String(port),
      MNP_PUBLIC_VIEWER_ENABLED: 'true',
      MNP_WORKSPACE_POOL_REGISTRY: path.join(dataDirectory, 'no-pool.json'),
      MNP_ADMIN_EMAIL: 'public-viewer-config@mind.local',
      MNP_ADMIN_PASSWORD: 'PublicViewer!2026',
    },
    stdio: 'ignore',
  })

  try {
    await waitForServer(baseUrl)
    const health = await fetch(`${baseUrl}/api/health`)
    assert.equal((await health.json()).publicViewerEnabled, true)

    const viewerAccess = await fetch(`${baseUrl}/api/auth/viewer-access`, { method: 'POST' })
    assert.equal(viewerAccess.status, 200)
    const viewerBody = await viewerAccess.json()
    assert.equal(viewerBody.user.publicAccess, true)
    const cookie = viewerAccess.headers.get('set-cookie')?.split(';', 1)[0]
    assert.ok(cookie)

    const maps = await fetch(`${baseUrl}/api/maps`, { headers: { Cookie: cookie } })
    assert.equal(maps.status, 200)
  } finally {
    if (server.exitCode === null) {
      const exited = new Promise((resolve) => server.once('exit', resolve))
      server.kill()
      await exited
    }
    await rm(dataDirectory, { recursive: true, force: true })
  }
})
