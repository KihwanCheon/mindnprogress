import { loadLocalEnvironment } from '../local-environment.mjs'
loadLocalEnvironment()
const apiPort = Number(process.env.MNP_API_PORT ?? 4176)
const webPort = Number(process.env.MNP_WEB_PORT ?? 4175)
if (![apiPort, webPort].every((port) => Number.isInteger(port) && port > 0 && port <= 65535) || apiPort === webPort) throw Error('Invalid MnP ports')
if (!['127.0.0.1', '0.0.0.0', 'localhost'].includes(process.env.MNP_API_HOST ?? '127.0.0.1')) throw Error('Runtime controller requires a local IPv4 API host')
console.log(JSON.stringify({ apiPort, webPort, apiUrl: `http://127.0.0.1:${apiPort}/api/health`, webUrl: `http://127.0.0.1:${webPort}/` }))
