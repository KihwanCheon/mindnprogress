# 위임 요청 실패와 실행·업무 상태

## 작업공간 라우팅

- 일반 원격 작업공간은 원격 Fork 풀 lease를 발급하지 않고 해당 머신의 AionCore에서 실행한다. `new`와 `resume` 모두 동일하다.
- 인증된 보고, 등록 풀 또는 기존 lease에 귀속된 경로는 관리 대상이다. 미승인·보고 만료·기존 lease 불일치를 일반 실행으로 우회하지 않는다.
- 요청 머신과 관리 대상 머신이 다르면 거절한다. Mac 요청을 Windows 로컬 worker에 배정하지 않는다.
- 관리 대상 원격 풀 오류의 HTTP 상태와 `reasonCode`, `message`를 유지한다. 요청 진단에는 요청 ID·위임 키·문서·상위/대상 카드·머신·오류 코드를 남기며 토큰이나 지시 전문은 기록하지 않는다.

## 접수 실패 기록

검증 가능한 문서·상위/대상·요청 키가 있는 접수 실패는 실행 위임과 별개의 `_ai-delegation-request-failures.json`에 보존한다. 권한/범위나 요청 형식 자체를 확인할 수 없는 입력은 실행 이력으로 만들지 않는다.

`GET /api/maps/:mapId/ai-delegations`는 다음 두 배열을 반환한다.

- `delegations`: 기존 실행 기록. 복구·보고·poller의 대상은 이 배열의 기존 위임뿐이다.
- `requestFailures`: 별도의 요청 오류 이력. `kind=request-failure`, `state=request-failed`, 원 HTTP `status`, `reasonCode`, `message`, 요청 귀속과 시각을 제공한다.

실패 요청은 `accepted=false`, `automaticRetry=false`다. 실행 전 실패는 `executionState=not-started`, AionCore 전달 이후 접수 여부를 확증하지 못하면 `executionState=unknown`으로 구분한다. 알 수 없는 실행을 미실행으로 단정하거나 새 실행을 자동 요청하지 않는다.

같은 요청 서명·위임 키와 문서·상위/대상·머신의 실제 접수가 이후 확인되면 `resolvedByDelegationId`를 조회 응답에서 제공한다. 요청 서명은 내부에만 저장한다. 실패 원문은 보존하고 현재 실패 배지는 숨긴다. 서명이 없거나 다른 작업의 성공만 확인된 경우에는 실패 이력을 완료 처리하지 않는다.

기존 버전에서 저장하지 않은 과거 요청은 자동으로 재구성하거나 보충하지 않는다. 실패 이력 저장 자체가 실패하면 원 오류 응답을 유지하며 `requestFailureRecorded=false`로 알린다.

## 실행 종료와 카드 업무 완료

일반 하위 위임 복구 요청이 같은 대화의 `Conversation is busy` 오류로 거절되고 실행 턴이 없으면 실제 하위 업무 실패와 구분한다. 원 실행·결과·체크포인트와 lease를 보존하고 `recovery-required` 및 `AI_DELEGATION_RECOVERY_CONVERSATION_BUSY`로 명시적인 후속 복구를 기다린다. 자동 재실행·통합·상위 실패 보고를 하지 않는다. 전달 응답 유실 뒤 같은 요청을 조회하는 경로에도 같은 규칙을 적용한다. 통합 대기 결과 정정은 별도의 원 실행 완료·후보 보존 계약을 유지한다.

이전 버전이 이 거절을 하위 실패로 저장해 격리한 경우에는 같은 복구 operation·대화·lease·미실행 거절의 서버 기록을 다시 조회한 뒤 복구한다. 실행 턴이 있거나 다른 요청·소유권·완료·통합 흔적이면 예외를 적용하지 않는다. 원 세션·브랜치·HEAD·체크포인트·Git 작업 검사와 승인·최신 버전 검사는 유지한다. 접수 거절처럼 실행 턴이 없는 요청에는 대화의 최신 중간 답변을 결과로 캡처하지 않는다.

실행이 `completed`이고 대상이 실제 업무 카드이면 조회 시 현재 카드에서 `taskCompletion`을 계산한다. 이 정보는 조회 응답에만 추가하며 저장된 위임 상태·결과·카드 본문·댓글·체크리스트·진행률을 변경하지 않는다.

