# Windows MnP 시작·종료·재시작

## 운영 기준

- 등록된 `\MindNProgress` 작업과 NHN 실행 계정·자동 실행 조건을 유지한다. 콘솔 노출 보완 시 승인된 실행 동작만 GUI 호스트로 전환하며 계정·트리거·재시도·실행 시간 제한은 바꾸지 않는다.
- 상위 `MindNProgress_Start.vbs`는 기존처럼 **재시작 후 브라우저 열기**, `MindNProgress_Stop.bat`는 **종료만** 수행한다. 둘 다 `scripts/mnp-runtime.ps1`을 호출한다.
- 시작 아이콘의 재시작은 콘솔을 표시하지 않고 진행한다. VBS 실행 창 스타일과 PowerShell 창 스타일을 모두 숨김으로 지정하며, 완료를 기다린 뒤 브라우저를 연다. 실패 안내 메시지와 시간·오류 로그는 유지한다. 터미널에서 직접 실행하는 공통 명령의 출력은 그대로 유지한다.
- 예약 작업의 `MindNProgress_Launcher.cjs`는 장기 실행 런처다. AI 터미널에서 직접 런처나 개발 서버를 띄우지 않는다.
- 예약 작업은 `wscript.exe //B //NoLogo "<프로젝트>\scripts\runtime\task-host.vbs" "<확인된 node.exe>" "<설치 루트>\MindNProgress_Launcher.cjs"`를 실행한다. GUI 호스트가 Node 생성 시점에 숨김 스타일을 전달하고, 런처 종료까지 기다려 종료 코드를 예약 작업으로 반환한다. 바로 종료하는 분리 실행기가 아니다.
- 구형 예약 작업의 `powershell.exe -WindowStyle Hidden`은 PowerShell 초기화 전의 순간적인 콘솔 노출을 막지 못한다. 제어 명령은 검증된 구형·신형 동작만 허용하며 전환 전 기존 서버 종료와 전환 후 프로세스 계층 검증을 모두 유지한다.
- Git 밖의 상위 실행 파일은 `scripts/runtime/entrypoints/`에 재배포용 원본을 관리한다. 이번 교체 전 원본은 `../.mindnprogress/runtime-entrypoints-backup-20260914/`에 보관했다.

## 공통 명령

