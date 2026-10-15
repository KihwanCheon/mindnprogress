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

문서 버전 충돌이나 실행 중 차단 뒤의 재접수는 키·서명이 달라질 수 있다. 새 실패에는 지시 전문의 SHA-256과 실제 상위 대화, 요청한 대상 대화를 내부 비교 근거로 보존한다. `preflight/not-started`이며 버전 충돌·이미 진행 중·대화 사용 중 오류에서 지시 해시·상위 대화·전략·문서·상위/대상·머신·알려진 대상 대화가 같은 후속 접수가 있으면 키·버전 변경과 관계없이 표시를 해제한다. 제목이나 문장 유사도로 같은 업무를 추정하지 않는다. 지시 전문과 해시는 실패 조회 응답에 노출하지 않는다. 근거 없는 레거시 요청이나 실행 불확실 요청은 새 키의 접수만으로 자동 해제하지 않는다.

### 재접수 참조와 사용자 표시

- 미실행이 확인되고 지시 해시가 있는 실패 응답과 조회에는 `requestFailure.retryReference.requestId`를 제공한다. MCP는 오류의 `requestFailure`를 버리지 않고 AI에게 전달한다. 같은 업무 재접수는 이 값을 `retryOfRequestId`에 넣고 원 `instruction`을 그대로 유지한다. 버전·요청 키 등 메타데이터만 갱신하며, 다른 업무에는 참조를 사용하지 않는다. 내용을 변경해야 하는 경우에는 기존 실패와 자동으로 같은 업무로 취급하지 않는다.
- 서버는 실행 전에 원 요청의 귀속·미실행·지시 해시를 검증하고 승인된 참조를 접수 위임에 저장한다. 다른 카드·대화·머신·지시는 `AI_DELEGATION_RETRY_REFERENCE_INVALID`로 거부한다. 이미 같은 실패가 재접수됐으면 기존 실행을 반환하고 다시 실행하지 않는다. 연속 재접수 실패의 검증된 참조 체인도 이어서 확인한다. 재시작 후에도 저장된 참조와 접수 기록으로 판정한다.
- `taskSummary`는 선택적인 사용자 공개용 업무 요약(240자 이하)이다. 실패 기록에는 이 요약만 보존하고 지시 전문에서 본문을 자동 복제하지 않는다. 요약이 없는 과거·신규 기록은 없다고 표시한다. 인증 정보는 요약에 넣지 않는다.
- 목록의 `retryVerification`은 `confirmed`, `not-found`, `unverified`, `execution-unknown`을 구분하고 근거 종류와 확인된 후속 접수의 요약·시각·현재 상태를 제공한다. 접수 확인은 실행·통합·업무 완료 판정이 아니다. 후속 실행 자체의 실패·복구 경고는 그대로 유지한다.
- 화면에서 **정상 재접수로 해제**와 ID 후보 선택을 제거한다. **재접수 확인**은 `POST /api/maps/:parentMapId/ai-delegation-request-failures/:requestId/recheck`에 `expectedUpdatedAt`만 전달한다. 서버가 현재 근거를 검사해 확인된 연결만 `resolution` 감사 기록으로 보존한다. 근거가 없으면 이유를 안내하며 해제·재실행하지 않는다. 편집 권한·카드 존재·최신 상태 검증은 유지한다.
- 사용자는 카드 제목·공개용 요약·실패 시각·사유·판정으로 상태를 확인한다. ID는 접힌 **기술 정보**에만 표시한다. 해제된 실패는 접힌 **처리된 요청 이력**에 남고 현재 카드 경고에서 제외한다. 대상 카드와 연결된 대화를 열 수 있으며, 대화 열기는 기존 카드 귀속·서브 머신 권한 검증 API를 사용한다. 이력 열람과 재접수 확인은 AI를 실행하거나 카드·진행률을 변경하지 않는다.

지시 표현까지 달라진 레거시 기록은 자동 판정하지 않는다. 담당자가 사용자 승인 아래 실제 원 요청과 후속 요청의 증거를 검토한 경우에만 기존 `/resolve` 유지보수 경로를 사용한다. `expectedUpdatedAt`, `replacementDelegationId`, `confirmSameWork=true`, 근거가 담긴 `note`가 필요하며, 서버는 미실행·후속 실제 접수·문서/카드/머신/시각을 검증한다. 원 오류를 유지한 채 감사 기록만 남기며 다른 연결·오래된 상태·실행 불확실 요청은 거절한다. 일반 화면에서는 이 판단을 사용자에게 요구하지 않는다.

기존 버전에서 저장하지 않은 과거 요청은 자동으로 재구성하거나 보충하지 않는다. 실패 이력 저장 자체가 실패하면 원 오류 응답을 유지하며 `requestFailureRecorded=false`로 알린다.

### 미접수 요청의 사용자 종료

더 이상 진행하지 않을 요청은 정상 재접수로 꾸미지 않고 **취소·진행 불필요로 종료**한다. 편집자가 사유(`cancelled` 또는 `no-longer-needed`)와 3~1000자의 메모를 입력한 뒤 **미접수 요청 종료 확정**을 누른다. 입력 창 열기나 취소만으로 저장하지 않는다.

`POST /api/maps/:parentMapId/ai-delegation-request-failures/:requestId/close`는 `expectedUpdatedAt`, `reason`, `note`, `confirmNotExecuted=true`를 받는다. 서버는 편집 권한·카드 존재·최신 상태를 확인하고 `preflight`, `not-started`, `accepted=false`인 요청만 종료한다. 실행 불확실 요청은 `409 AI_DELEGATION_REQUEST_FAILURE_EXECUTION_UNCERTAIN`, 정상 재접수가 이미 확인된 요청은 `409 AI_DELEGATION_REQUEST_FAILURE_ALREADY_RESOLVED`로 거부한다.