- 카드가 `done/100%`: `taskCompletion.state=completed`. 품질·기록 검증을 대신하지 않는다.
- 그 외 업무 상태: `taskCompletion.state=incomplete`. 현재 카드 전체 상태를 나타내는 참고 정보이며, 과거 위임의 승인 범위가 미완료이거나 기록이 누락됐다는 판정이 아니다. 실행 실패·격리·복구 필요로 재분류하지 않는다.
- 비업무 카드나 현재 카드 상태가 없는 과거 실행에는 업무 미완료를 임의 추정하지 않는다.

카드와 세부 정보는 진행 중, 복구/보고 필요, 접수 실패, 실행 종료 후 업무 확인을 구분한다. 접수 실패 항목에는 실행·복구 버튼을 제공하지 않으며 상태 표시는 새 AI 실행을 요청하지 않는다.

## 현재 현황과 완료 이력의 표시

화면과 카드 배지는 같은 표시 집계를 사용하며, API의 원본 위임 배열과 저장 상태는 변경하지 않는다.

- 진행 중·복구 필요·결과 전달 필요 항목은 개별 실행 단위로 유지한다. 최신 실행이 있다는 이유로 과거의 실제 복구·보고 필요 항목을 숨기지 않는다.
- 일반 완료 실행은 현재 현황에서 제외하고 **완료된 실행 이력**에 최신순으로 모은다. 처음에는 접혀 있으며, 펼쳤을 때만 이력 행을 렌더링한다. 이력 열람은 AI 실행·수신 확인·상태 변경을 요청하지 않는다.
- 동일 상위 문서·상위 카드·대상 문서·대상 카드의 최신 실행이 완료됐고 현재 카드 업무가 미완료이면 **카드 업무 미완료 · 확인 필요**를 카드당 1건만 표시한다. `task-attention`은 화면에서 만든 표시 사본이며 서버에 저장하거나 실행하지 않는다.
- 같은 대상에 진행·복구·결과 전달 상태가 남아 있으면 그 상태를 우선하고 카드 미완료 안내를 중복 표시하지 않는다. 접수 실패 요청은 기존 실행과 별개로 유지한다.
- 대표 실행은 갱신 시각이 아닌 위임 생성 시각으로 고른다. 최신 완료에 카드 상태가 없거나 후속 실행이 종료·대체·일반 실패 상태이면 과거 완료 기록으로 업무 미완료를 추정하지 않는다.
- 업무 확인 건수는 실행 횟수가 아닌 카드 수다. 단계별 완료 이력은 복구 건수·진행 건수에 포함하지 않는다. 카드 단위 안내에는 재개·보고·종료 버튼을 제공하지 않는다.
- 확인 사항이 모두 해소되면 기존 동작대로 현재 현황 영역과 카드 배지를 숨긴다. 원본 완료 이력은 조회 API에 그대로 남는다.

## 변경 파일

- 서버: `server/index.mjs`, `server/lib/remoteWorkspacePool.mjs`, `server/lib/aiDelegationRequestFailures.mjs`.
- 화면: `src/App.tsx`, `src/components/AiDelegationRecovery.tsx`, `src/components/AiConversationRuntimeBadge.tsx`, `src/components/AiConversationRuntimeBadge.css`, `src/types/mindMap.ts`, `src/utils/aiDelegationManagement.d.mts`, `src/utils/aiDelegationStatus.mjs`, `src/utils/aiDelegationStatus.d.mts`, `src/utils/groupOverview.mjs`.
- 검증: `tests/sub-machine-routing-api.test.mjs`, `tests/remote-workspace-routing.test.mjs`, `tests/ai-delegation-request-failures.test.mjs`, `tests/ai-delegation-display-history.test.mjs`, `tests/ai-delegation-recovery-browser.test.mjs`.

브라우저 검사는 격리된 프로필과 Vite 캐시를 사용하고 필요한 React 의존성만 사전 준비해 운영 앱·검증 빌드 HTML의 전체 탐색을 피한다. 테스트 데이터·레지스트리와 실제 운영 문서·위임·worker는 분리한다. 코드 수정 승인을 실제 운영 위임 실행이나 서버 재시작 승인으로 확대하지 않는다.
