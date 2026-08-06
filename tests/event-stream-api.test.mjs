import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
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
  throw new Error('이벤트 스트림 검증 서버가 제한 시간 안에 시작되지 않았습니다.')
}

test('이벤트 스트림이 클라이언트가 확인할 수 있는 heartbeat를 전송한다', { timeout: 30_000 }, async () => {
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'mindnprogress-event-stream-api-'))
  const port = 45_000 + Math.floor(Math.random() * 5_000)
  const baseUrl = `http://127.0.0.1:${port}`
  const server = spawn(process.execPath, ['server/index.mjs'], {
    cwd: projectDirectory,
    env: {
      ...process.env,
      MNP_DATA_DIR: dataDirectory,
      MNP_API_HOST: '127.0.0.1',
      MNP_API_PORT: String(port),
      MNP_WEB_PORT: String(port),
      MNP_EVENT_HEARTBEAT_INTERVAL_MS: '100',
    },
    stdio: 'ignore',
  })
  const controller = new AbortController()
  let timeout = null

  try {
    await waitForServer(baseUrl)
    const token = (await readFile(path.join(dataDirectory, '_integration-token'), 'utf8')).trim()
    const response = await fetch(`${baseUrl}/api/events?clientId=test-event-stream`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-MNP-Editor-Id': 'user-editor',
      },
      signal: controller.signal,
    })
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type') ?? '', /^text\/event-stream/)

    timeout = setTimeout(() => controller.abort(), 5_000)
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let received = ''
    while (!received.includes('"type":"heartbeat"')) {
      const result = await reader.read()
      if (result.done) break
      received += decoder.decode(result.value, { stream: true })
    }
    assert.match(received, /"type":"connected"/)
    assert.match(received, /"type":"heartbeat"/)
    await reader.cancel()
  } finally {
    if (timeout) clearTimeout(timeout)
    controller.abort()
    if (server.exitCode === null) {
      server.kill()
      await new Promise((resolve) => server.once('exit', resolve))
    }
    await rm(dataDirectory, { recursive: true, force: true })
  }
})
