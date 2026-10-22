import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildAiInstructionSnapshots } from './helpers/aiInstructionSnapshots.mjs'
import { AI_RESPONSE_SIZE_LIMITS, aiResponseSizeWarnings, measureAiResponseSizes } from './helpers/aiResponseSizes.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const scenarios = JSON.parse(await readFile(path.join(root, 'tests/fixtures/ai-guidance-behavior-scenarios.json'), 'utf8'))
const budget = JSON.parse(await readFile(path.join(root, 'tests/fixtures/ai-instruction-budget.json'), 'utf8'))
const checklist = await readFile(path.join(root, 'docs/ai-guidance-rollback-2026-10-01/behavior-evaluation-checklist.md'), 'utf8')

test('행동 평가 시나리오는 판정 가능한 기대·금지 행동과 근거를 갖춘다', () => {
  assert.equal(scenarios.schemaVersion, 1)
  const ids = scenarios.scenarios.map((scenario) => scenario.id)
  assert.equal(new Set(ids).size, ids.length, '시나리오 ID 중복')
  assert.ok(ids.length >= 10)
  for (const scenario of scenarios.scenarios) {
    assert.match(scenario.id, /^BEH-\d{2}$/)
    for (const key of ['title', 'category', 'role', 'setup']) assert.ok(String(scenario[key] ?? '').trim(), `${scenario.id}.${key}`)
    for (const key of ['expected', 'forbidden', 'evidence']) {
      assert.ok(Array.isArray(scenario[key]) && scenario[key].length > 0 && scenario[key].every((item) => String(item).trim()), `${scenario.id}.${key}`)
    }
    assert.ok(Array.isArray(scenario.guidanceSurfaces), `${scenario.id}.guidanceSurfaces`)
    assert.ok(checklist.includes(scenario.id), `${scenario.id}가 수동 평가 체크리스트에 없습니다.`)
  }
})

test('각 시나리오의 규칙이 현재 전달 전문에 실제로 노출된다', async () => {
  const snapshots = Object.fromEntries((await buildAiInstructionSnapshots()).map(({ name, text }) => [name, text]))
  for (const scenario of scenarios.scenarios) {
    for (const surface of scenario.guidanceSurfaces) {
      assert.ok(Object.hasOwn(snapshots, surface.snapshot), `${scenario.id}: 알 수 없는 전문 ${surface.snapshot}`)
      assert.ok(snapshots[surface.snapshot].includes(surface.mustContain), `${scenario.id}: ${surface.snapshot}에서 규칙이 사라졌습니다: ${surface.mustContain}`)
    }
  }
})

// 응답 크기 상한은 경고선이다(rollback-cause-record.md: 문자 수 절감을 성공 기준으로 쓰지 않는다).
// 상한을 넘어도 테스트를 실패시키지 않고 진단 경고만 남긴다. 금지·예외 문장을 삭제·축약해 상한에 맞추지 않는다.
test('대표 조회 도구 응답 크기는 기록된 측정값과 같고 상한 초과는 경고로만 알린다', async (t) => {
  const items = await measureAiResponseSizes(root)
  assert.deepEqual(budget.responseSizes.limits, AI_RESPONSE_SIZE_LIMITS)
  assert.deepEqual(items, budget.responseSizes.items, '측정값을 갱신하기 전에 바뀐 지침 문장이 사용자가 승인한 변경인지 확인하세요. 승인된 변경일 때만 node scripts/measure-ai-instructions.mjs --write로 측정값을 갱신하세요.')
  for (const warning of aiResponseSizeWarnings(items)) {
    t.diagnostic(`응답 크기 경고: ${warning} 금지·예외 문장을 삭제·축약해 맞추지 말고 중복 삽입 여부를 먼저 확인하세요.`)
  }
  assert.deepEqual(aiResponseSizeWarnings([{ name: 'read-me-first', chars: AI_RESPONSE_SIZE_LIMITS['read-me-first'] + 1 }]).length, 1)
  assert.deepEqual(aiResponseSizeWarnings([{ name: 'unknown-tool', chars: 1 }]).length, 1)
})
