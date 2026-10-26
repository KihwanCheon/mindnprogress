# 위임 대화의 컨텍스트 기준 재사용 정책

## 현재 상태: 임시 OFF

`server/lib/aiConversationContextHealth.mjs`의 공통 스위치
`AI_CONVERSATION_CONTEXT_REUSE_GUARD_ENABLED`는 현재 `false`다.

- 컨텍스트 크기·사용률·실행 턴 수·연속 재사용 횟수·통계 미확인만으로 기존 대화 이어가기를 차단하거나 새 대화를 권장하지 않는다.
- 사용량, 턴 통계, `state`, `reasonCodes`는 참고용으로 계속 수집한다. 따라서 `state=saturated`나 `state=unknown`도 컨텍스트 정책이 OFF이면 `recommendation=resume`, `resumeAllowed=true`일 수 있다.
- `contextHealth.contextReuseGuardEnabled`로 실제 스위치 상태를 확인한다. 상태 이름만으로 새 대화를 선택하지 않는다.
- 서버의 일반 위임·그룹 문서 지시·대기 중 위임 검사와 MCP의 후보 선택 안내는 같은 스위치를 사용한다.
- 금지 모델, 실행 중인 대화의 중복 실행 금지, 대화·카드 접근 권한, 실행 환경·역할·작업공간 호환성 검사는 그대로 유지한다. 모델 정책이 차단한 대화는 OFF여도 `resumeAllowed=false`다.
- 이어가기의 최신 `assessmentId` 확인과 기존 중단 위임의 복구 절차도 유지한다. OFF는 이미 실행 중인 위임을 취소하거나 새로운 대화를 자동 실행하는 설정이 아니다.

## 다시 ON으로 변경

공통 스위치 하나를 `true`로 되돌린다. 기존 판정 로직과 임계값은 삭제하지 않았으므로 서버 검사와 MCP 선택 안내를 함께 복원할 수 있다.

- 실제 전체 컨텍스트 크기를 확인한 사용률이 65% 이상이면 주의, 80% 이상이면 포화로 판정한다.
- 사용률을 확인하지 못하면 실행 턴 수와 연속 재사용 횟수는 참고 신호로만 사용하며 포화를 확정하지 않는다.
- ON이면 포화 또는 이력 미확인 대화의 일반 이어가기를 차단한다. 주의 대화는 제한적인 후속 작업에서 최신 평가를 확인해 이어갈 수 있다.
- 스위치 상태도 평가 ID에 포함하므로 전환 전 평가를 재사용하지 않고 후보를 다시 조회한다.

변경 적용에는 MnP 서버 재시작과 MCP 서버 재연결이 필요하다. AionCore 코드 변경·재빌드는 필요 없다. 기존 대화와 결과 이력은 보존한다.

## 검증

- `tests/ai-conversation-context-health.test.mjs`: 기본 OFF, 큰 사용량·긴 대화·통계 미확인, ON 복원, 금지 모델 유지.
- `tests/ai-conversation-selection-policy.test.mjs`: 초기 안내와 후보 선택 규칙의 OFF/ON 일치, 역할·작업공간·중복 실행 조건 유지.
- `tests/sub-machine-routing-api.test.mjs`: 95% 사용률인 서브 머신 대화를 신규 생성 없이 실제 이어가기 요청으로 전달.
- 기존 그룹 위임 및 MCP 통합 테스트로 연결 평가·도구 안내의 호환성을 확인한다.
