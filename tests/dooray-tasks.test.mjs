import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DoorayTaskError,
  fetchDoorayCommentAuthor,
  fetchDoorayTaskPreview,
  fetchDoorayWikiPreview,
  isValidDoorayKnowledgeLinkData,
  isValidDoorayTaskLinkData,
  isValidDoorayWikiLinkData,
  loadDoorayApiConfig,
  parseDoorayTaskUrl,
  parseDoorayWikiUrl,
} from '../server/lib/doorayTasks.mjs'

const taskUrl = 'https://nhnent.dooray.com/task/4337958142554469981/4372040364315909997'
const copiedTaskUrl = 'https://nhnent.dooray.com/project/tasks/4372040364315909997'
const commentTaskUrl = `${copiedTaskUrl}#comment-4392183234846238852`
const wikiUrl = 'https://nhnent.dooray.com/wiki/4337958142554469981/4351699055666424190'
const copiedWikiUrl = 'https://nhnent.dooray.com/project/pages/4351699055666424190'

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
    commentId: null,
    hostname: 'nhnent.dooray.com',
    key: 'nhnent.dooray.com:4372040364315909997',
    labelKey: 'nhnent.dooray.com:4372040364315909997',
    url: taskUrl,
  })
  assert.deepEqual(parseDoorayTaskUrl(commentTaskUrl), {
    projectId: null,
    postId: '4372040364315909997',
    commentId: '4392183234846238852',
    hostname: 'nhnent.dooray.com',
    key: 'nhnent.dooray.com:4372040364315909997',
    labelKey: 'nhnent.dooray.com:4372040364315909997#comment-4392183234846238852',
    url: commentTaskUrl,
  })
  assert.throws(
    () => parseDoorayTaskUrl('https://example.com/task/1/2'),
    (error) => error instanceof DoorayTaskError && error.code === 'INVALID_URL',
  )
  assert.throws(
    () => parseDoorayTaskUrl(`${copiedTaskUrl}#comment-invalid`),
    (error) => error instanceof DoorayTaskError && error.code === 'INVALID_URL',
  )
})

test('Dooray Wiki의 두 URL 형식에서 같은 페이지 ID를 추출한다', () => {
  assert.deepEqual(parseDoorayWikiUrl(`${wikiUrl}/?from=clipboard#detail`), {
    spaceId: '4337958142554469981',
    pageId: '4351699055666424190',
    hostname: 'nhnent.dooray.com',
    key: 'nhnent.dooray.com:4351699055666424190',
    url: wikiUrl,
  })
  assert.deepEqual(parseDoorayWikiUrl(copiedWikiUrl), {
    spaceId: null,
    pageId: '4351699055666424190',
    hostname: 'nhnent.dooray.com',
    key: 'nhnent.dooray.com:4351699055666424190',
    url: copiedWikiUrl,
  })
  assert.throws(
    () => parseDoorayWikiUrl('https://example.com/project/pages/4351699055666424190'),
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
          project: { id: '4337958142554469981' },
          taskNumber: '로얄홀덤-일본서비스/5',
          workflowClass: 'registered',
          workflow: { name: '할 일' },
          closed: false,
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    },
  })

  assert.equal(receivedUrl, 'https://api.dooray.com/project/v1/posts/4372040364315909997')
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

