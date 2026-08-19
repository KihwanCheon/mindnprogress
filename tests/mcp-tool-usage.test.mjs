import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  MCP_TOOL_USAGE_SCHEMA_VERSION,
  createFileToolUsageRecorder,
  createToolUsageRecorder,
  mergeToolUsageShards,
  normalizeToolUsageShard,
  readToolUsageTotals,
} from '../server/lib/mcpToolUsage.mjs'

function shard(overrides = {}) {
  return {
    schemaVersion: MCP_TOOL_USAGE_SCHEMA_VERSION,
    pid: 1000,
    conversationId: 'conversation-a',
    startedAt: '2026-08-20T01:00:00.000Z',
    updatedAt: '2026-08-20T01:30:00.000Z',
    registeredTools: ['mindnprogress_get_context', 'mindnprogress_empty_trash'],
    tools: {
      mindnprogress_get_context: {
        ok: 3,
        fail: 0,
        chars: 30_000,
        maxChars: 12_000,
        lastCalledAt: '2026-08-20T01:20:00.000Z',
      },
    },
    ...overrides,
  }
}

function fixedClock(startMs) {
  let current = startMs
  return {
    now: () => current,
    advance: (ms) => {
      current += ms
    },
  }
}

test('스키마 버전이 다르거나 손상된 계측 파일은 버린다', () => {
  assert.equal(normalizeToolUsageShard(null), null)
  assert.equal(normalizeToolUsageShard('망가진 값'), null)
  assert.equal(normalizeToolUsageShard({ schemaVersion: 99, tools: {} }), null)
  assert.notEqual(normalizeToolUsageShard(shard()), null)
})

test('음수와 숫자가 아닌 횟수는 0으로 보정한다', () => {
  const normalized = normalizeToolUsageShard(shard({
    tools: {
      mindnprogress_get_card: { ok: -5, fail: '2', chars: null, maxChars: Number.NaN, lastCalledAt: '잘못된 시각' },
    },
  }))

  assert.deepEqual(normalized.tools.mindnprogress_get_card, {
    ok: 0,
    fail: 2,
    chars: 0,
    maxChars: 0,
    lastCalledAt: null,
  })
})

test('여러 프로세스의 계측 파일을 하나의 집계로 합산한다', () => {
  const totals = mergeToolUsageShards([
    shard(),
    shard({
      pid: 2000,
      startedAt: '2026-08-20T00:30:00.000Z',
      updatedAt: '2026-08-20T02:00:00.000Z',
      tools: {
        mindnprogress_get_context: {
          ok: 1,
          fail: 1,
          chars: 20_000,
          maxChars: 18_000,
          lastCalledAt: '2026-08-20T01:55:00.000Z',
        },
      },
    }),
  ])

  const context = totals.tools.find((tool) => tool.name === 'mindnprogress_get_context')
  assert.equal(totals.shardCount, 2)
  assert.equal(context.calls, 5)
  assert.equal(context.ok, 4)
  assert.equal(context.fail, 1)
  assert.equal(context.chars, 50_000)
  assert.equal(context.maxChars, 18_000)
  assert.equal(context.avgChars, 10_000)
  assert.equal(context.lastCalledAt, '2026-08-20T01:55:00.000Z')
  // 수집 구간은 가장 이른 시작과 가장 늦은 갱신으로 넓힌다.
  assert.equal(totals.startedAt, '2026-08-20T00:30:00.000Z')
  assert.equal(totals.updatedAt, '2026-08-20T02:00:00.000Z')
  assert.equal(totals.totalCalls, 5)
  assert.equal(totals.totalChars, 50_000)
})

test('손상된 계측 파일이 섞여도 나머지 집계는 유지된다', () => {
  const totals = mergeToolUsageShards([shard(), null, { schemaVersion: 0 }, '깨진 파일'])

  assert.equal(totals.shardCount, 1)
  assert.equal(totals.totalCalls, 3)
})

test('등록만 되고 한 번도 호출되지 않은 도구를 삭제 후보로 남긴다', () => {
  const totals = mergeToolUsageShards([shard()])

  assert.deepEqual(totals.unusedTools, ['mindnprogress_empty_trash'])
  assert.equal(totals.registeredToolCount, 2)
  const unused = totals.tools.find((tool) => tool.name === 'mindnprogress_empty_trash')
  assert.equal(unused.calls, 0)
  assert.equal(unused.lastCalledAt, null)
})

test('집계는 호출이 많은 도구부터 정렬한다', () => {
  const totals = mergeToolUsageShards([shard({
    registeredTools: ['a_tool', 'b_tool', 'c_tool'],
    tools: {
      a_tool: { ok: 1, fail: 0, chars: 10, maxChars: 10, lastCalledAt: null },
      b_tool: { ok: 9, fail: 0, chars: 90, maxChars: 10, lastCalledAt: null },
      c_tool: { ok: 5, fail: 0, chars: 50, maxChars: 10, lastCalledAt: null },
    },
  })])

  assert.deepEqual(totals.tools.map((tool) => tool.name), ['b_tool', 'c_tool', 'a_tool'])
})

