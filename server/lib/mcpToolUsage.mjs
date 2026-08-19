// MCP 도구 호출 빈도 계측. 사실상 미사용인 도구를 정리하고 호출이 잦은 도구의
// 응답 비용을 줄일 근거를 남기기 위한 최소 계측이다.
//
// MCP는 stdio 전송이라 AI 클라이언트 연결마다 별도 프로세스가 뜨고 모두 같은
// 데이터 디렉터리를 공유한다. 파일 하나를 여러 프로세스가 read-modify-write 하면
// 갱신을 잃으므로, 프로세스마다 자기 shard 파일 하나만 통째로 원자적으로 덮어쓰고
// 합산은 읽는 쪽에서 한다. 파일당 writer가 하나뿐이라 잠금이 필요 없고, 이전
// 프로세스의 shard가 그대로 남아 재시작 후에도 누적값이 유지된다.
//
// 기록하는 값은 도구 이름, 성공·실패 횟수, 마지막 호출 시각과 응답 문자 수뿐이다.
// 인자 값, 카드 본문과 사용자 입력은 기록하지 않는다.

import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

export const MCP_TOOL_USAGE_SCHEMA_VERSION = 1
export const MCP_TOOL_USAGE_DIRECTORY_NAME = '_mcp-tool-usage'
const DEFAULT_FLUSH_INTERVAL_MS = 2_000

function safeCount(value) {
  const count = Number(value)
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
}

