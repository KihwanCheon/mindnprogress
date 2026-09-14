import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadLocalEnvironment } from './local-environment.mjs'
import { supervise } from './runtime/supervisor.mjs'

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
loadLocalEnvironment()
const viteEntry = path.join(projectDirectory, 'node_modules', 'vite', 'bin', 'vite.js')
const watchServer = process.argv.includes('--watch')
const serverEntry = path.join(projectDirectory, 'server', 'index.mjs')
console.log(`[Mind & Progress] API server mode: ${watchServer ? 'watch' : 'stable'}`)
if (!watchServer) {
  await supervise({ projectDirectory,
    stateDirectory: process.env.MNP_RUNTIME_STATE_DIR || path.resolve(projectDirectory, '..', '.mindnprogress'),
    entries: [{ name: 'api', file: serverEntry }, { name: 'web', file: path.join(projectDirectory, 'scripts/runtime/web.mjs') }],
  })
} else {
// 개발용 --watch는 기존 경로를 유지한다. 예약 작업은 stable 감시자를 사용한다.
const children = [
  spawn(process.execPath, watchServer ? ['--watch', serverEntry] : [serverEntry], {
    cwd: projectDirectory,
    stdio: 'inherit',
  }),
  spawn(process.execPath, [viteEntry], {
    cwd: projectDirectory,
    stdio: 'inherit',
  }),
]

let stopping = false

function stop(exitCode = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) child.kill()
  setTimeout(() => process.exit(exitCode), 100)
}

for (const child of children) {
  child.on('exit', (code) => {
    if (!stopping) stop(code || 1)
  })
}

process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())
}
