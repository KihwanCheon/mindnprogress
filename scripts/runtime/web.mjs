import { createServer } from 'vite'
import { installRuntimeShutdown } from '../../server/lib/runtimeLifecycle.mjs'

let server
// 시작 도중 들어온 종료 요청도 listen 완료 후 처리한다.
let ready
const initialized = new Promise((resolve) => { ready = resolve })
installRuntimeShutdown(async () => { await initialized; await server?.close() })
try {
  server = await createServer({ server: { port: Number(process.env.MNP_WEB_PORT ?? 4175), strictPort: true,
    proxy: { '/api': { target: `http://127.0.0.1:${Number(process.env.MNP_API_PORT ?? 4176)}`, xfwd: true } } } })
  await server.listen()
  server.printUrls()
} finally { ready() }
