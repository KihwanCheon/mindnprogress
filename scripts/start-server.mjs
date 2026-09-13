import { loadMindNProgressEnvironment } from './local-environment.mjs'

const loadedConfigFiles = loadMindNProgressEnvironment()
console.log(`[Mind & Progress] 설정 파일: ${loadedConfigFiles.length > 0 ? loadedConfigFiles.join(', ') : '없음'}`)
await import('../server/index.mjs')