종료는 원 상태·오류를 보존하고 별도 `requestClosure={reason,note,at,actorId}`만 기록한다. 응답은 `AI_DELEGATION_REQUEST_FAILURE_CLOSED`, `executionRequested=false`, `cardChanged=false`, `retryVerification.state=closed`이며, `resolvedByDelegationId`나 가짜 성공 위임을 만들지 않는다. 같은 사유·메모의 반복 요청은 멱등이고 기존 감사 기록을 덮어쓰지 않는다. 종료한 요청의 재접수 참조나 수동 재접수 연결은 거절하고 조회·재확인·재시작으로 종료를 되돌리지 않는다.

종료한 실패는 카드 배지와 현재 확인 목록에서 제외하고 **처리된 요청 이력**에 **사용자 종료 · 미실행**, 종료 시각·사유·메모와 원 오류를 표시한다. 업무 완료·후속 실행 중지·통합·작업공간 반환·결과 수신으로 취급하지 않는다. 대화 삭제나 시간이 지났다는 이유만으로 자동 종료하지 않는다.

## 실행 종료와 카드 업무 완료

통합 재시도는 HTTP 202와 `integrationRecoveryRequest.requestId/status/message/reasonCode`를 먼저 저장·반환한다. `queued`·`checking`은 검증 접수/진행이며 통합 성공이 아니다. UI는 클릭 항목에 진행·오류를 표시한다. 긴 Git 검증은 HTTP와 일반 위임 폴링 밖에서 실행하며 실패해도 원 위임 결과·체크포인트를 보존한다. 승인된 미완료 요청은 재시작 후 같은 ID·lease로 다시 대사한다. 응답 유실 시 자동 재POST하지 않고 조회하며, 접수 미확인이 계속되면 사용자가 **동일 요청 재확인**으로 같은 ID·본문만 전달할 수 있다. 확정된 실패의 원인 해소 뒤 새 승인 요청에는 새 `recoveryRequestId`를 쓴다. 실행·결과·카드·권한·기준 변경과 사용자 파일은 기존 안전 검증으로 차단한다.

실행 턴 없이 정확한 `cannot start a transaction within a transaction` 내부 DB 접수 오류로 `failed-clean` 반환된 위임은 `dispatch-database-transient` 수동 복구 후보다. 원 dispatch의 실패·턴 없음·오류·대화·lease와 pool의 무변경 반환·체크포인트 없음이 일치해야 한다. 다른 DB 오류·실행된 턴·원 기록 만료·부분 저장을 추정해 복구하지 않는다. 이미 완료된 같은 카드의 후속 성공이 있으면 사용자 확인으로 과거 실패만 연결 종료할 수 있고, 원 실패를 완료로 바꾸거나 자동 실행하지 않는다. AionCore 트랜잭션 원인 수정은 별도 범위다.

완료 체크포인트의 통합 직전 main HEAD가 달라져 격리된 결과는 `integration-head-changed / retry-integration`으로 분류한다. 보존된 source·후보·세션·점유·체크포인트와 후보의 각 커밋 tree를 검증한 뒤 최신 main 기준의 별도 후보로 재통합한다. 원 후보가 이미 main의 조상이면 중복 적용하지 않는다. 사용자 변경·진행 중 Git·미해결 충돌은 우회하지 않으며 원 실패와 후보는 보존한다. 하위 구현을 재실행하거나 같은 카드의 다른 위임 완료만으로 실패를 종료하지 않는다. 원격 lease는 기존 원격 복구 경로를 사용하며 로컬 manager로 우회하지 않는다.

검증된 후보 커밋이 worker에만 있으면 main에 아직 반영되지 않은 것으로 판정한다. main의 객체 존재를 먼저 확인하고 존재할 때만 조상 여부를 검사하며, 객체 부재를 확인하는 종료 코드 1 외의 Git 오류는 그대로 차단한다. 이를 확인하기 위해 main의 checkout·HEAD·사용자 파일을 바꾸거나 검증 전 후보를 fetch하지 않는다.

`stream disconnected before completion`으로 실패한 실행은 `upstream-interrupted` 수동 복구 대상이다. 자동 재실행하지 않고, 사용자 승인·최신 문서·유휴 대화 검증 후 같은 대화와 lease에서 재개한다. 실제 원 dispatch의 실패·턴·대화·lease·오류를 대사한다. 명시적인 `EXTERNAL_DISPATCH_NOT_FOUND`로 기록이 만료됐으면 최초 위임 시도에 한해 완전한 유한 페이지 원문에서 해당 job 시간창의 사용자 전문을 하나로 확인한다. 기존 대화 재사용(`resume`)도 지원하지만 원 지시 hash·시작 계정/카드·lease·브랜치·기준 커밋이 모두 같아야 한다. 불완전/변경된 이력, 다른 404, 후속 복구 실행의 만료는 거부한다. 증거에는 ID·hash만 보존하고 지시 전문·인증 정보를 저장하거나 반환하지 않는다.

격리 해제는 pool의 같은 실패 결과와 증거를 다시 대사하며 기존 세션·Git/HEAD·체크포인트 검사를 유지한다. 미커밋 결과를 삭제하거나 새 worker로 우회하지 않는다. 실행 중단과 상위 실패 보고의 전달 실패가 함께 있으면 하위 업무를 완료했다고 안내하지 않는다.

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
