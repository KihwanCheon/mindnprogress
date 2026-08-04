import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

const defaultDoorayBaseUrl = 'https://api.dooray.com'
const defaultDoorayMcpServerName = 'docker-dooray-mcp'
const doorayTaskHostnamePattern = /^(?:[a-z0-9-]+\.)+dooray\.com$/i
const doorayTaskPathPattern = /^\/task\/(\d+)\/(\d+)\/?$/

export class DoorayTaskError extends Error {
  constructor(code, message, status = 500) {
    super(message)
    this.name = 'DoorayTaskError'
    this.code = code
    this.status = status
  }
}

function normalizeDoorayBaseUrl(value) {
  try {
    const url = new URL(String(value ?? '').trim() || defaultDoorayBaseUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('UNSUPPORTED_PROTOCOL')
    url.pathname = '/'
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/+$/, '')
  } catch {
    throw new DoorayTaskError('CONFIG_INVALID', 'Dooray API 주소가 올바르지 않습니다.', 503)
  }
}

export async function loadDoorayApiConfig({
  env = process.env,
  homeDirectory = homedir(),
  readText = (filePath) => readFile(filePath, 'utf8'),
} = {}) {
  const environmentApiKey = String(env.MNP_DOORAY_API_KEY ?? env.DOORAY_API_KEY ?? '').trim()
  const environmentBaseUrl = String(env.MNP_DOORAY_BASE_URL ?? env.DOORAY_BASE_URL ?? '').trim()
  if (environmentApiKey) {
    return {
      apiKey: environmentApiKey,
      baseUrl: normalizeDoorayBaseUrl(environmentBaseUrl),
      source: 'environment',
    }
  }

  const configFile = path.resolve(
    String(env.MNP_DOORAY_CONFIG_FILE ?? '').trim() || path.join(homeDirectory, '.claude.json'),
  )
  let parsed
  try {
    parsed = JSON.parse(await readText(configFile))
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        apiKey: '',
        baseUrl: normalizeDoorayBaseUrl(environmentBaseUrl),
        source: 'unavailable',
        configFile,
      }
    }
    throw new DoorayTaskError('CONFIG_INVALID', 'Dooray MCP 설정 파일을 읽지 못했습니다.', 503)
  }

  const serverName = String(env.MNP_DOORAY_MCP_SERVER_NAME ?? '').trim() || defaultDoorayMcpServerName
  const connectorEnv = parsed?.mcpServers?.[serverName]?.env ?? {}
  const apiKey = String(connectorEnv.DOORAY_API_KEY ?? '').trim()
  const baseUrl = environmentBaseUrl || String(connectorEnv.DOORAY_BASE_URL ?? '').trim()
  return {
    apiKey,
    baseUrl: normalizeDoorayBaseUrl(baseUrl),
    source: apiKey ? 'claude-config' : 'unavailable',
    configFile,
  }
}

export function parseDoorayTaskUrl(value) {
  let url
  try {
    url = new URL(String(value ?? '').trim())
  } catch {
    throw new DoorayTaskError('INVALID_URL', 'Dooray 업무 URL 형식이 올바르지 않습니다.', 400)
  }
  const match = doorayTaskPathPattern.exec(url.pathname)
  if (url.protocol !== 'https:' || url.port || !doorayTaskHostnamePattern.test(url.hostname) || !match) {
    throw new DoorayTaskError('INVALID_URL', 'Dooray 업무 URL 형식이 올바르지 않습니다.', 400)
  }
  const [, projectId, postId] = match
  return {
    projectId,
    postId,
    hostname: url.hostname.toLowerCase(),
    url: `https://${url.hostname.toLowerCase()}/task/${projectId}/${postId}`,
  }
}

export async function fetchDoorayTaskPreview(taskUrl, config, {
  fetchImpl = fetch,
  timeoutMs = 8_000,
  now = () => new Date(),
} = {}) {
  if (!config?.apiKey) {
    throw new DoorayTaskError('CONFIG_UNAVAILABLE', 'Dooray API 키가 설정되어 있지 않습니다.', 503)
  }
  const parsed = typeof taskUrl === 'string' ? parseDoorayTaskUrl(taskUrl) : taskUrl
  const endpoint = `${normalizeDoorayBaseUrl(config.baseUrl)}/project/v1/projects/${encodeURIComponent(parsed.projectId)}/posts/${encodeURIComponent(parsed.postId)}`
  let response
  try {
    response = await fetchImpl(endpoint, {
      headers: {
        Authorization: `dooray-api ${config.apiKey}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    throw new DoorayTaskError('UPSTREAM_UNAVAILABLE', 'Dooray 업무 조회 서버에 연결하지 못했습니다.', 502)
  }

  if (response.status === 401 || response.status === 403) {
    throw new DoorayTaskError('ACCESS_DENIED', 'Dooray 업무를 조회할 권한이 없습니다.', 403)
  }
  if (response.status === 404) {
    throw new DoorayTaskError('NOT_FOUND', 'Dooray 업무를 찾을 수 없습니다.', 404)
  }
  if (!response.ok) {
    throw new DoorayTaskError('UPSTREAM_ERROR', 'Dooray 업무를 조회하지 못했습니다.', 502)
  }

  let payload
  try {
    payload = await response.json()
  } catch {
    throw new DoorayTaskError('INVALID_RESPONSE', 'Dooray 업무 응답을 해석하지 못했습니다.', 502)
  }
  const result = payload?.result
  const subject = typeof result?.subject === 'string' ? result.subject.trim().slice(0, 240) : ''
  if (!subject) {
    throw new DoorayTaskError('INVALID_RESPONSE', 'Dooray 업무 제목을 확인하지 못했습니다.', 502)
  }

  return {
    provider: 'dooray-task',
    url: parsed.url,
    hostname: parsed.hostname,
    projectId: parsed.projectId,
    postId: parsed.postId,
    subject,
    taskNumber: typeof result.taskNumber === 'string' ? result.taskNumber.trim().slice(0, 160) : '',
    workflowName: typeof result.workflow?.name === 'string' ? result.workflow.name.trim().slice(0, 120) : '',
    workflowClass: typeof result.workflowClass === 'string' ? result.workflowClass.trim().slice(0, 40) : '',
    closed: result.closed === true,
    resolvedAt: now().toISOString(),
  }
}

export function isValidDoorayTaskLinkData(value) {
  if (!value || value.provider !== 'dooray-task') return false
  let parsed
  try {
    parsed = parseDoorayTaskUrl(value.url)
  } catch {
    return false
  }
  return parsed.projectId === value.projectId
    && parsed.postId === value.postId
    && typeof value.hostname === 'string'
    && value.hostname === parsed.hostname
    && (value.title === undefined || (typeof value.title === 'string' && value.title.length <= 240))
    && typeof value.taskNumber === 'string'
    && value.taskNumber.length <= 160
    && typeof value.workflowName === 'string'
    && value.workflowName.length <= 120
    && typeof value.workflowClass === 'string'
    && value.workflowClass.length <= 40
    && typeof value.closed === 'boolean'
    && typeof value.resolvedAt === 'string'
    && Number.isFinite(Date.parse(value.resolvedAt))
    && Number.isFinite(value.displayWidth)
    && value.displayWidth >= 160
    && value.displayWidth <= 1_200
    && Number.isFinite(value.displayHeight)
    && value.displayHeight >= 96
    && value.displayHeight <= 800
}
