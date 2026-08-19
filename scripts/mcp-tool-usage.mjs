#!/usr/bin/env node
// MCP 도구 호출 빈도 집계를 사람이 확인하는 방법.
//   node scripts/mcp-tool-usage.mjs          표로 출력
//   node scripts/mcp-tool-usage.mjs --json   집계 JSON 그대로 출력
//
// 프로세스별 shard 파일을 모두 읽어 합산한다. MCP 서버를 멈추지 않아도 되고
// 읽기만 하므로 실행 중인 계측에 영향을 주지 않는다.

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MCP_TOOL_USAGE_DIRECTORY_NAME,
  readToolUsageShards,
  mergeToolUsageShards,
} from '../server/lib/mcpToolUsage.mjs'

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataDirectory = path.resolve(String(process.env.MNP_DATA_DIR ?? '').trim()
  || path.join(projectDirectory, 'server', 'data'))
const usageDirectory = path.resolve(String(process.env.MNP_MCP_USAGE_DIR ?? '').trim()
  || path.join(dataDirectory, MCP_TOOL_USAGE_DIRECTORY_NAME))

function number(value) {
  return value.toLocaleString('en-US')
}

function shortTime(value) {
  return value ? value.replace('T', ' ').replace(/\.\d{3}Z$/, '') : '-'
}

function padEnd(value, width) {
  const text = String(value)
  return text.length >= width ? text : text + ' '.repeat(width - text.length)
}

function padStart(value, width) {
  const text = String(value)
  return text.length >= width ? text : ' '.repeat(width - text.length) + text
}

function printTable(totals) {
  const nameWidth = Math.max(12, ...totals.tools.map((tool) => tool.name.length))
  const header = [
    padEnd('도구', nameWidth),
    padStart('호출', 6),
    padStart('실패', 5),
    padStart('응답합계', 11),
    padStart('평균', 8),
    padStart('최대', 8),
    '  마지막 호출',
  ].join(' ')
  console.log(header)
  console.log('-'.repeat(header.length))
  for (const tool of totals.tools) {
    console.log([
      padEnd(tool.name, nameWidth),
      padStart(number(tool.calls), 6),
      padStart(number(tool.fail), 5),
      padStart(number(tool.chars), 11),
      padStart(number(tool.avgChars), 8),
      padStart(number(tool.maxChars), 8),
      `  ${shortTime(tool.lastCalledAt)}`,
    ].join(' '))
  }
}

async function main() {
  const shards = await readToolUsageShards(usageDirectory)
  const totals = mergeToolUsageShards(shards)

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(totals, null, 2))
    return
  }

  console.log(`계측 디렉터리: ${usageDirectory}`)
  if (totals.shardCount === 0) {
    console.log('수집된 계측 파일이 없습니다. MCP 서버가 한 번도 도구를 처리하지 않았거나 계측이 꺼져 있습니다.')
    return
  }

  console.log(`수집 구간: ${shortTime(totals.startedAt)} ~ ${shortTime(totals.updatedAt)} (프로세스 ${number(totals.shardCount)}개)`)
  console.log(`총 호출 ${number(totals.totalCalls)}회, 총 응답 ${number(totals.totalChars)}자, 등록 도구 ${number(totals.registeredToolCount)}개`)
  console.log('')
  printTable(totals)
  console.log('')

  const byChars = [...totals.tools]
    .filter((tool) => tool.chars > 0)
    .sort((first, second) => second.chars - first.chars)
    .slice(0, 10)
  if (byChars.length > 0) {
    console.log('응답 비용 상위 (호출 횟수 x 응답 크기, 최적화 우선순위):')
    for (const [index, tool] of byChars.entries()) {
      const share = totals.totalChars > 0 ? Math.round((tool.chars / totals.totalChars) * 1000) / 10 : 0
      console.log(`  ${padStart(index + 1, 2)}. ${padEnd(tool.name, 46)} ${padStart(number(tool.chars), 11)}자 (${share}%, ${number(tool.calls)}회)`)
    }
    console.log('')
  }

  if (totals.unusedTools.length === 0) {
    console.log('호출되지 않은 도구: 없음')
    return
  }
  console.log(`호출되지 않은 도구 ${number(totals.unusedTools.length)}개 (삭제 후보):`)
  for (const name of totals.unusedTools) console.log(`  - ${name}`)
}

await main()
