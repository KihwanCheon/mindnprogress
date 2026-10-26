import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import {
  AI_DELEGATION_RESULT_FULL_LIMIT,
  AI_DELEGATION_RESULT_HASH_BASIS,
  AI_DELEGATION_RESULT_INLINE_LIMIT,
  aiDelegationFullResult,
  buildAiDelegationResultCapture,
} from '../server/lib/aiDelegationResultCapture.mjs'
import { aiDelegationReportResult } from '../server/lib/aiDelegations.mjs'
import { acknowledgeAiDelegationReport } from '../server/lib/aiDelegationReports.mjs'
import { AI_DELEGATION_REPORT_INSTRUCTION } from '../src/utils/aiApprovalInstructions.mjs'
import { buildParentWakeSnapshot } from './helpers/aiInstructionSnapshots.mjs'

const hash = (value) => createHash('sha256').update(value).digest('hex')
const request = { id: 'm-request', position: 'right', type: 'text', content: { content: '작업 요청' } }
const left = (id, text, type = 'text') => ({ id, position: 'left', type, content: { content: text } })
const tool = (id) => ({ id, position: 'left', type: 'tool_call', content: { name: 'tool' } })

function delegationFrom(capture) {
  return {
    id: 'delegation-a', parentConversationId: 'parent', state: 'waiting-parent',
    childStatus: 'completed', childTurnId: 'turn-a', childResultTurnId: 'turn-a',
    workspaceResult: { status: 'completed' },
    childResultSnapshot: capture.snapshot, childResultHash: capture.snapshotHash,
    childResultCapture: capture.capture, childResultFull: capture.full,
  }
}

test('12,000자 이하 결과는 기존과 같은 원문·해시를 저장하고 절단 메타데이터를 false로 기록한다', () => {
  const capture = buildAiDelegationResultCapture([request, left('m-1', '  완료 보고입니다.  ')])
  assert.equal(capture.snapshot, '완료 보고입니다.')
  assert.equal(capture.snapshotHash, hash('완료 보고입니다.'))
  assert.equal(capture.full, null)
  assert.deepEqual({
    hashBasis: capture.capture.hashBasis, messageId: capture.capture.messageId, messageType: capture.capture.messageType,
    originalLength: capture.capture.originalLength, truncated: capture.capture.truncated, splitSuspected: capture.capture.splitSuspected,
  }, { hashBasis: AI_DELEGATION_RESULT_HASH_BASIS, messageId: 'm-1', messageType: 'text', originalLength: 9, truncated: false, splitSuspected: false })
  assert.equal(buildAiDelegationResultCapture([request, tool('t-1')]), null)
})

test('12,000자를 넘는 위임 결과는 본문 끝에 절단을 표시하고 전체 원문을 별도 보관한다', () => {
  const original = `${'가'.repeat(AI_DELEGATION_RESULT_INLINE_LIMIT)}뒷부분 요구사항 R-99 상태`
  const capture = buildAiDelegationResultCapture([request, left('m-1', original)])
  assert.ok(capture.snapshot.startsWith('가'.repeat(AI_DELEGATION_RESULT_INLINE_LIMIT)))
  assert.ok(!capture.snapshot.includes('R-99'))
  const marker = capture.snapshot.slice(AI_DELEGATION_RESULT_INLINE_LIMIT)
  assert.ok(marker.startsWith(`\n\n[MindNProgress 결과 절단] 원문 ${original.length.toLocaleString('en-US')}자 중 앞 12,000자만`), marker)
  assert.match(marker, /includeFullResult=true.*resultFull/s)
  assert.equal(capture.snapshotHash, hash(capture.snapshot), '해시는 절단 표시를 포함한 저장 문자열 기준')
  assert.equal(capture.capture.truncated, true)
  assert.equal(capture.capture.originalLength, original.length)
  assert.equal(capture.capture.fullTextStored, true)
  assert.equal(capture.full.text, original)
  assert.equal(capture.full.hash, hash(original))

  const delegation = delegationFrom(capture)
  const result = aiDelegationReportResult(delegation)
  assert.equal(result.availability, 'captured')
  assert.equal(result.hash, capture.snapshotHash)
  assert.equal(result.capture.truncated, true)
  assert.deepEqual(aiDelegationFullResult(delegation), { text: original, hash: hash(original), length: original.length, truncated: false })
  const patch = acknowledgeAiDelegationReport(delegation, { conversationId: 'parent', resultHash: result.hash }, '2026-10-21T00:00:00.000Z')
  assert.equal(patch.state, 'completed')
  assert.equal(patch.reportReceipt.resultHash, capture.snapshotHash)
  assert.throws(() => acknowledgeAiDelegationReport(delegation, { conversationId: 'parent', resultHash: capture.full.hash }), /해시/)
})

