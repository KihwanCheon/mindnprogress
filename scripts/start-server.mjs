import { loadLocalEnvironment } from './local-environment.mjs'

loadLocalEnvironment()
await import('../server/index.mjs')
