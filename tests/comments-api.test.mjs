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
  throw new Error('댓글 API 검증 서버가 제한 시간 안에 시작되지 않았습니다.')
}

test('댓글 요약·상세 저장과 기존 댓글 마이그레이션 경로를 제공한다', { timeout: 30_000 }, async () => {
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'mindnprogress-comments-api-'))
  const port = 40_000 + Math.floor(Math.random() * 5_000)
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
      'X-MNP-Editor-Id': 'user-editor',
      'Content-Type': 'application/json',
    }
    const createResponse = await fetch(`${baseUrl}/api/maps`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: '댓글 API 검증',
        map: {
          nodes: [{
            id: 'root-comments-api',
            type: 'mind',
            position: { x: 0, y: 0 },
            data: {
              label: '댓글 API 검증',
              description: '',
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
    const commentsUrl = `${baseUrl}/api/maps/${created.map.id}/comments`

    const legacyResponse = await fetch(commentsUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ nodeId: 'root-comments-api', text: '마이그레이션 전의 상세 댓글' }),
    })
    assert.equal(legacyResponse.status, 201)
    const legacy = (await legacyResponse.json()).comment
    assert.equal(legacy.text, '마이그레이션 전의 상세 댓글')
    assert.equal(legacy.contentFormat, undefined)

    const structuredResponse = await fetch(commentsUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        nodeId: 'root-comments-api',
        summary: '[결과] 댓글 구조를 확장했습니다.',
        detail: '수행 내용과 검증 결과를 상세하게 기록했습니다.',
      }),
    })
    assert.equal(structuredResponse.status, 201)
    const structured = (await structuredResponse.json()).comment
    assert.equal(structured.contentFormat, 'summary-detail')
    assert.equal(structured.text, structured.summary)
    assert.equal(structured.detail, '수행 내용과 검증 결과를 상세하게 기록했습니다.')

    const compactResponse = await fetch(`${commentsUrl}?includeDetail=false`, { headers })
    assert.equal(compactResponse.status, 200)
    const compactComments = (await compactResponse.json()).comments
    const compactStructured = compactComments.find((comment) => comment.id === structured.id)
    assert.equal(compactStructured.detail, undefined)
    assert.equal(compactStructured.hasDetail, true)

    const statsResponse = await fetch(`${commentsUrl}/stats`, { headers })
    assert.equal(statsResponse.status, 200)
    assert.deepEqual((await statsResponse.json()).stats['root-comments-api'], { total: 2, unresolved: 2 })

    const staleMigrationResponse = await fetch(`${commentsUrl}/${legacy.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        expectedText: '조회 당시와 다른 원문',
        summary: '[진행] 기존 댓글을 분류했습니다.',
        detail: '마이그레이션 상세',
      }),
    })
    assert.equal(staleMigrationResponse.status, 409)
    assert.match((await staleMigrationResponse.json()).error, /조회 이후 변경/)

    const migrateResponse = await fetch(`${commentsUrl}/${legacy.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        expectedText: legacy.text,
        summary: '[진행] 기존 댓글을 분류했습니다.',
        detail: '기존 원문을 확인하여 의미 있는 상세 내용을 보존했습니다.',
      }),
    })
    assert.equal(migrateResponse.status, 200)
    const migrated = (await migrateResponse.json()).comment
    assert.equal(migrated.contentFormat, 'summary-detail')
    assert.equal(migrated.summary, '[진행] 기존 댓글을 분류했습니다.')
    assert.equal(migrated.detail, '기존 원문을 확인하여 의미 있는 상세 내용을 보존했습니다.')
    assert.equal(migrated.author.id, legacy.author.id)
    assert.equal(migrated.createdAt, legacy.createdAt)
  } finally {
    if (server.exitCode === null) {
      server.kill()
      await new Promise((resolve) => server.once('exit', resolve))
    }
    await rm(dataDirectory, { recursive: true, force: true })
  }
})
