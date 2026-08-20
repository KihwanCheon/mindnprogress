import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const viteEntry = path.join(projectDirectory, 'node_modules', 'vite', 'bin', 'vite.js')
const watchServer = process.argv.includes('--watch')
const serverEntry = path.join(projectDirectory, 'server', 'index.mjs')
console.log(`[Mind & Progress] API server mode: ${watchServer ? 'watch' : 'stable'}`)
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
    if (!stopping && code !== 0) stop(code ?? 1)
  })
}

process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())
