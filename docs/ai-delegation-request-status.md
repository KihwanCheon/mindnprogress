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

실행이 `completed`이고 대상이 실제 업무 카드이면 조회 시 현재 카드에서 `taskCompletion`을 계산한다. 이 정보는 조회 응답에만 추가하며 저장된 위임 상태·결과·카드 본문·댓글·체크리스트·진행률을 변경하지 않는다.

- 카드가 `done/100%`: `taskCompletion.state=completed`. 품질·기록 검증을 대신하지 않는다.
- 그 외 업무 상태: `taskCompletion.state=incomplete`. 화면에 **AI 실행 종료 · 카드 업무 미완료**로 표시한다. 실행 실패·격리·복구 필요로 재분류하지 않는다.
- 비업무 카드나 현재 카드 상태가 없는 과거 실행에는 업무 미완료를 임의 추정하지 않는다.

카드와 세부 정보는 진행 중, 복구/보고 필요, 접수 실패, 실행 종료 후 업무 확인을 구분한다. 접수 실패 항목에는 실행·복구 버튼을 제공하지 않으며 상태 표시는 새 AI 실행을 요청하지 않는다.

## 변경 파일

- 서버: `server/index.mjs`, `server/lib/remoteWorkspacePool.mjs`, `server/lib/aiDelegationRequestFailures.mjs`.
- 화면: `src/App.tsx`, `src/components/AiDelegationRecovery.tsx`, `src/components/AiConversationRuntimeBadge.tsx`, `src/components/AiConversationRuntimeBadge.css`, `src/types/mindMap.ts`, `src/utils/aiDelegationManagement.d.mts`, `src/utils/aiDelegationStatus.mjs`, `src/utils/aiDelegationStatus.d.mts`, `src/utils/groupOverview.mjs`.
- 검증: `tests/sub-machine-routing-api.test.mjs`, `tests/remote-workspace-routing.test.mjs`, `tests/ai-delegation-request-failures.test.mjs`, `tests/ai-delegation-recovery-browser.test.mjs`.

브라우저 검사는 격리된 프로필과 Vite 캐시를 사용한다. 테스트 데이터·레지스트리와 실제 운영 문서·위임·worker는 분리한다. 코드 수정 승인을 실제 운영 위임 실행이나 서버 재시작 승인으로 확대하지 않는다.
