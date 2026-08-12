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
  throw new Error('일일 백업 미리보기 API 검증 서버가 제한 시간 안에 시작되지 않았습니다.')
}

test('일일 백업을 현재 문서 변경 없이 읽기 전용으로 미리본다', { timeout: 30_000 }, async () => {
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'mindnprogress-daily-preview-api-'))
  const port = 30_000 + Math.floor(Math.random() * 10_000)
  const baseUrl = `http://127.0.0.1:${port}`
  const server = spawn(process.execPath, ['server/index.mjs'], {
    cwd: projectDirectory,
    env: {
      ...process.env,
      MNP_DATA_DIR: dataDirectory,
      MNP_API_HOST: '127.0.0.1',
      MNP_API_PORT: String(port),
      MNP_WEB_PORT: String(port),
    },
    stdio: 'ignore',
  })

  try {
    await waitForServer(baseUrl)
    const token = (await readFile(path.join(dataDirectory, '_integration-token'), 'utf8')).trim()
    const headers = {
      Authorization: `Bearer ${token}`,
      'X-MNP-Editor-Id': 'preview-test-editor',
    }
    const createResponse = await fetch(`${baseUrl}/api/maps`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: '가상 복원 확인',
        map: {
          nodes: [{
            id: 'root-daily-preview',
            type: 'mind',
            position: { x: 0, y: 0 },
            data: {
              label: '백업 당시 카드',
              description: '읽기 전용 미리보기 검증',
              progress: 0,
              status: 'planned',
              kind: 'root',
            },
          }],
          edges: [],
        },
      }),
    })
    assert.equal(createResponse.status, 201)
    const created = await createResponse.json()
    const mapId = created.map.id

    const listResponse = await fetch(`${baseUrl}/api/maps/${mapId}/backups/daily`, { headers })
    assert.equal(listResponse.status, 200)
    const listed = await listResponse.json()
    assert.equal(listed.dailyBackups.length, 1)
    const date = listed.dailyBackups[0].date
    const mapFile = path.join(dataDirectory, `${mapId}.json`)
    const backupFile = path.join(dataDirectory, '_daily-backups', mapId, `${date}.json`)
    const mapBeforePreview = await readFile(mapFile, 'utf8')
    const backupBeforePreview = await readFile(backupFile, 'utf8')

    const previewResponse = await fetch(`${baseUrl}/api/maps/${mapId}/backups/daily/${date}/preview`, { headers })
    assert.equal(previewResponse.status, 200)
    const result = await previewResponse.json()
    assert.equal(result.backup.date, date)
    assert.equal(result.backup.mapId, mapId)
    assert.equal(result.backup.map.title, '가상 복원 확인')
    assert.equal(result.backup.map.nodes[0].data.label, '백업 당시 카드')
    assert.deepEqual(result.backup.map.edges, [])
    assert.equal(await readFile(mapFile, 'utf8'), mapBeforePreview)
    assert.equal(await readFile(backupFile, 'utf8'), backupBeforePreview)
  } finally {
    server.kill()
    await new Promise((resolve) => server.once('exit', resolve))
    await rm(dataDirectory, { recursive: true, force: true })
  }
})
