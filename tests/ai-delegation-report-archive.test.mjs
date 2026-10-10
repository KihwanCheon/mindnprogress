import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { aiDelegationReportArchived, aiDelegationReportArchivePending, createAiDelegationReportArchiver } from '../server/lib/aiDelegationReportArchive.mjs'
import { RuntimeStoppingError } from '../server/lib/runtimeStopping.mjs'
import { MachineOperationError, MachineOperationQueue } from '../server/lib/machineOperations.mjs'

const hash = (value) => createHash('sha256').update(value).digest('hex')
const result = '완료 결과 원문\n마지막 줄까지 보존'
function fixture() {
  return { id: 'delegation-1', parentConversationId: 'parent', state: 'waiting-parent', childStatus: 'completed',
    childTurnId: 'child-turn', childResultTurnId: 'child-turn', childResultSnapshot: result, childResultHash: hash(result) }
}
function harness(initial = fixture()) {
  let stored = initial
  let time = Date.now()
  let supported = true
  let fail = false
  const messages = new Map()
  const requests = []
  const warnings = []
  const options = { update: async (_id, patch) => (stored = { ...stored, ...patch }),
    parentMachineId: () => 'parent-machine', capabilities: async () => ({ historyOnlyReports: supported }),
    instruction: (_d, captured) => `# 완료 전문\n${captured.text}`, now: () => time, warn: (...args) => warnings.push(args),
    fetchOn: async (machine, path, { method, body }) => {
      requests.push({ machine, path, method, body })
      assert.equal(stored.reportArchive.operationId, body.operationId, '네트워크 요청 전에 기록 의도를 저장한다.')
      if (!messages.has(body.operationId)) messages.set(body.operationId, body.content)
      assert.equal(messages.get(body.operationId), body.content)
      if (fail) throw new Error('응답 유실')
      return { operationId: body.operationId, conversationId: 'parent', messageId: `external-report-${hash(body.operationId)}`,
        contentHash: hash(body.content), executionRequested: false }
    } }
  return { options, get stored() { return stored }, messages, requests, warnings,
    advance: () => { time += 120_000 }, supported: (value) => { supported = value }, fail: (value) => { fail = value } }
}

test('종료로 응답 대기를 중단하면 기존 저장 의도를 보존하고 일반 실패 재시도를 기록하지 않는다', async () => {
  const h = harness()
  const archive = createAiDelegationReportArchiver({ ...h.options, fetchOn: async () => { throw new RuntimeStoppingError() } })
  await assert.rejects(archive(h.stored), RuntimeStoppingError)
  assert.equal(h.stored.state, 'waiting-parent')
  assert.equal(h.stored.reportArchive.status, 'pending')
  assert.equal(h.stored.reportArchive.attempt, 0)
  assert.equal(h.stored.reportArchive.errorCode, undefined)
  assert.equal(h.stored.reportArchive.nextAttemptAt, undefined)
  assert.equal(h.warnings.length, 0)
  await createAiDelegationReportArchiver(h.options)(h.stored)
  assert.equal(aiDelegationReportArchived(h.stored), true)
})

test('원문을 먼저 저장하고, 응답 유실·서버 재생성 후에도 같은 전문을 한 번만 보존한다', async () => {
  const h = harness()
  const archive = createAiDelegationReportArchiver(h.options)
  h.fail(true)
  await archive(h.stored)
  assert.equal(h.stored.state, 'waiting-parent')
  assert.equal(h.stored.reportArchive.status, 'pending')
  await archive(h.stored)
  assert.equal(h.requests.length, 1, '재시도 대기 중에는 다시 쓰지 않는다.')
  h.advance()
  h.fail(false)
  const restarted = createAiDelegationReportArchiver({ ...h.options, instruction: () => '배포 후 변경된 템플릿' })
  await restarted(h.stored)
  assert.equal(h.requests.length, 2)
  assert.equal(h.messages.size, 1)
  assert.match([...h.messages.values()][0], /마지막 줄까지 보존$/)
  assert.equal(aiDelegationReportArchived(h.stored), true)
  await restarted(h.stored)
  assert.equal(h.requests.length, 2)
  assert.equal(h.requests[0].machine, 'parent-machine')
  assert.equal(h.requests[0].path, '/api/conversations/parent/external-reports')
  assert.equal(h.requests[0].method, 'POST')
  assert.equal(JSON.stringify(h.warnings).includes(result), false, '로그에 원문을 남기지 않는다.')
})

