import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { localLoopbackRedirectLocation } from './server/lib/localLoopbackRedirect.mjs'
import { loadMindNProgressEnvironment } from './scripts/local-environment.mjs'

function localLoopbackRedirectPlugin(): Plugin {
  return {
    name: 'mindnprogress-local-loopback-redirect',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const location = localLoopbackRedirectLocation(request)
        if (!location) return next()
        response.statusCode = 307
        response.setHeader('Location', location)
        response.setHeader('Cache-Control', 'no-store')
        response.end()
      })
    },
  }
}

// scripts/dev.mjs를 거치지 않고 vite를 직접 실행해도 같은 PC별 설정을 쓰도록 여기서도 읽는다.
// 이미 읽힌 값은 덮어쓰지 않으므로 중복 호출해도 결과가 같다.
loadMindNProgressEnvironment()

// 개발 서버와 API 서버를 다른 포트 조합으로 띄울 수 있게 서버와 같은 환경변수를 본다.
const apiPort = Number(process.env.MNP_API_PORT) || 4176

// Vite는 IP와 localhost 외의 Host로 들어온 요청을 기본적으로 차단한다.
// 리버스 프록시 뒤에서 도메인으로 접속하려면 그 호스트를 허용해야 한다.
// 도메인을 저장소에 남기지 않도록 MNP_PUBLIC_URL의 호스트와
// 쉼표로 구분한 MNP_DEV_ALLOWED_HOSTS에서만 읽는다.
function configuredAllowedHosts() {
  const hosts = String(process.env.MNP_DEV_ALLOWED_HOSTS ?? '').split(',').map((host) => host.trim()).filter(Boolean)
  const publicUrl = String(process.env.MNP_PUBLIC_URL ?? '').trim()
  if (publicUrl) {
    try {
      hosts.push(new URL(/^https?:\/\//i.test(publicUrl) ? publicUrl : `http://${publicUrl}`).hostname)
    } catch {
      // 잘못된 MNP_PUBLIC_URL은 서버가 시작할 때 경고하므로 여기서는 건너뛴다.
    }
  }
  return [...new Set(hosts)]
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [localLoopbackRedirectPlugin(), react()],
  server: {
    host: '0.0.0.0',
    port: 4175,
    strictPort: true,
    allowedHosts: configuredAllowedHosts(),
    proxy: {
      // xfwd로 실제 접속 주소를 전달해야 서버가 같은 PC 요청인지 판별할 수 있다.
      '/api': { target: `http://127.0.0.1:${apiPort}`, xfwd: true },
    },
  },
})
