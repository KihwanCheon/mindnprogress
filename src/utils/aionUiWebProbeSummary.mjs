// 서버 server/lib/aionUiWebPortProbe.mjs 의 AIONUI_WEB_KNOWN_PORTS 와 같은 순서·값을 유지한다.
const KNOWN_PORT_MODES = [[7777, 'dev'], [25808, 'release'], [25810, 'dev 다중 실행']]
const PORT_MODE_LABELS = new Map(KNOWN_PORT_MODES)

function modeSuffix(ports) {
  const modes = ports.map((port) => PORT_MODE_LABELS.get(port)).filter(Boolean)
  return modes.length > 0 ? ` (${modes.join(', ')})` : ''
}

// 서버는 'AI 대화 열기' 링크를 만들 때 머신별 응답 포트를 자동으로 고른다.
// 메인 머신만 설정값으로 포트를 고정하는 방법을 함께 안내한다.
function mismatchHint(webUi, isMainMachine) {
  const port = webUi.respondingPorts[0]
  if (!isMainMachine) return `이 머신의 AI 대화 열기는 ${port} 포트로 자동으로 엽니다.`
  const current = webUi.configuredFromEnv ? '' : ` 지금은 MNP_AIONUI_WEB_URL이 비어 있어 기본 ${webUi.configuredPort} 포트를 씁니다.`
  const pin = webUi.suggestedConfigUrl
    ? ` 포트를 고정하려면 MNP_AIONUI_WEB_URL을 ${webUi.suggestedConfigUrl}로 지정한 뒤 MnP를 재시작하세요.${current}`
    : ''
  return `AI 대화 열기는 ${port} 포트로 자동으로 엽니다.${pin}`
}

/** 머신 연결 확인 응답의 webUi 결과를 분산 작업 설정 화면의 한 줄 요약과 조치 안내로 바꾼다. */
export function aionUiWebProbeSummary(webUi, { isMainMachine }) {
  if (!webUi) return null
  switch (webUi.status) {
    case 'ok':
      return { tone: 'ok', text: `WebUI ${webUi.configuredPort} 포트 응답${modeSuffix([webUi.configuredPort])}`, hint: null }
    case 'port-mismatch':
      return {
        tone: 'ok',
        text: `WebUI 설정 포트 ${webUi.configuredPort} 응답 없음 · ${webUi.respondingPorts[0]} 포트 자동 사용${modeSuffix([webUi.respondingPorts[0]])}`,
        hint: mismatchHint(webUi, isMainMachine),
      }
    case 'remote-access-disabled':
      return {
        tone: 'fail',
        text: `WebUI 원격 접속 꺼짐 · 이 PC의 ${webUi.loopbackRespondingPorts.join(', ')} 포트에서만 응답${modeSuffix(webUi.loopbackRespondingPorts)}`,
        hint: 'AionUi 설정의 WebUI에서 원격 접속 허용을 켜세요. 켜면 AI 대화 열기가 응답 포트를 자동으로 찾습니다.',
      }
    case 'unreachable': {
      const checked = [webUi.configuredPort, ...KNOWN_PORT_MODES.map(([port]) => port).filter((port) => port !== webUi.configuredPort)]
      return {
        tone: 'fail',
        text: `WebUI 응답 없음 · ${checked.join(', ')} 포트 확인`,
        hint: 'AionUi가 실행 중인지 확인하고, AionUi 설정에서 WebUI를 켜고 원격 접속 허용도 켜세요.',
      }
    }
    case 'address-unknown':
      return { tone: 'fail', text: 'WebUI 주소 확인 불가', hint: webUi.error ?? null }
    default:
      return { tone: 'fail', text: 'WebUI 포트 확인 실패', hint: webUi.error ?? null }
  }
}
