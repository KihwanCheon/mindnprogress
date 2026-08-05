import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { localLoopbackRedirectLocation } from './server/lib/localLoopbackRedirect.mjs'

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

// https://vite.dev/config/
export default defineConfig({
  plugins: [localLoopbackRedirectPlugin(), react()],
  server: {
    host: '0.0.0.0',
    port: 4175,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:4176',
    },
  },
})
