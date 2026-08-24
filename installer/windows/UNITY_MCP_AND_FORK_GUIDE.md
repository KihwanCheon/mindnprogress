# 클라이언트 사용자용 Unity MCP 및 Fork 운영 가이드

이 문서는 MindNProgress(MnP), AionUi(AionCore)와 Unity 프로젝트를 함께 사용하는 클라이언트 개발자를 위한 안내서입니다. Unity MCP를 처음 연결하는 방법, 여러 Unity 에디터 중 올바른 프로젝트를 선택하는 원리, 그리고 조직에서 사용하는 두 종류의 fork를 구분해 설명합니다.

> 설치 패키지는 MnP, AionUi와 AionCore 개발 환경 및 비활성 작업공간 풀 템플릿을 준비합니다. Unity Editor, 실제 클라이언트 프로젝트 clone, Unity 라이선스와 조직별 경로 등록은 별도로 준비해야 합니다.

## 1. 먼저 알아둘 구성

```text
사용자
  └─ MindNProgress 카드와 AionUi 대화
       ├─ MindNProgress MCP ─ 카드 문맥, 작업 상태, worker 배정·통합
       └─ Unity MCP ───────── 선택된 Unity Editor의 씬·에셋·스크립트·테스트
                                      ├─ integration 작업공간
                                      └─ 배정된 worker 작업공간
```

### MindNProgress MCP

MnP 카드의 요구사항과 연결된 지식을 AI에게 전달하고, 병렬 작업이 필요할 때 유휴 worker를 점유하고 해제합니다. 작업공간 선택, 작업 브랜치 생성과 결과 통합도 MnP가 담당합니다.

### Unity MCP

AI가 실행 중인 Unity Editor를 조회하고, 선택한 에디터에서 다음과 같은 작업을 수행하게 하는 연결 계층입니다.

- 씬, GameObject, 컴포넌트와 프리팹 확인·수정
- 스크립트와 에셋 생성·수정
- 에디터 상태와 Console 확인
- EditMode·PlayMode 테스트 실행
- 필요한 경우 화면 캡처와 렌더링 결과 확인

Unity MCP는 AI에게 강한 편집 권한을 제공합니다. 연결됐다는 사실만으로 아무 Unity 프로젝트나 수정해도 된다는 뜻은 아닙니다. AI는 MnP가 배정한 프로젝트와 Unity 인스턴스를 매번 확인해야 합니다.

## 2. “fork”는 두 가지 의미로 사용됩니다

| 구분 | 의미 | 사용자가 주로 할 일 |
| --- | --- | --- |
| AionUi·AionCore 소스 fork | 공식 저장소를 기반으로 조직 기능을 추가한 개인 Git fork | 지정된 `origin/main` 사용, 업데이트 후 재실행 |
| Unity 작업용 fork | 병렬 AI 작업을 위해 별도 폴더에 둔 독립 Git clone, 즉 worker 작업공간 | 직접 점유·브랜치 전환하지 않고 MnP에 맡김 |

### AionUi·AionCore 소스 fork

설치 스크립트는 다음 원격 구성을 준비합니다.

- `origin`: 조직에서 사용하는 개인 fork
- `upstream`: AionUi 또는 AionCore 공식 저장소

일반 사용자는 `origin/main`을 기준으로 실행합니다. 공식 변경을 가져오는 upstream rebase와 force push는 충돌과 기능 회귀를 검토해야 하므로 지정된 유지보수자가 수행합니다. 사용자는 임의로 `upstream/main`을 병합하거나 `git reset --hard`, 강제 push를 실행하지 않습니다.

AionCore가 업데이트되면 `dev\Rebuild-AionCore-Release.bat`으로 다시 빌드한 뒤 AionUi를 재시작합니다.

### Unity 작업용 fork

Unity worker는 같은 저장소를 서로 다른 폴더에 독립적으로 clone한 작업공간입니다. GitHub의 “Fork” 버튼으로 만든 저장소와는 다른 개념입니다. 각 작업공간은 다음 항목을 별도로 가집니다.

- Git 브랜치와 작업 파일
- Unity `Library`, `Temp`, `Logs`, `UserSettings`
- Unity Editor 프로세스와 Unity MCP 인스턴스 식별자
- MnP 작업의 `jobId`, `leaseId`와 세션 정보

`Assets`, `Packages`, `ProjectSettings`를 작업공간끼리 링크하거나 직접 복사하지 않습니다. 변경은 Git 커밋과 MnP 통합 절차로만 전달합니다.

## 3. integration과 worker의 역할