test('구형 Core이면 AI 실행 없이 저장 대기를 보존하고, 업데이트 후 재시도한다', async () => {
  const h = harness()
  h.supported(false)
  const archive = createAiDelegationReportArchiver(h.options)
  await archive(h.stored)
  assert.equal(h.requests.length, 0)
  assert.equal(h.stored.reportArchive.errorCode, 'AIONCORE_HISTORY_REPORT_UNSUPPORTED')
  assert.equal(aiDelegationReportArchivePending(h.stored), true)
  h.advance()
  h.supported(true)
  await archive(h.stored)
  assert.equal(aiDelegationReportArchived(h.stored), true)
})

test('수신자 역할을 비동기로 확인한 전문도 문자열로 확정한 뒤 저장하고 재사용한다', async () => {
  const h = harness()
  const content = '# 그룹 총괄 승인 절차\n' + result
  const archive = createAiDelegationReportArchiver({ ...h.options, instruction: async () => content })
  await archive(h.stored)
  assert.equal(h.stored.reportArchive.content, content)
  assert.equal(h.stored.reportArchive.contentHash, hash(content))
  assert.equal(aiDelegationReportArchived(h.stored), true)
  await archive(h.stored)
  assert.equal(h.requests.length, 1)
})

test('과거 상위 수신 확인 완료 기록도 원문·턴·대화가 일치해야 자동 보충한다', async () => {
  const d = fixture()
  const legacy = { ...d, state: 'completed', reportReceipt: { method: 'parent-acknowledged', parentConversationId: 'parent',
    resultHash: d.childResultHash, childTurnId: d.childTurnId } }
  const h = harness(legacy)
  await createAiDelegationReportArchiver(h.options)(h.stored)
  assert.equal(h.stored.state, 'completed')
  assert.equal(h.messages.size, 1)
  for (const patch of [
    { childResultSnapshot: '변조 원문' }, { pendingRecovery: {} }, { state: 'closed' },
    { reportReceipt: { ...legacy.reportReceipt, method: 'dispatch-delivered' } },
    { reportReceipt: { ...legacy.reportReceipt, resultHash: hash('다른 결과') } },
  ]) assert.equal(aiDelegationReportArchivePending({ ...legacy, ...patch }), false)
})

test('잘못된 저장 응답은 성공으로 인정하지 않는다', async () => {
  for (const patch of [{ executionRequested: true }, { contentHash: hash('다른 전문') }, { conversationId: 'other' }, { messageId: '' }]) {
    const h = harness()
    const fetchOn = h.options.fetchOn
    const archive = createAiDelegationReportArchiver({ ...h.options, fetchOn: async (...args) => ({ ...await fetchOn(...args), ...patch }) })
    await archive(h.stored)
    assert.equal(aiDelegationReportArchived(h.stored), false)
    assert.equal(h.stored.reportArchive.errorCode, 'REPORT_ARCHIVE_RESPONSE_INVALID')
  }
})

test('Runner 미연결과 결과 시간 초과를 원인 코드·실패 단계·대상 머신으로 구분한다', async () => {
  for (const reasonCode of ['RUNNER_UNAVAILABLE', 'RESULT_TIMEOUT']) {
    const h = harness()
    const archive = createAiDelegationReportArchiver({ ...h.options, capabilities: async () => {
      throw new MachineOperationError('Runner 응답을 받지 못했습니다.', { reasonCode })
    } })
    await archive(h.stored)
    assert.equal(h.stored.reportArchive.errorCode, reasonCode)
    assert.equal(h.stored.reportArchive.errorReasonCode, reasonCode)
    assert.equal(h.stored.reportArchive.errorStage, 'capabilities')
    assert.equal(h.stored.reportArchive.errorMachineId, 'parent-machine')
    assert.equal(h.stored.reportArchive.errorMessage, 'Runner 응답을 받지 못했습니다.')
    assert.equal(h.requests.length, 0, '보고 저장 전 기능 조회 실패를 저장 실패와 구분한다.')
  }
})

