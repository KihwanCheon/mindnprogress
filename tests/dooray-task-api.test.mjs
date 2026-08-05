import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
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
  throw new Error('Dooray 연동 검증 서버가 제한 시간 안에 시작되지 않았습니다.')
}

test('인증된 편집자가 Dooray URL로 업무 제목 미리보기를 조회한다', { timeout: 30_000 }, async () => {
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'mindnprogress-dooray-api-'))
  let receivedAuthorization = ''
  let upstreamRequestCount = 0
  const upstream = createServer((request, response) => {
    upstreamRequestCount += 1
    receivedAuthorization = String(request.headers.authorization ?? '')
    response.writeHead(200, { 'Content-Type': 'application/json' })
    if (request.url?.includes('/logs/4392183234846238852')) {
      response.end(JSON.stringify({
        header: { isSuccessful: true },
        result: {
          id: '4392183234846238852',
          creator: { member: { organizationMemberId: '2061738478145755782', name: null } },
        },
      }))
      return
    }
    if (request.url?.includes('/common/v1/members/2061738478145755782')) {
      response.end(JSON.stringify({
        header: { isSuccessful: true },
        result: { id: '2061738478145755782', name: '이미경' },
      }))
      return
    }
    if (request.url?.includes('/wiki/v1/pages/4351699055666424190')) {
      response.end(JSON.stringify({
        header: { isSuccessful: true },
        result: {
          id: '4351699055666424190',
          wikiId: '4337958144906302855',
          subject: 'Dooray Wiki API 연동 테스트',
          body: { mimeType: 'text/x-markdown', content: '미리보기에는 포함하지 않습니다.' },
        },
      }))
      return
    }
    response.end(JSON.stringify({
      header: { isSuccessful: true },
      result: {
        subject: 'Dooray API 연동 테스트',
        project: { id: '4337958142554469981' },
        taskNumber: '테스트/17',
        workflowClass: 'working',
        workflow: { name: '진행 중' },
        closed: false,
      },
    }))
  })
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  const upstreamAddress = upstream.address()
  assert.ok(upstreamAddress && typeof upstreamAddress === 'object')
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
      MNP_DOORAY_API_KEY: 'integration-dooray-key',
      MNP_DOORAY_BASE_URL: `http://127.0.0.1:${upstreamAddress.port}`,
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
    const taskUrl = 'https://nhnent.dooray.com/task/4337958142554469981/4372040364315909997'
    const commentTaskUrl = 'https://nhnent.dooray.com/project/tasks/4372040364315909997#comment-4392183234846238852'
    const response = await fetch(`${baseUrl}/api/integrations/dooray/task-preview`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url: taskUrl }),
    })
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(receivedAuthorization, 'dooray-api integration-dooray-key')
    assert.deepEqual(body.task, {
      provider: 'dooray-task',
      url: taskUrl,
      hostname: 'nhnent.dooray.com',
      projectId: '4337958142554469981',
      postId: '4372040364315909997',
      subject: 'Dooray API 연동 테스트',
      taskNumber: '테스트/17',
      workflowName: '진행 중',
      workflowClass: 'working',
      closed: false,
      resolvedAt: body.task.resolvedAt,
    })
    assert.equal(Number.isFinite(Date.parse(body.task.resolvedAt)), true)

    const wikiUrl = 'https://nhnent.dooray.com/wiki/4337958142554469981/4351699055666424190'
    const wikiResponse = await fetch(`${baseUrl}/api/integrations/dooray/wiki-preview`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url: wikiUrl }),
    })
    assert.equal(wikiResponse.status, 200)
    const wikiBody = await wikiResponse.json()
    assert.deepEqual(wikiBody.wiki, {
      provider: 'dooray-wiki',
      url: wikiUrl,
      hostname: 'nhnent.dooray.com',
      wikiId: '4337958144906302855',
      pageId: '4351699055666424190',
      subject: 'Dooray Wiki API 연동 테스트',
      resolvedAt: wikiBody.wiki.resolvedAt,
    })
    assert.equal(Number.isFinite(Date.parse(wikiBody.wiki.resolvedAt)), true)

    const editorTitlesResponse = await fetch(`${baseUrl}/api/integrations/dooray/task-titles`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ urls: [
        taskUrl,
        'https://nhnent.dooray.com/project/tasks/4372040364315909997',
        commentTaskUrl,
      ] }),
    })
    assert.equal(editorTitlesResponse.status, 200)
    assert.deepEqual(await editorTitlesResponse.json(), {
      tasks: [{
        key: 'nhnent.dooray.com:4372040364315909997',
        url: taskUrl,
        title: 'Dooray API 연동 테스트',
      }, {
        key: 'nhnent.dooray.com:4372040364315909997#comment-4392183234846238852',
        url: commentTaskUrl,
        title: 'Dooray API 연동 테스트',
        comment: { id: '4392183234846238852', authorName: '이미경' },
      }],
    })
    assert.equal(upstreamRequestCount, 5)

    const viewerAccessResponse = await fetch(`${baseUrl}/api/auth/viewer-access`, { method: 'POST' })
    assert.equal(viewerAccessResponse.status, 200)
    const viewerCookie = viewerAccessResponse.headers.get('set-cookie')?.split(';', 1)[0]
    assert.ok(viewerCookie)
    const viewerTitlesResponse = await fetch(`${baseUrl}/api/integrations/dooray/task-titles`, {
      method: 'POST',
      headers: { Cookie: viewerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: [taskUrl] }),
    })
    assert.equal(viewerTitlesResponse.status, 200)
    assert.deepEqual(await viewerTitlesResponse.json(), {
      tasks: [{
        key: 'nhnent.dooray.com:4372040364315909997',
        url: taskUrl,
        title: 'Dooray API 연동 테스트',
      }],
    })
    assert.equal(upstreamRequestCount, 5)

    const invalidResponse = await fetch(`${baseUrl}/api/integrations/dooray/task-preview`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url: 'https://example.com/task/1/2' }),
    })
    assert.equal(invalidResponse.status, 400)
    const invalidBody = await invalidResponse.json()
    assert.equal(invalidBody.code, 'INVALID_URL')
  } finally {
    if (server.exitCode === null) {
      server.kill()
      await new Promise((resolve) => server.once('exit', resolve))
    }
    await new Promise((resolve) => upstream.close(resolve))
    await rm(dataDirectory, { recursive: true, force: true })
  }
})