| 역할 | 용도 | 운영 원칙 |
| --- | --- | --- |
| `integration` | 사용자의 기준 작업공간이자 완료 결과의 통합 대상 | 사용자 확인과 최종 결과 기준으로 사용 |
| `worker` | AI가 독립 작업을 수행하는 임시 작업공간 | `enabled=true`이고 실제 상태가 `idle`일 때만 MnP가 배정 |

작업공간의 폴더명과 개수는 고정값으로 외우지 않습니다. 설치본의 최신 정적 구성은 `<설치 루트>\workspace-pool\workspaces.json`이 유일한 기준이며, 실제 사용 가능 여부는 MnP의 작업공간 풀 상태로 판단합니다.

사용자가 worker 폴더를 직접 골라 AI에게 지시하거나, 사용 중인 worker의 브랜치를 바꾸거나, Unity 에디터를 다른 worker 대신 사용하면 안 됩니다. 가용 worker가 없으면 작업은 대기열에 보존되고, 작업공간이 회수된 뒤 순서대로 시작됩니다.

### 작업공간 풀 템플릿 설정

설치 스크립트는 다음 공용 구조를 만들며, 기존 파일이 있으면 덮어쓰지 않습니다.

```text
<설치 루트>\workspace-pool\
  workspaces.json
  common\MULTI_WORKSPACE.md
  knowledge-inbox\
  knowledge-applied\
```

초기 `workspaces.json`의 integration과 worker 예시는 모두 `enabled=false`입니다. 다음 순서로 구성합니다.

1. 같은 원격 Git 저장소에서 integration clone 한 개와 worker clone 한 개 이상을 서로 다른 폴더에 준비합니다.
2. `originUrl`에 기준 원격 주소를 입력합니다.
3. 각 항목의 `root`에 프로젝트 루트 절대 경로, `assetsPath`에 해당 프로젝트의 `Assets` 절대 경로를 입력합니다.
4. Unity MCP가 표시하는 인스턴스 해시를 `unityInstanceHash`에 입력합니다.
5. 사용자 기준 clone은 `role=integration`, AI 위임용 clone은 `role=worker`로 둡니다.
6. 경로와 역할을 재확인한 항목만 `enabled=true`로 바꾸고 MindNProgress를 다시 시작합니다.

활성 integration 또는 worker가 하나라도 없으면 MnP는 작업공간 풀을 사용하지 않습니다. Unity 프로젝트 clone 자체는 `workspace-pool` 안에 둘 필요가 없으며, 조직에서 정한 다른 드라이브나 폴더를 절대 경로로 등록할 수 있습니다.

## 4. 최초 연결 절차

### 4.1 MnP Suite 실행

설치 루트에서 다음 파일을 실행합니다.

```text
dev\Start-All-Dev.bat
```

MnP는 기본적으로 `http://127.0.0.1:4175/`에서 열리고 AionUi는 Electron 창으로 실행됩니다.

AionUi는 현재 설치 루트의 `MindNProgress\mcp\server.mjs`를 최초 실행 bootstrap에서 자동 등록하고 활성화합니다. AionUi가 준비된 뒤 MnP의 `AI 대화 시작` 창을 다시 열어 `MindNProgress · 필수`가 표시되는지 확인합니다. 이미 열려 있던 대화에는 새 MCP가 소급 적용되지 않습니다.

### 4.2 Unity 프로젝트 준비

1. 조직에서 지정한 Unity 버전으로 integration 프로젝트를 엽니다.
2. 패키지 import와 스크립트 컴파일이 끝날 때까지 기다립니다.
3. `Packages/manifest.json`에 `com.coplaydev.unity-mcp`가 포함되어 있는지 확인합니다.
4. Unity 메뉴에서 `Window > MCP for Unity`를 엽니다. Windows에서는 `Ctrl+Shift+M` 단축키도 사용할 수 있습니다.
5. `Server Status`가 설치됨으로 표시되는지 확인합니다.
6. `Unity Bridge`가 멈춰 있으면 `Start Bridge`를 누릅니다.

`uv` 또는 `uvx`가 없다고 표시되면 Unity MCP 창의 설치 안내를 따르거나 사내 IT 담당자에게 설치를 요청합니다. 실행 파일 경로를 임의의 다운로드 파일로 지정하지 않습니다.

### 4.3 AionUi에 Unity MCP 등록

Unity MCP의 `Auto-Setup`은 서버와 Bridge 준비에 사용할 수 있지만 AionUi 등록은 AionUi의 MCP 서버 관리 화면에서 확인하며 진행합니다.