프로젝트 폴더에서 실행한다. `status`는 서버와 예약 작업을 변경하지 않는다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/mnp-runtime.ps1 -Action status
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/mnp-runtime.ps1 -Action start
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/mnp-runtime.ps1 -Action stop
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/mnp-runtime.ps1 -Action restart
```

검증된 GUI 호스트로 **승인된 일회성 전환**은 `-Action restart -UseGuiTaskHost`로 수행한다. 같은 제어 잠금 안에서 기존 서버 종료·포트 해제를 확인한 뒤, 기존 작업 XML을 `.mindnprogress/task-before-gui-host-*.xml`에 백업하고 실행 동작만 갱신한다. 실행 동작 외 XML이 그대로인지 검사한 후 같은 작업을 시작한다. 일반 재시작·시작 아이콘은 예약 작업 설정을 자동 변경하지 않는다.

최초 전환 시 실행 중인 구형 서버에는 정상 종료 IPC가 없다. 저장·편집을 마친 다음 한 번만 `-AllowLegacyStop`을 추가한다. 사용자가 실행하는 기존 시작/종료 아이콘에는 이 호환 옵션이 포함되어 있다. 신형 감시자가 확인되면 이 옵션이 있어도 정상 종료를 사용하며, 정상 종료 시간 초과를 강제 종료로 대체하지 않는다.

종료 대기는 `-StopTimeoutSeconds` 기본 30초, 시작 대기는 `-StartTimeoutSeconds` 기본 60초다. 긴 Dooray 수집·위임 처리 등이 진행 중이면 더 오래 걸릴 수 있다. 시간 초과 시 새 서버 기동을 막고 오류를 반환한다. 기존 작업을 확인하고 기다린 다음 `status`로 확인하며, 강제 재시작을 반복하지 않는다.

## 순서와 안전 장치

1. 실행 파일·설치 경로·예약 작업 인수·NHN 계정·프로세스 명령줄/생성 시각/부모 관계·포트 소유자를 확인한다. 테스트와 다른 세션의 동일 소스 서버는 배포 런처의 자손이 아니면 제외한다. 운영 포트를 다른 서버가 사용하면 중단한다.
2. 재시작 명령의 독점 파일 잠금을 유지한다. 예약 작업부터 중지하고, 남은 감시자에 설치 경로별 파이프와 실행 인스턴스 식별자로 정상 종료를 요청한다. 외부 HTTP 종료 API는 만들지 않는다.
3. API는 신규 요청과 반복 작업을 중지하고, 처리 중인 요청 함수·명시적 백그라운드 작업을 기다린다. 응답만 먼저 반환한 저장도 기다리며 SSE 연결을 정리한다. 이후 웹 서버를 닫고 프로세스가 실제로 종료될 때까지 기다린다.
4. 반복 확인에는 프로세스 핸들·기동 시각·실행 파일과 빠른 TCP 목록을 사용한다. PID 파일만으로 종료하지 않는다. 구형 전환에만 명령줄·생성 시각·부모 관계를 재조회한 동일 대상의 종료를 허용한다.
5. 기존 프로세스와 포트가 모두 사라진 뒤 같은 예약 작업을 시작한다. 웹/API HTTP 200과 API 상태, 새 PID/기동 시각, 실제 NHN 계정과 포트 소유자를 다시 확인한다. 최종 HTTP 확인이 일시적으로 실패하면 최대 5초 동안 확인만 재시도하며, 예약 작업을 다시 시작하지 않는다.

`npm run dev`의 `--watch` 개발 경로는 유지한다. 예약 작업은 자동 코드 감시 재시작이 없는 stable 경로다. 개발 경로는 운영 제어 명령의 종료 대상에 포함하지 않는다.

## 기록과 검증 범위

- `../.mindnprogress/runtime-operations.jsonl`: 사전 검사, 종료, 작업 시작, HTTP 준비, 최종 검증, 전체 시간 및 성공 여부.
- `../.mindnprogress/dev.out.log`: API/웹 자원 정리 및 실제 하위 프로세스 종료 시간.
- `../.mindnprogress/dev.err.log`: 오류 상세. 인증 정보나 제어 인스턴스 식별자는 로그에 기록하지 않는다.

2026-09-14 구현 검증은 임시 데이터/포트에서 저장 대기, SSE, IPC 정상 종료, 새 인스턴스와 HTTP 준비, 잘못된 식별자/중복 기동 거부, 제어 명령의 승인·대상·잠금·시간 초과 보호 장치를 확인했다.

같은 날 사용자 승인으로 NHN 예약 작업을 재시작했다. 기존 API/웹 PID `215292`/`218560`을 종료한 뒤 `220572`/`200852`(12:23:26 KST)로 바뀐 것을 확인했다. 종료 확인은 약 1.9초, 최초 HTTP 준비는 약 6.1초였다. 약 19.5초 시점의 단회 최종 HTTP 검사에서 실패를 반환했으나, 동일 새 PID를 유지한 채 후속 웹/API 검사는 연속 3회 HTTP 200이었다. 이 사례를 바탕으로 최종 검사에 제한된 재확인을 추가하고 일시 실패·지속 실패 회귀 검증을 추가했다. 재확인 때문에 실제 서버를 다시 재시작하지 않았다.

사전 검사 단일 측정은 WMI 계정 조회 반복 제거 전 약 22.6초, Windows 프로세스 토큰 조회 적용 후 약 9.5초였다. 통제된 반복 벤치마크는 아니다. 임시 웹 서버는 자원 정리 이후 실제 프로세스 종료까지 수 초 이상 편차가 관찰됐다. **전체 10~15초는 아직 검증된 보장이 아니며**, 다음 실제 재시작의 단계별 로그로 확인한다.

```powershell
node --test tests/runtime-controller.test.mjs tests/runtime-entrypoints.test.mjs tests/runtime-task-host.test.mjs tests/runtime-lifecycle.test.mjs tests/runtime-supervisor.test.mjs
npm run build
```

이 테스트는 운영 프로세스·계정·포트·예약 작업 설정을 변경하지 않는다. 상위 실행 파일은 `scripts/runtime/entrypoints/` 원본과 일치하는지 별도로 비교한다.

`runtime-task-host.test.mjs`는 프로세스 생성 **이전부터** 별도 메시지 처리 스레드의 Windows SHOW 이벤트 훅을 가동한다. 화면에 나타나지 않는 메시지 전용 창으로 감시기 자체를 확인한 뒤, GUI 호스트를 10회 실행하면서 창 표시 이벤트·부모 관계·작업 디렉터리·서버 종료까지의 대기·정상/실패 종료 코드 전달을 검사한다. 실제 시작 VBS → 격리 제어 PowerShell → Node/netstat 조회 → GUI 호스트 경로도 검사한다. 테스트 부모가 호스트 창을 대신 숨겨 거짓으로 통과하지 않도록 GUI 호스트 실행에는 숨김 플래그를 주지 않는다. 운영 예약 작업을 직접 실행한 검증과는 구분해 기록한다.

사용자가 실제 재시작을 승인한 경우에만 `tests/runtime-live-window-check.ps1 -Restart`로 운영 예약 작업 전체의 창 이벤트와 새 프로세스/HTTP 상태를 함께 검사한다. 일회성 실행 동작 전환까지 승인된 경우 `-MigrateGuiHost`를 추가한다. 결과는 `.mindnprogress/runtime-window-verification-*.json`에 저장하며, 실패해도 자동 반복 재시작하지 않는다. 일반 자동 테스트에는 이 운영 검사를 포함하지 않는다.

### GUI 호스트 전환 검증 — 2026-09-14

- 격리 회귀 테스트 8개 통과. GUI 호스트 10회 실행과 실제 시작 VBS → 격리 PowerShell → Node/netstat → GUI 호스트 경로에서 SHOW 이벤트 0건. 대기·부모 관계·작업 디렉터리·종료 코드 0/7·잘못된 경로 거부를 확인했다. 전환 작업 XML 백업의 UTF-16 인코딩과 실제 XML 재로드도 추가 검증했다.
- 사용자 요청에 따라 실제 예약 작업을 1회 전환·재시작했다. 기존 서버 종료는 약 20.3초였고, 실행 동작을 제외한 작업 XML이 동일함을 확인했다. NHN 계정, 트리거, 시간 제한, 재시도 설정을 보존했다.
- 실제 재시작 전체의 SHOW 이벤트는 0건이었다. 기록은 `../.mindnprogress/runtime-window-verification-20260914-094153.json`에 있다. 이 기록의 전체 성공 여부는 아래 HTTP 시간 초과 때문에 `false`이며, 실패 전에 저장한 실행 파일/프로세스 정보는 전환 전 스냅샷이다.
- 새 작업 호스트는 `wscript.exe` PID `99180`, API/웹은 PID `219608`/`230420`(18:42:27 KST)다. 이후 읽기 전용 재조회에서도 같은 PID·NHN 계정·검증된 부모 관계·포트 소유권을 확인했다.
- 처음 HTTP 준비 검사는 통과했으나 마지막 900ms 단위 HTTP 검사에서 시간 초과했다. 추가 재시작 없이 후속 확인 3회 모두 웹/API HTTP 200, API `status=ok`였고 응답 시간은 각각 78/4/3ms였다. 창 노출 검증과 기존의 짧은 HTTP 준비 제한 문제를 구분하며, 이번 변경에서는 HTTP 제한을 수정하지 않았다.
