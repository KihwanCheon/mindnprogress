import assert from 'node:assert/strict'
import test from 'node:test'
import { integrationRecoveryUnconfirmed, reconcileIntegrationRecoveryRequests, submitIntegrationRecovery } from '../src/utils/aiIntegrationRecovery.mjs'

const item = id => ({ id, mapId: 'child', parentMapId: 'parent' })
const body = { expectedUpdatedAt: 'old', sourceRevision: 1, targetRevision: 2, confirmApprovedScope: true, instruction: '기존 통합만 요청' }
test('응답 유실 시 POST를 반복하지 않고 같은 요청 ID의 저장 receipt만 조회한다', async () => {
  const target = item('lost-response'), calls = []; let requestId
  const result = await submitIntegrationRecovery(target, body, async (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET' })
    if (init?.method === 'POST') { requestId = JSON.parse(init.body).recoveryRequestId; throw new DOMException('timed out', 'TimeoutError') }
    return { delegations: [{ ...target, integrationRecoveryRequest: { requestId, status: 'checking', message: '검증 중' } }] }
  })
  assert.equal(result.message, '검증 중')
  assert.equal(calls.filter(c => c.method === 'POST').length, 1)
  assert.equal(calls[1].url, '/api/maps/parent/ai-delegations')
  assert.equal(integrationRecoveryUnconfirmed(target), false)
})

test('접수 미확인은 자료를 보존하고 명시적 재확인도 같은 ID·본문만 전달한다', async () => {
  const target = item('unconfirmed'), sent = []
  const request = async (_url, init) => {
    if (init?.method === 'POST') { sent.push(JSON.parse(init.body)); throw new Error('network unavailable') }
    return { delegations: [] }
  }
  assert.equal((await submitIntegrationRecovery(target, body, request)).unconfirmed, true)
  assert.equal(integrationRecoveryUnconfirmed(target), true)
  await submitIntegrationRecovery(target, { ...body, sourceRevision: 99 }, request)
  assert.deepEqual(sent[0], sent[1])
  reconcileIntegrationRecoveryRequests([{ ...target, integrationRecoveryRequest: { requestId: sent[0].recoveryRequestId, status: 'failed' } }])
  assert.equal(integrationRecoveryUnconfirmed(target), false)
})

test('확정된 HTTP 거절은 접수 미확인으로 바꾸거나 자동 재요청하지 않는다', async () => {
  const target = item('rejected'), calls = []
  await assert.rejects(submitIntegrationRecovery(target, body, async (_url, init) => {
    calls.push(init.method); throw Object.assign(new Error('범위 변경'), { status: 409 })
  }), /범위 변경/)
  assert.deepEqual(calls, ['POST']); assert.equal(integrationRecoveryUnconfirmed(target), false)
})