1. Unity의 `MCP for Unity` 창에서 사용할 전송 방식을 선택합니다.
2. `Manual Setup` 또는 `HTTP Server Command`에 표시된 명령, 인수 또는 URL을 확인합니다.
3. AionUi의 MCP 서버 관리 화면에서 이름을 `Unity MCP`로 추가합니다.
4. stdio를 쓸 때는 Unity가 제시한 `uvx` 명령과 인수를 순서대로 입력합니다.
5. HTTP를 쓸 때는 Unity 창에 표시된 로컬 서버를 먼저 시작하고, 표시된 `/mcp` 주소를 그대로 입력합니다.
6. 연결 테스트를 실행하고 서버를 활성화합니다.

문서에 적힌 예전 포트나 다른 PC의 명령을 복사하지 말고 현재 Unity 창에 표시된 값을 사용합니다. Unity MCP 패키지 버전과 전송 방식에 따라 값이 달라질 수 있습니다. 로컬 사용에서는 loopback 주소만 사용하고, 별도 보안 검토 없이 LAN 전체에 포트를 공개하지 않습니다.

### 4.4 새 대화에서 MCP 선택

AionUi의 MCP 기본값과 Assistant 설정 변경은 이미 실행 중인 대화에 소급 적용되지 않습니다.

1. `MindNProgress`와 `Unity MCP`가 활성화되었는지 확인합니다.
2. MnP에서 대상 카드를 선택합니다.
3. 새 AI 대화를 만들 때 두 MCP를 모두 선택합니다.
4. 기존 대화를 계속 써야 한다면 해당 대화에 실제로 두 MCP가 연결됐는지 먼저 확인합니다. 연결되지 않았다면 새 대화를 사용합니다.

## 5. 첫 연결 확인

첫 요청은 쓰기 작업이 아닌 조회로 확인합니다. 다음처럼 요청할 수 있습니다.

```text
현재 MnP 작업공간 풀 상태와 연결된 Unity 인스턴스 목록을 조회해 주세요.
파일이나 씬은 변경하지 말고 integration projectRoot가 등록 정보와 일치하는지만 알려주세요.
```

확인할 항목은 다음과 같습니다.

- MnP가 최신 작업공간 풀을 조회했는가
- Unity 인스턴스를 이름만으로 고르지 않았는가
- Unity의 실제 `projectRoot`가 등록된 작업공간과 일치하는가
- 쓰기 없이 조회 결과만 보고했는가

## 6. 여러 Unity Editor를 구분하는 방법

같은 프로젝트 이름을 가진 Unity Editor가 여러 개 실행될 수 있으므로 창 제목만으로 대상을 선택할 수 없습니다. 작업공간마다 정규화된 `Assets` 경로의 SHA-1 앞 16자를 Unity 인스턴스 해시로 사용합니다.

```text
<프로젝트 루트>/Assets → SHA-1 → 앞 16자리 → <프로젝트명>@<해시>
```

이 계산과 선택은 사용자가 매번 할 일이 아니라 MnP와 AI의 안전 확인 절차입니다. AI는 다음 순서로 동작해야 합니다.

1. MnP가 배정한 `projectRoot`, `branch`, `jobId`, `leaseId`를 확인합니다.
2. 배정된 루트의 `.ai-workspace.json`과 `.ai-session.json`을 읽습니다.
3. Unity MCP 인스턴스 목록에서 등록된 해시와 일치하는 항목을 찾습니다.
4. 대상 인스턴스를 선택한 뒤 Unity가 보고하는 `projectRoot`를 다시 확인합니다.
5. 프로젝트를 변경하는 모든 Unity MCP 호출에 같은 `unity_instance`를 직접 지정합니다.

연결이 끊겼다가 복구되면 기본 인스턴스가 바뀔 수 있으므로 “한 번 선택했으니 계속 같은 에디터일 것”이라고 가정하지 않습니다.

## 7. 일반 작업 흐름

1. MnP에서 요구사항이 있는 카드를 선택합니다.
2. 새 대화에 `MindNProgress`와 `Unity MCP`를 연결합니다.
3. 목표, 변경 범위와 완료 조건을 자연어로 요청합니다.
4. MnP가 유휴 worker와 작업 브랜치를 배정합니다.
5. AI가 배정 정보와 Unity 인스턴스를 검증한 뒤 구현합니다.
6. AI가 변경 파일, 테스트 결과, 커밋 여부와 남은 위험을 보고합니다.
7. MnP가 최신 `main` 기준의 통합 브랜치에서 결과를 먼저 확인한 뒤 실제 integration `main`에 반영합니다.
8. 충돌이 나면 integration을 억지로 수정하지 않고 같은 작업을 수행한 AI와 worker에서 해결·검증합니다.

사용자는 요청에 worker 폴더명을 적을 필요가 없습니다. 대신 대상 카드, 기대 동작, 재현 절차, 수정하면 안 되는 범위와 확인할 플랫폼을 분명히 적는 것이 좋습니다.