test('성공과 실패를 구분해 세고 응답 문자 수를 누적한다', async () => {
  const clock = fixedClock(Date.parse('2026-08-20T03:00:00.000Z'))
  const written = []
  const recorder = createToolUsageRecorder({
    now: clock.now,
    pid: 4242,
    conversationId: 'conversation-b',
    flushIntervalMs: 0,
    writeSnapshot: async (payload) => {
      written.push(payload)
    },
  })

  recorder.declare('mindnprogress_update_card')
  recorder.declare('mindnprogress_empty_trash')
  recorder.record('mindnprogress_update_card', { ok: true, chars: 52_190 })
  clock.advance(1_000)
  recorder.record('mindnprogress_update_card', { ok: false, chars: 120 })
  await recorder.flush()

  assert.equal(written.length, 1)
  const [snapshot] = written
  assert.equal(snapshot.schemaVersion, MCP_TOOL_USAGE_SCHEMA_VERSION)
  assert.equal(snapshot.pid, 4242)
  assert.equal(snapshot.conversationId, 'conversation-b')
  assert.deepEqual(snapshot.registeredTools, ['mindnprogress_update_card', 'mindnprogress_empty_trash'])
  assert.deepEqual(snapshot.tools.mindnprogress_update_card, {
    ok: 1,
    fail: 1,
    chars: 52_310,
    maxChars: 52_190,
    lastCalledAt: '2026-08-20T03:00:01.000Z',
  })
  recorder.close()
})

test('변경이 없으면 계측 파일을 다시 쓰지 않는다', async () => {
  let writeCount = 0
  const recorder = createToolUsageRecorder({
    flushIntervalMs: 0,
    writeSnapshot: async () => {
      writeCount += 1
    },
  })

  assert.equal(await recorder.flush(), false)
  recorder.record('mindnprogress_get_card', { ok: true, chars: 10 })
  assert.equal(await recorder.flush(), true)
  assert.equal(await recorder.flush(), false)
  assert.equal(writeCount, 1)
  recorder.close()
})

test('계측 쓰기가 실패해도 예외를 던지지 않고 기록을 계속한다', async () => {
  const errors = []
  const recorder = createToolUsageRecorder({
    flushIntervalMs: 0,
    onError: (error) => errors.push(error),
    writeSnapshot: async () => {
      throw new Error('디스크 실패')
    },
  })

  recorder.record('mindnprogress_add_card', { ok: true, chars: 100 })
  assert.equal(await recorder.flush(), false)
  assert.equal(errors.length, 1)

  recorder.record('mindnprogress_add_card', { ok: true, chars: 100 })
  assert.equal(recorder.snapshot().tools.mindnprogress_add_card.ok, 2)
  recorder.close()
})

test('도구 이름이 비어 있으면 계측을 건너뛴다', () => {
  const recorder = createToolUsageRecorder({ flushIntervalMs: 0, writeSnapshot: async () => {} })

  recorder.declare('')
  recorder.record('', { ok: true, chars: 10 })
  recorder.record(null, { ok: true, chars: 10 })

  assert.deepEqual(recorder.snapshot().registeredTools, [])
  assert.deepEqual(recorder.snapshot().tools, {})
  assert.equal(recorder.hasPendingChanges(), false)
  recorder.close()
})

test('프로세스가 다시 시작해도 이전 계측 파일이 남아 누적값이 유지된다', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'mnp-mcp-usage-'))
  try {
    const first = createFileToolUsageRecorder(directory, { flushIntervalMs: 0 })
    first.declare('mindnprogress_get_context')
    first.declare('mindnprogress_empty_trash')
    first.record('mindnprogress_get_context', { ok: true, chars: 1_000 })
    await first.flush()
    first.close()

    // 재시작을 모사한다. 새 프로세스는 자기 shard 파일만 새로 쓴다.
    const second = createFileToolUsageRecorder(directory, { flushIntervalMs: 0 })
    second.declare('mindnprogress_get_context')
    second.declare('mindnprogress_empty_trash')
    second.record('mindnprogress_get_context', { ok: true, chars: 2_000 })
    await second.flush()
    second.close()

    assert.notEqual(first.file, second.file)

    const totals = await readToolUsageTotals(directory)
    const context = totals.tools.find((tool) => tool.name === 'mindnprogress_get_context')
    assert.equal(totals.shardCount, 2)
    assert.equal(context.calls, 2)
    assert.equal(context.chars, 3_000)
    assert.deepEqual(totals.unusedTools, ['mindnprogress_empty_trash'])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('계측 디렉터리가 없으면 빈 집계를 돌려준다', async () => {
  const totals = await readToolUsageTotals(path.join(tmpdir(), 'mnp-mcp-usage-없는-경로'))

  assert.equal(totals.shardCount, 0)
  assert.equal(totals.totalCalls, 0)
  assert.deepEqual(totals.tools, [])
})
