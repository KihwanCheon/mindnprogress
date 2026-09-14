// HTTP 응답 종료와 비동기 저장 완료는 다르므로 요청 함수 자체를 추적한다.
export function createRuntimeLifecycle() {
  const pending = new Set()
  const timers = new Set()
  let stopping = false
  let shutdown = null
  const track = (work) => {
    const promise = Promise.resolve().then(work)
    pending.add(promise)
    void promise.then(() => pending.delete(promise), () => pending.delete(promise))
    return promise
  }
  return {
    track,
    request(handler) {
      return (request, response) => {
        if (stopping) {
          response.writeHead(503, { Connection: 'close', 'Retry-After': '2', 'Content-Type': 'application/json; charset=utf-8' })
          response.end(JSON.stringify({ error: '서버를 종료하고 있습니다. 잠시 후 다시 시도해 주세요.' }))
          return
        }
        void track(() => handler(request, response)).catch((error) => {
          console.error('[Runtime request]', error)
          response.destroy()
        })
      }
    },
    interval(work, milliseconds, label) {
      const timer = setInterval(() => {
        if (!stopping) void track(work).catch((error) => console.warn(`[${label}]`, error))
      }, milliseconds)
      timers.add(timer)
      timer.unref()
      return timer
    },
    stop(server, closeStreams = () => {}) {
      if (shutdown) return shutdown
      stopping = true
      for (const timer of timers) clearInterval(timer)
      shutdown = (async () => {
        // 우선 신규 연결을 막되 진행 중인 요청·백그라운드 저장은 끊지 않는다.
        const closed = new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
        closeStreams()
        while (pending.size) await Promise.allSettled([...pending])
        // 종료 직전에 등록된 SSE와 유휴 연결도 정리한다.
        closeStreams()
        server.closeIdleConnections?.()
        await closed
      })()
      return shutdown
    },
  }
}

export function installRuntimeShutdown(shutdown) {
  let stopping = false
  const stop = () => {
    if (stopping) return
    stopping = true
    const started = performance.now()
    void Promise.resolve().then(shutdown).then(() => {
      console.log(`[Runtime] graceful shutdown ${Math.round(performance.now() - started)}ms`)
      process.exit(0)
    }).catch((error) => {
      // 종료 실패 시 무조건 exit하여 저장 작업을 끊지 않는다.
      console.error('[Runtime shutdown failed]', error)
    })
  }
  process.on('message', (message) => { if (message?.type === 'mnp:shutdown') stop() })
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  // 감시자 자체가 비정상 종료되어도 서버만 남지 않도록 한다.
  if (process.connected) {
    process.on('disconnect', stop)
    process.send({ type: 'mnp:shutdown-ready' }, () => {})
  }
}