## 8. Unity 변경 시 안전 기준

- UI의 `RectTransform`, `LayoutGroup`, `ScrollRect` 배치 값은 아트 디자이너가 프리팹과 에디터에서 결정합니다. AI 코드는 동작만 담당하고 Play 진입 시 시각 배치를 덮어쓰지 않습니다.
- 데이터에 따라 동적 레이아웃 계산이 꼭 필요하면 적용 이유와 범위를 설명받고 승인한 뒤 진행합니다.
- 임의 C# 실행은 첫 줄에서 `Application.dataPath`가 배정된 프로젝트인지 검사해야 합니다.
- 과거 실행 코드를 다른 에디터에서 다시 실행할 수 있는 replay 기능은 사용하지 않습니다.
- 검사 중 만든 임시 GameObject는 작업 성공 여부와 관계없이 정리합니다.
- 잘못된 Unity 인스턴스를 선택했거나 쓰기가 실패하면 즉시 중단하고 다른 에디터에 부산물이 남았는지 확인합니다.
- 다른 작업자가 수정 중인 dirty 씬이나 에셋을 임의로 저장하지 않습니다.
- 작업공간 사이에 에셋을 탐색기로 복사하지 않습니다.

## 9. 문제 해결

| 증상 | 확인 및 조치 |
| --- | --- |
| `Window > MCP for Unity`가 없음 | Package Manager와 `Packages/manifest.json`에서 `com.coplaydev.unity-mcp` 설치 여부를 확인합니다. |
| Server가 설치되지 않음 | Unity MCP 창의 `Auto-Setup`, Python과 `uv/uvx` 감지 상태를 확인합니다. |
| Bridge가 `Stopped`임 | 컴파일 완료 후 `Start Bridge`를 누릅니다. 반복되면 `Show Debug Logs`를 켜고 Console 오류를 확인합니다. |
| AionUi 연결 테스트 실패 | Unity 창의 현재 전송 방식과 AionUi의 stdio/HTTP 설정이 같은지, 명령·인수·`/mcp` URL이 정확한지 확인합니다. |
| 설정했지만 현재 대화에 도구가 없음 | AionUi에서 서버 활성화를 확인한 뒤 새 대화를 만듭니다. |
| Unity 인스턴스가 하나도 안 보임 | 대상 Unity Editor가 실행 중인지, 컴파일이 끝났는지, Bridge가 Running인지 확인합니다. |
| 같은 이름의 인스턴스가 여러 개임 | 이름으로 선택하지 말고 MnP 등록 해시와 Unity `projectRoot`가 모두 일치하는지 확인합니다. |
| worker를 사용할 수 없음 | 직접 다른 폴더로 우회하지 말고 대기열 상태를 확인합니다. 유휴 worker가 회수되면 자동으로 시작됩니다. |
| 엉뚱한 프로젝트가 수정된 것 같음 | 즉시 작업을 중단하고 대상·다른 에디터의 변경과 임시 오브젝트를 확인합니다. 관련 작업공간은 저장·초기화하지 말고 담당자에게 보고합니다. |
| AionCore 업데이트 후 AionUi 이상 | `dev\Rebuild-AionCore-Release.bat` 실행 후 AionUi를 완전히 재시작합니다. |

## 10. 사용자 체크리스트

작업 시작 전:

- MnP와 AionUi가 실행 중이다.
- 필요한 Unity Editor의 컴파일이 완료됐다.
- Unity MCP Server와 Bridge가 정상이다.
- 새 대화에 MindNProgress MCP와 Unity MCP가 연결됐다.
- 대상 카드와 완료 조건을 지정했다.

결과 검토 시:

- 보고된 `projectRoot`와 작업 브랜치가 배정 정보와 같다.
- 변경 파일이 요청 범위 안에 있다.
- 씬·프리팹의 의도하지 않은 시각 배치 변경이 없다.
- 테스트 결과와 미검증 항목이 구분되어 있다.
- integration 반영 또는 충돌 상태가 명확하다.

## 11. 운영 기준 원본

설치본에서는 다음 파일을 기준으로 합니다.

- 최신 정적 작업공간 구성: `<설치 루트>\workspace-pool\workspaces.json`
- 세부 멀티 작업공간 규칙: `<설치 루트>\workspace-pool\common\MULTI_WORKSPACE.md`

폴더명, worker 개수와 가용 상태를 과거 문서나 대화 기억으로 추측하지 않습니다. 실제 가용 상태는 MnP가 제공하는 최신 작업공간 풀 조회 결과를 사용합니다.
