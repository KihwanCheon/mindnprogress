import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { createRuntimeLifecycle } from '../server/lib/runtimeLifecycle.mjs'

test('정상 종료는 응답 후 저장과 중첩 백그라운드 작업을 기다리고 반복 작업을 중지한다', async () => {
  const runtime = createRuntimeLifecycle()
  let finishWrite, finishBackground, received
  const accepted = new Promise((resolve) => { received = resolve })
  const writing = new Promise((resolve) => { finishWrite = resolve })
  const background = new Promise((resolve) => { finishBackground = resolve })
  let written = false, backgroundDone = false, ticks = 0, stopped = false
  const server = createServer(runtime.request(async (_request, response) => {
    response.end('saved later')
    received()
    await writing
    written = true
    void runtime.track(async () => { await background; backgroundDone = true })
  }))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  runtime.interval(() => { ticks++ }, 5, 'test')
  await fetch(`http://127.0.0.1:${server.address().port}`)
  await accepted
  const shutdown = runtime.stop(server).then(() => { stopped = true })
  const count = ticks
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(stopped, false)
  assert.equal(ticks, count)
  finishWrite()
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(written, true)
  assert.equal(stopped, false)
  finishBackground()
  await shutdown
  assert.equal(backgroundDone, true)
})

test('종료 후 요청은 503이며 SSE를 닫아 종료를 지연시키지 않는다', async () => {
  const runtime = createRuntimeLifecycle()
  const streams = new Set()
  let connected
  const ready = new Promise((resolve) => { connected = resolve })
  const server = createServer(runtime.request((_request, response) => {
    streams.add(response)
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.write('data: connected\n\n')
    connected()
  }))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const response = await fetch(`http://127.0.0.1:${server.address().port}`)
  await ready
  await runtime.stop(server, () => { for (const stream of streams) stream.end() })
  await response.text()
  let status, body
  runtime.request(() => assert.fail('must not run'))({}, { writeHead: (value) => { status = value }, end: (value) => { body = value } })
  assert.equal(status, 503)
  assert.match(body, /종료/)
})
