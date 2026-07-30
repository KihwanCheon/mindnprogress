import { spawn } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const testsDirectory = path.join(projectDirectory, 'tests')
const testFiles = (await readdir(testsDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith('.test.mjs'))
  .map((entry) => path.join(testsDirectory, entry.name))
  .sort()

if (testFiles.length === 0) throw new Error('실행할 단위 테스트를 찾지 못했습니다.')

const child = spawn(process.execPath, ['--test', ...testFiles], {
  cwd: projectDirectory,
  stdio: 'inherit',
})
const exitCode = await new Promise((resolve, reject) => {
  child.once('error', reject)
  child.once('exit', (code) => resolve(code))
})
process.exitCode = exitCode ?? 1