test('Dooray Wiki 응답에서 카드 제목과 페이지 식별자만 추출한다', async () => {
  let receivedUrl = ''
  const preview = await fetchDoorayWikiPreview(wikiUrl, {
    apiKey: 'secret-key',
    baseUrl: 'https://api.dooray.com',
  }, {
    now: () => new Date('2026-08-05T01:02:03.000Z'),
    fetchImpl: async (url) => {
      receivedUrl = url
      return new Response(JSON.stringify({
        header: { isSuccessful: true },
        result: {
          id: '4351699055666424190',
          wikiId: '4337958144906302855',
          subject: '기술 검토',
          body: { mimeType: 'text/x-markdown', content: '카드에는 포함하지 않을 본문' },
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    },
  })

  assert.equal(receivedUrl, 'https://api.dooray.com/wiki/v1/pages/4351699055666424190')
  assert.deepEqual(preview, {
    provider: 'dooray-wiki',
    url: wikiUrl,
    hostname: 'nhnent.dooray.com',
    wikiId: '4337958144906302855',
    pageId: '4351699055666424190',
    subject: '기술 검토',
    resolvedAt: '2026-08-05T01:02:03.000Z',
  })
})

test('복사한 댓글 URL을 현재 프로젝트의 정규 URL로 보정한다', async () => {
  const preview = await fetchDoorayTaskPreview(commentTaskUrl, {
    apiKey: 'secret-key',
    baseUrl: 'https://api.dooray.com',
  }, {
    fetchImpl: async () => new Response(JSON.stringify({
      header: { isSuccessful: true },
      result: {
        subject: '댓글이 연결된 업무',
        project: { id: '4337958142554469981' },
        taskNumber: '로얄홀덤-일본서비스/53',
        workflowClass: 'working',
        workflow: { name: '진행 중' },
        closed: false,
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  })

  assert.equal(preview.url, `${taskUrl}#comment-4392183234846238852`)
  assert.equal(preview.projectId, '4337958142554469981')
  assert.equal(preview.postId, '4372040364315909997')
})

test('업무 ID 단독 조회 실패 시 입력 프로젝트의 기존 API로 재시도한다', async () => {
  const receivedUrls = []
  const preview = await fetchDoorayTaskPreview(taskUrl, {
    apiKey: 'secret-key',
    baseUrl: 'https://api.dooray.com',
  }, {
    fetchImpl: async (url) => {
      receivedUrls.push(url)
      if (receivedUrls.length === 1) return new Response('', { status: 404 })
      return new Response(JSON.stringify({
        header: { isSuccessful: true },
        result: {
          subject: '기존 API fallback 업무',
          taskNumber: '테스트/17',
          workflowClass: 'registered',
          workflow: { name: '할 일' },
          closed: false,
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    },
  })

  assert.deepEqual(receivedUrls, [
    'https://api.dooray.com/project/v1/posts/4372040364315909997',
    'https://api.dooray.com/project/v1/projects/4337958142554469981/posts/4372040364315909997',
  ])
  assert.equal(preview.projectId, '4337958142554469981')
})

test('Dooray 코멘트 작성자 이름을 조직멤버 정보로 해석한다', async () => {
  const receivedUrls = []
  const comment = await fetchDoorayCommentAuthor(
    `${taskUrl}#comment-4392183234846238852`,
    { apiKey: 'secret-key', baseUrl: 'https://api.dooray.com' },
    {
      fetchImpl: async (url) => {
        receivedUrls.push(url)
        if (url.includes('/logs/')) {
          return new Response(JSON.stringify({
            header: { isSuccessful: true },
            result: {
              id: '4392183234846238852',
              creator: {
                member: { organizationMemberId: '2061738478145755782', name: null },
              },
            },
          }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        }
        return new Response(JSON.stringify({
          header: { isSuccessful: true },
          result: { id: '2061738478145755782', name: '이미경' },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      },
    },
  )

  assert.deepEqual(receivedUrls, [
    'https://api.dooray.com/project/v1/projects/4337958142554469981/posts/4372040364315909997/logs/4392183234846238852',
    'https://api.dooray.com/common/v1/members/2061738478145755782',
  ])
  assert.deepEqual(comment, { id: '4392183234846238852', authorName: '이미경' })
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

  const wikiLink = {
    provider: 'dooray-wiki',
    url: copiedWikiUrl,
    hostname: 'nhnent.dooray.com',
    wikiId: '4337958144906302855',
    pageId: '4351699055666424190',
    title: '기술 검토',
    resolvedAt: '2026-08-05T01:02:03.000Z',
    displayWidth: 218,
    displayHeight: 112,
  }
  assert.equal(isValidDoorayWikiLinkData(wikiLink), true)
  assert.equal(isValidDoorayWikiLinkData({ ...wikiLink, pageId: 'other' }), false)
  assert.equal(isValidDoorayKnowledgeLinkData(link), true)
  assert.equal(isValidDoorayKnowledgeLinkData(wikiLink), true)
})
