import { existsSync } from 'node:fs'
import path from 'node:path'
import { loadEnvFile } from 'node:process'
import { fileURLToPath } from 'node:url'

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function loadLocalEnvironment(environmentFile = path.join(projectDirectory, '.env.local')) {
  if (!existsSync(environmentFile)) return false
  loadEnvFile(environmentFile)
  return true
}