function isoDate(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

function laterDate(first, second) {
  if (!first) return second
  if (!second) return first
  return Date.parse(first) >= Date.parse(second) ? first : second
}

function earlierDate(first, second) {
  if (!first) return second
  if (!second) return first
  return Date.parse(first) <= Date.parse(second) ? first : second
}

function emptyEntry() {
  return { ok: 0, fail: 0, chars: 0, maxChars: 0, lastCalledAt: null }
}

// 손상되거나 버전이 다른 shard는 계측 전체를 막지 않고 조용히 버린다.
export function normalizeToolUsageShard(value) {
  if (!value || typeof value !== 'object') return null
  if (value.schemaVersion !== MCP_TOOL_USAGE_SCHEMA_VERSION) return null

  const source = value.tools && typeof value.tools === 'object' ? value.tools : {}
  const tools = {}
  for (const [name, entry] of Object.entries(source)) {
    if (!name || !entry || typeof entry !== 'object') continue
    tools[name] = {
      ok: safeCount(entry.ok),
      fail: safeCount(entry.fail),
      chars: safeCount(entry.chars),
      maxChars: safeCount(entry.maxChars),
      lastCalledAt: isoDate(entry.lastCalledAt),
    }
  }

  const conversationId = typeof value.conversationId === 'string' ? value.conversationId.trim() : ''
  return {
    schemaVersion: MCP_TOOL_USAGE_SCHEMA_VERSION,
    pid: safeCount(value.pid) || null,
    conversationId: conversationId || null,
    startedAt: isoDate(value.startedAt),
    updatedAt: isoDate(value.updatedAt),
    registeredTools: Array.isArray(value.registeredTools)
      ? value.registeredTools.filter((name) => typeof name === 'string' && name.trim())
      : [],
    tools,
  }
}

// 프로세스별 shard를 하나의 집계로 합친다. 등록되었지만 한 번도 호출되지 않은
// 도구는 unusedTools로 남겨 미사용 도구 판단에 그대로 쓴다.
export function mergeToolUsageShards(shards) {
  const totals = new Map()
  const registeredTools = new Set()
  let shardCount = 0
  let startedAt = null
  let updatedAt = null

  for (const raw of shards ?? []) {
    const shard = normalizeToolUsageShard(raw)
    if (!shard) continue
    shardCount += 1
    startedAt = earlierDate(startedAt, shard.startedAt)
    updatedAt = laterDate(updatedAt, shard.updatedAt)
    for (const name of shard.registeredTools) registeredTools.add(name)
    for (const [name, entry] of Object.entries(shard.tools)) {
      registeredTools.add(name)
      const total = totals.get(name) ?? emptyEntry()
      total.ok += entry.ok
      total.fail += entry.fail
      total.chars += entry.chars
      total.maxChars = Math.max(total.maxChars, entry.maxChars)
      total.lastCalledAt = laterDate(total.lastCalledAt, entry.lastCalledAt)
      totals.set(name, total)
    }
  }

  const tools = [...registeredTools].map((name) => {
    const entry = totals.get(name) ?? emptyEntry()
    const calls = entry.ok + entry.fail
    return {
      name,
      calls,
      ok: entry.ok,
      fail: entry.fail,
      chars: entry.chars,
      maxChars: entry.maxChars,
      avgChars: calls > 0 ? Math.round(entry.chars / calls) : 0,
      lastCalledAt: entry.lastCalledAt,
    }
  }).sort((first, second) => (second.calls - first.calls)
    || (second.chars - first.chars)
    || first.name.localeCompare(second.name))

  return {
    schemaVersion: MCP_TOOL_USAGE_SCHEMA_VERSION,
    shardCount,
    startedAt,
    updatedAt,
    totalCalls: tools.reduce((sum, tool) => sum + tool.calls, 0),
    totalChars: tools.reduce((sum, tool) => sum + tool.chars, 0),
    registeredToolCount: registeredTools.size,
    tools,
    unusedTools: tools.filter((tool) => tool.calls === 0).map((tool) => tool.name).sort(),
  }
}

// 계측은 도구 호출을 절대 막지 않는다. 모든 실패는 onError로만 흘리고 삼킨다.
export function createToolUsageRecorder({
  writeSnapshot,
  now = () => Date.now(),
  pid = process.pid,
  conversationId = '',
  flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS,
  scheduler = { setTimeout, clearTimeout },
  onError = () => {},
} = {}) {
  const startedAt = new Date(now()).toISOString()
  const tools = new Map()
  const registeredTools = []
  let dirty = false
  let timer = null
  let lastFlushAt = 0
  let writing = Promise.resolve()

  function snapshot() {
    const entries = {}
    for (const [name, entry] of tools) entries[name] = { ...entry }
    return {
      schemaVersion: MCP_TOOL_USAGE_SCHEMA_VERSION,
      pid,
      conversationId: String(conversationId ?? '').trim() || null,
      startedAt,
      updatedAt: new Date(now()).toISOString(),
      registeredTools: [...registeredTools],
      tools: entries,
    }
  }

  function schedule() {
    if (timer || !dirty || flushIntervalMs <= 0) return
    const wait = Math.max(0, lastFlushAt + flushIntervalMs - now())
    timer = scheduler.setTimeout(() => {
      timer = null
      void flush()
    }, wait)
    // 계측 타이머가 MCP 프로세스 종료를 붙잡지 않게 한다.
    if (timer && typeof timer.unref === 'function') timer.unref()
  }

  // 도구 등록 시점에 이름을 모아 둔다. 한 번도 호출되지 않은 도구를
  // "기록이 없는 도구"가 아니라 "0회 호출"로 구분하기 위한 목록이다.
  function declare(name) {
    if (typeof name !== 'string' || !name.trim()) return
    if (!registeredTools.includes(name)) registeredTools.push(name)
  }

  function record(name, { ok = true, chars = 0 } = {}) {
    try {
      if (typeof name !== 'string' || !name.trim()) return
      const entry = tools.get(name) ?? emptyEntry()
      const size = safeCount(chars)
      if (ok) entry.ok += 1
      else entry.fail += 1
      entry.chars += size
      entry.maxChars = Math.max(entry.maxChars, size)
      entry.lastCalledAt = new Date(now()).toISOString()
      tools.set(name, entry)
      dirty = true
      schedule()
    } catch (error) {
      onError(error)
    }
  }

  async function flush() {
    if (!dirty) return false
    dirty = false
    lastFlushAt = now()
    const payload = snapshot()
    writing = writing.catch(() => {}).then(() => writeSnapshot(payload))
    try {
      await writing
      return true
    } catch (error) {
      onError(error)
      return false
    }
  }

  function close() {
    if (timer) {
      scheduler.clearTimeout(timer)
      timer = null
    }
  }

  return {
    declare,
    record,
    flush,
    close,
    snapshot,
    hasPendingChanges: () => dirty,
    registeredToolCount: () => registeredTools.length,
  }
}

async function writeShardFile(file, payload) {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  await rename(temporary, file)
}

function writeShardFileSync(file, payload) {
  mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  renameSync(temporary, file)
}

// 백업 스크립트는 데이터 디렉터리를 통째로 복사하면서 파일별 SHA-256을 검증하고
// MCP 프로세스는 멈추지 않는다. 제자리 덮어쓰기는 잘린 파일이 백업될 수 있으므로
// 비동기·동기 모두 임시 파일에 쓴 뒤 rename 한다.
export function createFileToolUsageRecorder(directory, { flushOnExit = false, ...options } = {}) {
  const file = path.join(directory, `${process.pid}-${randomBytes(4).toString('hex')}.json`)
  const recorder = createToolUsageRecorder({
    ...options,
    writeSnapshot: (payload) => writeShardFile(file, payload),
  })

  function flushSync() {
    if (!recorder.hasPendingChanges()) return false
    try {
      writeShardFileSync(file, recorder.snapshot())
      return true
    } catch {
      return false
    }
  }

  // 정상 종료 시 마지막 구간을 잃지 않도록 한 번만 동기로 쓴다.
  // 호출마다 동기 쓰기를 하지는 않는다.
  if (flushOnExit) process.on('exit', flushSync)

  return { ...recorder, file, flushSync }
}

export async function readToolUsageShards(directory) {
  let entries = []
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return []
  }
  const shards = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    try {
      shards.push(JSON.parse(await readFile(path.join(directory, entry.name), 'utf8')))
    } catch {
      continue
    }
  }
  return shards
}

export async function readToolUsageTotals(directory) {
  return mergeToolUsageShards(await readToolUsageShards(directory))
}