test('Runner가 보고 요청을 거절하면 상한 대기 없이 상세 원인을 저장하고 복구 후 오류를 지운다', async () => {
  const h = harness()
  const queue = new MachineOperationQueue()
  const archive = createAiDelegationReportArchiver({ ...h.options, fetchOn: async (machineId, pathname, options) => {
    const queued = queue.enqueue(machineId, { pathname, ...options })
    const [claimed] = queue.claim(machineId)
    queue.settle(machineId, claimed.operationId, { ok: false, status: null,
      code: 'RUNNER_OPERATION_REJECTED', message: 'Runner operation is not allowed.' })
    return queued.completion
  } })
  await archive(h.stored)
  assert.equal(h.stored.reportArchive.errorCode, 'RUNNER_OPERATION_REJECTED')
  assert.equal(h.stored.reportArchive.errorReasonCode, 'REMOTE_REQUEST_FAILED')
  assert.equal(h.stored.reportArchive.errorStage, 'archive-request')
  assert.equal(h.stored.reportArchive.errorMessage, 'Runner operation is not allowed.')
  assert.deepEqual(queue.snapshot('parent-machine'), { pending: 0, dispatched: 0, waiting: 0 })
  const operationId = h.stored.reportArchive.operationId
  h.advance()
  await createAiDelegationReportArchiver(h.options)(h.stored)
  assert.equal(aiDelegationReportArchived(h.stored), true)
  assert.equal(h.stored.reportArchive.operationId, operationId)
  for (const field of ['errorCode', 'errorReasonCode', 'errorStage', 'errorMachineId', 'errorMessage', 'errorStatus']) {
    assert.equal(h.stored.reportArchive[field], null)
  }
})

test('HTTP 상태와 원격 오류 코드는 함께 보존하고 같은 오류의 반복 로그는 억제한다', async () => {
  for (const code of [null, 'REPORT_DISABLED']) {
    const h = harness()
    const archive = createAiDelegationReportArchiver({ ...h.options, fetchOn: async () => {
      throw new MachineOperationError('완료 보고 저장 API를 사용할 수 없습니다.',
        { status: 503, code, reasonCode: 'REMOTE_REQUEST_FAILED' })
    } })
    await archive(h.stored)
    assert.equal(h.stored.reportArchive.errorCode, code ?? 'HTTP_503')
    assert.equal(h.stored.reportArchive.errorStatus, 503)
    assert.equal(h.stored.reportArchive.errorReasonCode, 'REMOTE_REQUEST_FAILED')
    h.advance()
    await archive(h.stored)
    assert.equal(h.warnings.length, 1)
  }
})

test('같은 코드라도 실패 단계가 바뀌면 새 진단을 남긴다', async () => {
  const h = harness()
  const failure = async () => { throw new MachineOperationError('결과 시간 초과', { reasonCode: 'RESULT_TIMEOUT' }) }
  await createAiDelegationReportArchiver({ ...h.options, capabilities: failure })(h.stored)
  h.advance()
  await createAiDelegationReportArchiver({ ...h.options, fetchOn: failure })(h.stored)
  assert.equal(h.stored.reportArchive.errorStage, 'archive-request')
  assert.equal(h.warnings.length, 2)
})

test('진단에는 토큰과 완료 전문을 남기지 않고 오류 설명 길이를 제한한다', async () => {
  const h = harness()
  const archive = createAiDelegationReportArchiver({ ...h.options, fetchOn: async () => {
    throw new Error(`Bearer example-secret mnprn_example-secret mnpat_example-secret\n${h.stored.reportArchive.content}\n${'x'.repeat(2000)}`)
  } })
  await archive(h.stored)
  const diagnostics = JSON.stringify({ message: h.stored.reportArchive.errorMessage, warnings: h.warnings })
  assert.doesNotMatch(diagnostics, /example-secret|완료 결과 원문|마지막 줄까지 보존/)
  assert.ok(h.stored.reportArchive.errorMessage.length <= 1000)
  assert.equal(h.stored.reportArchive.errorCode, 'REPORT_ARCHIVE_UNAVAILABLE')
})

test('캡처 결과가 바뀌면 이전 메시지의 저장 완료를 재사용하지 않는다', async () => {
  const h = harness()
  await createAiDelegationReportArchiver(h.options)(h.stored)
  assert.equal(aiDelegationReportArchived({ ...h.stored, childTurnId: 'new-turn' }), false)
  assert.equal(aiDelegationReportArchived({ ...h.stored, reportArchive: { ...h.stored.reportArchive, content: '변조 전문' } }), false)
})
