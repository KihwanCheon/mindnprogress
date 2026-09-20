import { createServer } from 'node:http'

const completionPathPattern = /^\/api\/integrations\/aionui\/launches\/[A-Za-z0-9_-]{32,128}\/conversation$/
const defaultBodyLimit = 16 * 1024

function sendJson(response, status, body) {
  const content = JSON.stringify(body)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(content),
    'Cache-Control': 'no-store',
  })
  response.end(content)
}

async function readJson(request, bodyLimit) {
  let size = 0
  const chunks = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > bodyLimit) {
      const error = new Error('CALLBACK_BODY_TOO_LARGE')
      error.status = 413
      throw error
    }
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    const error = new Error('CALLBACK_BODY_INVALID')
    error.status = 400
    throw error
  }
}

// AionCore는 SSRF 방지를 위해 외부 대화 완료 콜백을 loopback으로 제한한다.
// 서브 머신에서는 이 loopback 전용 릴레이가 콜백을 받은 뒤, Runner가 이미 가진
// 인증된 outbound 경로로 메인 MnP에 전달한다. 외부 인터페이스에는 바인딩하지 않는다.
export async function startCompletionRelay({ forward, port = 0, bodyLimit = defaultBodyLimit } = {}) {
  if (typeof forward !== 'function') throw new TypeError('완료 콜백 전달 함수가 필요합니다.')

  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      if (request.method !== 'POST' || url.search || !completionPathPattern.test(url.pathname)) {
        return sendJson(response, 404, { error: '지원하지 않는 완료 콜백입니다.' })
      }
      const body = await readJson(request, bodyLimit)
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return sendJson(response, 400, { error: '완료 콜백 본문이 올바르지 않습니다.' })
      }
      await forward(url.pathname, body)
      return sendJson(response, 200, { delivered: true })
    })().catch((error) => {
      if (response.headersSent) return response.end()
      const status = Number.isInteger(error?.status) && error.status >= 400 && error.status < 500
        ? error.status
        : 502
      sendJson(response, status, { error: 'MindNProgress에 완료 콜백을 전달하지 못했습니다.' })
    })
  })

  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, '127.0.0.1')
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('완료 콜백 릴레이 주소를 확인하지 못했습니다.')
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    }),
  }
}
