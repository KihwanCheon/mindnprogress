import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  AI_EXECUTION_APPROVAL_INSTRUCTION,
  AI_DELEGATION_REVIEW_INSTRUCTION,
  AI_DELEGATION_RESULT_INSTRUCTION,
  DOCUMENT_COORDINATOR_INSTRUCTION,
  GROUP_APPROVAL_INSTRUCTION,
  GROUP_COORDINATOR_INSTRUCTION,
} from '../src/utils/aiApprovalInstructions.mjs'
import { SHARED_KNOWLEDGE_WRITE_INSTRUCTION } from '../src/utils/sharedKnowledgePolicy.mjs'
import { buildAiInstructionSnapshots, buildOrdinaryRecoverySnapshot, buildDocumentDelegationSnapshot, buildParentWakeSnapshot } from './helpers/aiInstructionSnapshots.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const budget = JSON.parse(await readFile(path.join(root, 'tests/fixtures/ai-instruction-budget.json'), 'utf8'))
const digest = (text) => createHash('sha256').update(text).digest('hex')
const count = (text, part) => text.split(part).length - 1

test('17개 실제 전달 전문은 복구한 조립 경로의 전문·해시와 일치한다', async () => {
  const snapshots = await buildAiInstructionSnapshots()
  assert.equal(snapshots.length, 17)
  assert.deepEqual(snapshots.map(({ name, text }) => ({ name, chars: text.length, sha256: digest(text) })), budget.snapshots)
  assert.equal(snapshots.reduce((sum, item) => sum + item.text.length, 0), budget.dynamicTotalChars)
  assert.equal(Math.max(...snapshots.map((item) => item.text.length)), budget.maxDynamicChars)

  const byName = Object.fromEntries(snapshots.map(({ name, text }) => [name, text]))
  assert.equal(byName.unselected, '')
  assert.match(snapshots[0].router, /read_me_first.*get_context.*guide.*nextStep/s)
  assert.match(byName['leaf-new'], /최초 `get_context` 응답과 이후 대상별 최신 조회 결과/)
  assert.match(byName['group-coordinator-new'], /# 사용자 승인과 실행 범위/)
  assert.match(byName['group-coordinator-new'], /# 그룹의 두 단계 사용자 승인/)
  assert.ok(byName['group-coordinator-new'].includes(GROUP_COORDINATOR_INSTRUCTION))
  assert.match(byName['group-proposal-only'], /문서별 사용자 승인 전에는 루트 수정, 지시 전달이나 AI 위임을 하지 마세요/)
  assert.ok(byName['document-coordinator-new'].includes(DOCUMENT_COORDINATOR_INSTRUCTION))
  assert.match(byName['document-delivery'], /완료 보고 라우팅.*현재 지시의 명시적 대체 대상.*자동 재개된 턴에서도/s)
  assert.match(byName['document-delivery'], /이 작업은 그룹 문서 최상위 카드의 분석·조정 업무/)
  // 이 포크는 하위 위임 전문을 config/ai-delegation-instruction.md 템플릿으로 조립하며 문맥 초기화 지침을 첫 문단으로 축약했다.
  assert.match(byName['worker-new-no-lease'], /가장 먼저 `mindnprogress_get_context`를 아래 값으로 한 번 성공 호출하세요.*응답을 받지 못한 시도는 횟수에 포함하지 않고.*성공 후에는 반복 호출하지 마세요/s)
  assert.equal(count(byName['worker-new-lease'], '# 할당된 작업공간'), 1)
  assert.equal(byName['worker-new-no-lease'], byName['worker-resume'])
  assert.match(byName['worker-resume'], /사용자 중지로 중단된 뒤 같은 대화에서 이어졌다면.*최종 답변 직전에만 `mindnprogress_complete_ai_delegation`을 호출.*중단 없이 진행된 최초 실행에는 호출하지 않습니다/s)
  assert.match(byName['parent-wake'], /하위 AI의 마지막 응답.*자동 기록합니다\(reportReceipt\.method=dispatch-delivered.*완료 결과가 보고 대기\(reportStatus=waiting 또는 failed, reportPending=true\)이면/s)
  for (const name of ['parent-wake', 'group-parent-wake']) {
    const prompt = byName[name]
    assert.match(prompt, /당신은 이 하위 작업을 위임한 상위 AI입니다/)
    assert.match(prompt, /상위 카드: 상위 카드 \(parent-card-fixture\)/)
    assert.equal(count(prompt, AI_DELEGATION_REVIEW_INSTRUCTION), 1)
    assert.ok(prompt.indexOf(AI_DELEGATION_REVIEW_INSTRUCTION) < prompt.indexOf('## 하위 AI의 마지막 응답'))
    assert.match(prompt, /## 상위 AI의 결과 처리.*목표 대비.*판정.*남은 필수 작업/s)
  }
  for (const name of ['worker-new-no-lease', 'worker-new-lease', 'worker-resume', 'user-stop-recovery', 'document-delivery']) {
    assert.equal(count(byName[name], AI_DELEGATION_RESULT_INSTRUCTION), 1)
    assert.doesNotMatch(byName[name], /당신은 이 하위 작업을 위임한 상위 AI입니다/)
  }
  assert.ok(byName['group-parent-wake'].includes(AI_EXECUTION_APPROVAL_INSTRUCTION))
  assert.ok(byName['group-parent-wake'].includes(GROUP_APPROVAL_INSTRUCTION))
  assert.equal([...byName['user-stop-recovery'].matchAll(/^# 할당된 작업공간$/gm)].length, 1)
  assert.match(byName['user-stop-recovery'], /복구 후 수행 지시/)
  assert.match(byName['user-stop-recovery'], /mindnprogress_complete_ai_delegation/)
  assert.match(byName.reconstruction, /재구성 제안만/)
  assert.match(byName.layout, /배치 제안/)
  assert.match(byName['dooray-proposal'], /파일·카드·Dooray를 수정하거나 댓글을 등록하지 마세요/)
  assert.match(byName['dooray-approval'], /가장 먼저 mindnprogress_get_dooray_response_approval/)

  const combined = snapshots.map(({ text }) => text).join('\n')
  assert.deepEqual({
    contextBootstrap: count(combined, '# 대화 문맥 초기화'),
    workspace: count(combined, '# 할당된 작업공간'),
    completion: count(combined, 'mindnprogress_complete_ai_delegation'),
  }, budget.repetitionCounts)
  assert.equal(count(combined, 'writePolicy:'), 0)
  assert.equal(count(combined, 'workflow:'), 0)
  assert.ok(count(combined, GROUP_COORDINATOR_INSTRUCTION) >= 1)
  assert.ok(count(buildOrdinaryRecoverySnapshot(), 'mindnprogress_complete_ai_delegation') >= 1)
})

test('기존 문서 담당 위임에도 결과 보고 지침을 한 번만 전달한다', () => {
  const prompt = buildDocumentDelegationSnapshot()
  assert.equal(count(prompt, AI_DELEGATION_RESULT_INSTRUCTION), 1)
  assert.doesNotMatch(prompt, /당신은 이 하위 작업을 위임한 상위 AI입니다/)
})

test('신규·재개·복구 위임에는 상위 대화, 결과 보고에는 하위 대화의 이동 정보를 붙인다', async () => {
  const snapshots = await buildAiInstructionSnapshots()
  for (const name of ['document-delivery', 'worker-new-no-lease', 'worker-new-lease', 'worker-resume', 'user-stop-recovery', 'parent-wake', 'group-parent-wake']) {
    const content = snapshots.find((item) => item.name === name).text
    const report = name.endsWith('parent-wake')
    assert.equal(content.split('\n')[0], '[[MNP_CONVERSATION_SOURCE]]', name)
    assert.deepEqual(JSON.parse(content.split('\n')[1]), {
      kind: report ? 'report' : 'delegation',
      conversationId: report ? 'conversation-child' : 'conversation-parent',
      name: report ? '하위 대화' : '상위 대화',
    }, name)
    assert.doesNotMatch(content, /reply_to:|session send-message/)
  }
})

test('신규·재개·복구 위임은 수행 보고와 조건부 지식 갱신을 구분해 전달한다', async () => {
  const snapshots = await buildAiInstructionSnapshots()
  for (const name of ['worker-new-no-lease', 'worker-new-lease', 'worker-resume', 'user-stop-recovery']) {
    const prompt = snapshots.find((item) => item.name === name).text
    assert.equal(count(prompt, SHARED_KNOWLEDGE_WRITE_INSTRUCTION), 1, name)
    assert.match(prompt, /실행 결과는 카드 댓글에 기록하세요/)
    assert.doesNotMatch(prompt, /실행 결과를 카드 댓글과 공유 지식에/)
    assert.match(prompt, /새 지식이 없으면 변경하지 마세요/)
    assert.match(prompt, /전체 재작성은 승인된 정리 범위.*원문 보존과 버전·해시/)
  }
})

test('원문 미캡처·무결성 오류에서도 목표 판단과 수신 확인 제약을 보존한다', async () => {
  for (const availability of ['unavailable', 'integrity-failed']) {
    const prompt = await buildParentWakeSnapshot({ parentMapId: 'parent-map', parentCardId: undefined }, {
      availability, text: '전달하면 안 되는 하위 결과',
    })
    assert.match(prompt, /상위 문서: parent-map/)
    assert.match(prompt, /상위 카드: 상위 카드 \(미확인\)/)
    assert.ok(prompt.indexOf(AI_DELEGATION_REVIEW_INSTRUCTION) < prompt.indexOf('## 하위 AI 원문'))
    assert.doesNotMatch(prompt, /전달하면 안 되는 하위 결과/)
    assert.match(prompt, /원문·해시가 없으면 임의 확인하지/)
  }
})