test('보관 상한을 넘거나 그룹 지시 응답이면 대화 전문 조회 경로를 표시한다', () => {
  const huge = buildAiDelegationResultCapture([request, left('m-1', '나'.repeat(AI_DELEGATION_RESULT_FULL_LIMIT + 5))])
  assert.equal(huge.full.length, AI_DELEGATION_RESULT_FULL_LIMIT)
  assert.equal(huge.full.truncated, true)
  assert.match(huge.snapshot.slice(AI_DELEGATION_RESULT_INLINE_LIMIT), /보관 원문도 앞 100,000자까지만.*mindnprogress_get_ai_conversation_transcript/s)
  const instruction = buildAiDelegationResultCapture([request, left('m-1', '다'.repeat(AI_DELEGATION_RESULT_INLINE_LIMIT + 1))], { fullPath: 'transcript' })
  assert.equal(instruction.full, null)
  assert.equal(instruction.capture.fullTextStored, false)
  assert.match(instruction.snapshot.slice(AI_DELEGATION_RESULT_INLINE_LIMIT), /대상 대화 전문\(mindnprogress_get_ai_conversation_transcript\)/)
  assert.ok(!instruction.snapshot.includes('includeFullResult'))
})

test('같은 턴의 앞선 긴 텍스트와 tips 캡처를 메타데이터로 드러낸다', () => {
  const split = buildAiDelegationResultCapture([
    left('old', '이전 턴의 아주 긴 응답'.repeat(20)), request,
    left('m-1', '상세 보고 본문'.repeat(10)), tool('t-1'), left('m-2', '완료했습니다.'),
  ])
  assert.equal(split.snapshot, '완료했습니다.')
  assert.equal(split.capture.messageId, 'm-2')
  assert.equal(split.capture.turnTextMessageCount, 2, '직전 사용자 요청 이전 메시지는 세지 않는다')
  assert.equal(split.capture.splitSuspected, true)
  const tips = buildAiDelegationResultCapture([request, left('m-1', '짧은 안내'), left('m-2', '시스템 안내 메시지', 'tips')])
  assert.equal(tips.capture.messageType, 'tips')
})

test('저장 원문이 바뀌면 이전 캡처 메타데이터와 보관 원문을 신뢰하지 않는다', () => {
  const capture = buildAiDelegationResultCapture([request, left('m-1', '라'.repeat(AI_DELEGATION_RESULT_INLINE_LIMIT + 10))])
  const stale = { ...delegationFrom(capture), childResultSnapshot: '새 결과', childResultHash: hash('새 결과') }
  assert.equal(aiDelegationReportResult(stale).capture, undefined)
  assert.equal(aiDelegationFullResult(stale), null)
  assert.equal(aiDelegationFullResult({ ...delegationFrom(capture), childResultFull: { ...capture.full, text: '변조' } }), null)
})

test('상위 재개 전문은 절단·분할 가능성·tips를 명시하고 자동 수신 기록과 해시 기준을 안내한다', async () => {
  const capture = buildAiDelegationResultCapture([request, left('m-1', '마'.repeat(AI_DELEGATION_RESULT_INLINE_LIMIT + 1))])
  const prompt = await buildParentWakeSnapshot({}, { availability: 'captured', text: capture.snapshot, capture: { ...capture.capture, splitSuspected: true, messageType: 'tips' } })
  assert.match(prompt, /- 결과 원문: 캡처됨 \(12,000자 초과로 절단됨, 아래 결과 절단 안내 참조\)/)
  assert.match(prompt, /> 결과 절단: 원문 12,001자 중 앞 12,000자만.*resultFull로 확인하세요.*결과 전체를 검토한 것으로 판단하지 마세요/s)
  assert.match(prompt, /> 결과 분할 가능성\(추정\)/)
  assert.match(prompt, /tips 유형/)
  assert.ok(prompt.includes(AI_DELEGATION_REPORT_INSTRUCTION))
  assert.match(AI_DELEGATION_REPORT_INSTRUCTION, /dispatch-delivered, state=completed, reportStatus=received.*다시 호출하지 않아도 됩니다.*보고 대기\(reportStatus=waiting 또는 failed, reportPending=true\).*resultHashBasis=stored-snapshot.*품질 검수나 사용자 승인이 아닙니다/s)

  const plain = await buildParentWakeSnapshot({}, { availability: 'captured', text: '짧은 결과' })
  assert.match(plain, /- 결과 원문: 캡처됨\n/)
  assert.doesNotMatch(plain, /결과 절단|결과 분할 가능성/)
})
