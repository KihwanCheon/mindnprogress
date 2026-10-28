import assert from 'node:assert/strict'
import test from 'node:test'
import { aionUiWebProbeSummary } from '../src/utils/aionUiWebProbeSummary.mjs'

const base = { configuredUrl: 'http://10.0.0.5:7777', configuredPort: 7777, configuredFromEnv: false, loopbackRespondingPorts: null, suggestedConfigUrl: null }

test('결과가 없으면 요약하지 않는다', () => {
  assert.equal(aionUiWebProbeSummary(undefined, { isMainMachine: true }), null)
})

test('설정 포트가 응답하면 ok 한 줄만 보여 준다', () => {
  const summary = aionUiWebProbeSummary({ ...base, status: 'ok', respondingPorts: [7777] }, { isMainMachine: true })
  assert.equal(summary.tone, 'ok')
  assert.equal(summary.text, 'WebUI 7777 포트 응답 (dev)')
  assert.equal(summary.hint, null)
})

test('포트가 달라도 대화는 응답 포트로 자동으로 열리므로 정상으로 표시하고 고정 방법만 안내한다', () => {
  const summary = aionUiWebProbeSummary({
    ...base, status: 'port-mismatch', respondingPorts: [25808], suggestedConfigUrl: 'http://10.0.0.5:25808',
  }, { isMainMachine: true })
  assert.equal(summary.tone, 'ok')
  assert.equal(summary.text, 'WebUI 설정 포트 7777 응답 없음 · 25808 포트 자동 사용 (release)')
  assert.match(summary.hint, /AI 대화 열기는 25808 포트로 자동으로 엽니다/)
  assert.match(summary.hint, /포트를 고정하려면 MNP_AIONUI_WEB_URL을 http:\/\/10\.0\.0\.5:25808로 지정한 뒤 MnP를 재시작/)
  assert.match(summary.hint, /지금은 MNP_AIONUI_WEB_URL이 비어 있어 기본 7777 포트를 씁니다/)
})

test('서브 머신은 머신마다 응답 포트를 따로 쓰므로 고정 안내를 하지 않는다', () => {
  const summary = aionUiWebProbeSummary({
    ...base, configuredFromEnv: true, configuredUrl: 'http://192.0.2.23:7777',
    status: 'port-mismatch', respondingPorts: [25808], suggestedConfigUrl: 'http://10.0.0.5:25808',
  }, { isMainMachine: false })
  assert.equal(summary.tone, 'ok')
  assert.equal(summary.hint, '이 머신의 AI 대화 열기는 25808 포트로 자동으로 엽니다.')
})

test('loopback에서만 응답하면 원격 접속 허용만 안내한다', () => {
  const summary = aionUiWebProbeSummary({
    ...base, status: 'remote-access-disabled', respondingPorts: [], loopbackRespondingPorts: [25808], suggestedConfigUrl: 'http://10.0.0.5:25808',
  }, { isMainMachine: true })
  assert.equal(summary.tone, 'fail')
  assert.equal(summary.text, 'WebUI 원격 접속 꺼짐 · 이 PC의 25808 포트에서만 응답 (release)')
  assert.equal(summary.hint, 'AionUi 설정의 WebUI에서 원격 접속 허용을 켜세요. 켜면 AI 대화 열기가 응답 포트를 자동으로 찾습니다.')
})

test('어느 포트도 응답하지 않으면 확인한 포트와 WebUI 켜기를 안내한다', () => {
  const summary = aionUiWebProbeSummary({ ...base, status: 'unreachable', respondingPorts: [] }, { isMainMachine: false })
  assert.equal(summary.text, 'WebUI 응답 없음 · 7777, 25808, 25810 포트 확인')
  assert.match(summary.hint, /WebUI를 켜고 원격 접속 허용/)
})

test('주소를 모르거나 확인 자체가 실패하면 서버 메시지를 그대로 보여 준다', () => {
  const unknown = aionUiWebProbeSummary({ status: 'address-unknown', error: 'Runner 연결을 확인하세요.' }, { isMainMachine: false })
  assert.equal(unknown.text, 'WebUI 주소 확인 불가')
  assert.equal(unknown.hint, 'Runner 연결을 확인하세요.')
  const failed = aionUiWebProbeSummary({ status: 'error', error: '확인 실패' }, { isMainMachine: true })
  assert.equal(failed.text, 'WebUI 포트 확인 실패')
  assert.equal(failed.hint, '확인 실패')
})
