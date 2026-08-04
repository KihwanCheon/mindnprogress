import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DoorayTaskError,
  fetchDoorayTaskPreview,
  isValidDoorayTaskLinkData,
  loadDoorayApiConfig,
  parseDoorayTaskUrl,
} from '../server/lib/doorayTasks.mjs'

const taskUrl = 'https://nhnent.dooray.com/task/4337958142554469981/4372040364315909997'

test('Claude 설정의 Dooray MCP API 키와 주소를 읽는다', async () => {
  const config = await loadDoorayApiConfig({
    env: {},
    homeDirectory: 'C:/Users/tester',
    readText: async (filePath) => {
      assert.equal(filePath.replaceAll('\\', '/').endsWith('C:/Users/tester/.claude.json'), true)
      return JSON.stringify({
        mcpServers: {
          'docker-dooray-mcp': {
            env: {
              DOORAY_API_KEY: 'test-dooray-key',
              DOORAY_BASE_URL: 'https://api.dooray.com/',
            },
          },
        },
      })
    },
  })
  assert.equal(config.apiKey, 'test-dooray-key')
  assert.equal(config.baseUrl, 'https://api.dooray.com')
  assert.equal(config.source, 'claude-config')
})

test('환경변수 API 키가 Claude 설정보다 우선한다', async () => {
  const config = await loadDoorayApiConfig({
    env: {
      MNP_DOORAY_API_KEY: 'environment-key',
      MNP_DOORAY_BASE_URL: 'http://127.0.0.1:4567',
    },
    readText: async () => { throw new Error('설정 파일을 읽으면 안 됩니다.') },
  })
  assert.equal(config.apiKey, 'environment-key')
  assert.equal(config.baseUrl, 'http://127.0.0.1:4567')
  assert.equal(config.source, 'environment')
})

test('Dooray 업무 URL에서 프로젝트와 업무 ID를 추출하고 정규화한다', () => {
  assert.deepEqual(parseDoorayTaskUrl(`${taskUrl}/?from=clipboard#detail`), {
    projectId: '4337958142554469981',
    postId: '4372040364315909997',
    hostname: 'nhnent.dooray.com',
    url: taskUrl,
  })
  assert.throws(
    () => parseDoorayTaskUrl('https://example.com/task/1/2'),
    (error) => error instanceof DoorayTaskError && error.code === 'INVALID_URL',
  )
})

test('Dooray 상세 응답을 카드 미리보기 정보로 최소화한다', async () => {
  let receivedUrl = ''
  let receivedAuthorization = ''
  const preview = await fetchDoorayTaskPreview(taskUrl, {
    apiKey: 'secret-key',
    baseUrl: 'https://api.dooray.com',
  }, {
    now: () => new Date('2026-08-04T01:02:03.000Z'),
    fetchImpl: async (url, options) => {
      receivedUrl = url
      receivedAuthorization = options.headers.Authorization
      return new Response(JSON.stringify({
        header: { isSuccessful: true },
        result: {
          subject: '[J로얄] <기획> 컨셉 기획 문서',
          taskNumber: '로얄홀덤-일본서비스/5',
          workflowClass: 'registered',
          workflow: { name: '할 일' },
          closed: false,
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    },
  })

  assert.equal(receivedUrl, 'https://api.dooray.com/project/v1/projects/4337958142554469981/posts/4372040364315909997')
  assert.equal(receivedAuthorization, 'dooray-api secret-key')
  assert.deepEqual(preview, {
    provider: 'dooray-task',
    url: taskUrl,
    hostname: 'nhnent.dooray.com',
    projectId: '4337958142554469981',
    postId: '4372040364315909997',
    subject: '[J로얄] <기획> 컨셉 기획 문서',
    taskNumber: '로얄홀덤-일본서비스/5',
    workflowName: '할 일',
    workflowClass: 'registered',
    closed: false,
    resolvedAt: '2026-08-04T01:02:03.000Z',
  })
})

test('저장할 Dooray 카드 메타데이터의 URL과 표시 크기를 검증한다', () => {
  const link = {
    provider: 'dooray-task',
    url: taskUrl,
    hostname: 'nhnent.dooray.com',
    projectId: '4337958142554469981',
    postId: '4372040364315909997',
    title: '[J로얄] <기획> 컨셉 기획 문서',
    taskNumber: '로얄홀덤-일본서비스/5',
    workflowName: '할 일',
    workflowClass: 'registered',
    closed: false,
    resolvedAt: '2026-08-04T01:02:03.000Z',
    displayWidth: 218,
    displayHeight: 112,
  }
  assert.equal(isValidDoorayTaskLinkData(link), true)
  assert.equal(isValidDoorayTaskLinkData({ ...link, postId: 'other' }), false)
  assert.equal(isValidDoorayTaskLinkData({ ...link, displayWidth: 80 }), false)
  assert.equal(isValidDoorayTaskLinkData({ ...link, title: 'x'.repeat(241) }), false)
})
