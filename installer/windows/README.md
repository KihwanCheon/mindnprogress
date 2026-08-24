# MnP Suite Windows Git 설치 패키지

`Install-MnPSuite.bat`을 실행하면 설치 위치 선택부터 필수 도구 확인, 세 Git 저장소 설치, AionUi의 MindNProgress MCP bootstrap 준비, 의존성 설치, AionCore 빌드, Dev 실행 배치 생성과 완료 안내까지 순서대로 진행합니다.

## 기본 설치 구성

```text
<선택한 설치 루트>/
  ├─ MindNProgress/  origin: https://github.com/mabobsa/MindNProgress.git
  ├─ AionUi/         origin: https://github.com/mabobsa/AionUi.git
  ├─ AionCore/       origin: https://github.com/mabobsa/AionCore.git
  ├─ workspace-pool/ Unity 작업공간 구성·공통 규칙·지식 제출 폴더
  ├─ dev/            Dev 실행·중지·AionCore 재빌드 배치
  ├─ MindNProgress_Launcher.cjs  백업·복원 후 MnP 재시작 호환 실행 파일
  ├─ MindNProgress_Stop.bat      백업·복원 전 MnP 중지 호환 실행 파일
  ├─ install-logs/   설치 로그
  ├─ README_FIRST.md
  ├─ UNITY_MCP_AND_FORK_GUIDE.md
  └─ installation-manifest.json
```

AionUi와 AionCore에는 개인 fork를 `origin`, 공식 저장소를 `upstream`으로 등록합니다. 세 저장소의 기본 브랜치는 `main`입니다.

`workspace-pool\workspaces.json`에는 integration과 worker 예시가 `enabled=false`로 생성됩니다. 따라서 실제 Unity 프로젝트 경로를 설정하기 전에는 어떤 작업공간도 점유하지 않습니다.

현재 AionUi fork에 MindNProgress MCP bootstrap이 아직 포함되지 않은 경우 설치기는 `overlays\AionUi-MindNProgress-Mcp.patch`를 사전 검사한 뒤 AionUi 작업 트리에 적용합니다. fork가 같은 기능을 포함하면 overlay는 자동으로 생략됩니다. overlay가 적용된 AionUi 저장소에는 의도된 로컬 변경이 남으므로, 원격 업데이트 전에는 아래의 업데이트 주의사항을 확인하세요.

## 대화형 설치

파일 탐색기에서 다음 파일을 더블클릭합니다.

```text
Install-MnPSuite.bat
```

설치 과정에서 다음을 선택하거나 확인합니다.

1. 최종 설치 루트
2. 설치 계획
3. 누락 필수 도구의 winget 설치 여부
4. 기존 저장소가 있을 때 재사용 또는 fast-forward 업데이트
5. 바탕화면 바로가기 생성
6. 설치 직후 Dev 환경 실행

## 무인 설치 예시

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\Install-MnPSuite.ps1 `
  -InstallRoot 'C:\Dev\MnPSuite' `
  -NonInteractive `
  -InstallMissingPrerequisites `
  -CreateDesktopShortcuts `
  -NoLaunchPrompt
```

기존의 올바른 저장소를 그대로 사용할 때는 `-ReuseExistingRepositories`, 깨끗한 현재 `main`을 `origin/main`으로 fast-forward할 때는 `-UpdateExistingRepositories`를 지정합니다. 원격 주소가 다르거나 업데이트 대상에 커밋되지 않은 변경이 있으면 중단합니다.

## 원격 저장소 또는 브랜치 변경

```powershell
.\Install-MnPSuite.ps1 `
  -InstallRoot 'C:\Dev\MnPSuite' `
  -MindNProgressRepository 'https://github.com/example/MindNProgress.git' `
  -AionUiRepository 'https://github.com/example/AionUi.git' `
  -AionCoreRepository 'https://github.com/example/AionCore.git' `
  -MindNProgressBranch 'main' `
  -AionUiBranch 'main' `
  -AionCoreBranch 'main'
```

## 필수 도구

- Git
- Node.js 22 이상 25 미만과 npm
- Bun
- Rustup과 Cargo
- Python 3.11 이상
- Visual Studio 2022 C++ Build Tools

누락 도구 자동 설치를 승인하면 스크립트는 먼저 `winget search`로 커뮤니티 소스가 실제 동작하는지 확인한 뒤 패키지를 설치합니다. `--source winget`을 명시하므로 Microsoft Store 소스의 인증서나 연결 오류가 필수 개발 도구 설치를 막지 않습니다. 상태 확인이 비정상 종료되면 Microsoft Store 또는 사내 배포 도구에서 **앱 설치 관리자(Desktop App Installer)**를 업데이트하거나, IT 담당자가 필수 도구를 먼저 설치해야 합니다.

## 생성되는 Dev 실행 파일

| 파일 | 역할 |
| --- | --- |
| `dev\Start-All-Dev.bat` | MindNProgress와 AionUi를 각각 새 콘솔에서 실행 |
| `dev\Start-MindNProgress-Dev.bat` | `npm run dev`로 MnP Web·API 실행 |
| `dev\Stop-MindNProgress-Dev.bat` | 설치 경로와 일치하는 4175·4176 프로세스만 종료 |
| `dev\Start-AionUi-Dev.bat` | 로컬 release AionCore를 PATH 앞에 두고 `bun run dev` 실행 |
| `dev\Rebuild-AionCore-Release.bat` | `cargo build --release --locked --bin aioncore` 실행 |
| `dev\Backup-MindNProgress-Data.bat` | Suite 루트의 `MindNProgress_Backup`에 운영 데이터 ZIP 생성 |
| `dev\Restore-MindNProgress-Data.bat <backup.zip>` | 검증된 ZIP으로 운영 데이터 복원 |

루트의 `MindNProgress_Launcher.cjs`와 `MindNProgress_Stop.bat`은 MnP 저장소의 기존 백업·복원 스크립트가 Suite의 `dev` 실행 파일을 사용할 수 있도록 연결합니다. 서버가 실행 중인 상태에서도 백업·복원 전후의 중지와 재시작 경로가 끊기지 않습니다.

AionUi Dev 실행 배치는 Sentry DSN을 비워 이 실행에 한해 원격 오류 전송을 사용하지 않습니다. AionCore를 별도 서버로 직접 실행하지 않으며 AionUi가 로컬 바이너리를 시작합니다.

이 배치는 `MINDNPROGRESS_MCP_ENTRY`에 현재 설치 루트의 `MindNProgress\mcp\server.mjs`를 지정합니다. AionUi는 최초 실행 bootstrap에서 이름이 `MindNProgress`인 stdio MCP를 자동 등록·활성화합니다. 이미 등록된 항목이 비활성 상태이거나 설치 위치가 바뀌었으면 다음 AionUi 시작 때 활성 상태와 경로를 다시 맞춥니다.

MnP의 `AI 대화 시작` 작업공간 기본값도 서버가 현재 설치된 `MindNProgress` 저장소 경로를 동적으로 제공하므로 특정 PC의 Git 경로를 전제로 하지 않습니다.

## Unity 작업공간 풀 설정

설치본은 개인용 공유 폴더를 참조하지 않고 다음 항목을 설치 루트 아래에 만듭니다.

```text
workspace-pool/
  ├─ workspaces.json
  ├─ common/MULTI_WORKSPACE.md
  ├─ knowledge-inbox/
  └─ knowledge-applied/
```

`workspaces.json`에서 `originUrl`과 각 항목의 `root`, `assetsPath`, `unityInstanceHash`를 실제 값으로 바꿉니다. 같은 Git 저장소의 독립 clone 중 하나를 `role=integration`, 하나 이상을 `role=worker`로 등록한 뒤 사용할 항목만 `enabled=true`로 설정합니다. 최소한 활성 integration 한 개와 활성 worker 한 개가 있어야 풀이 초기화됩니다. 수정 후 MindNProgress를 다시 시작하세요.

`dev\Start-MindNProgress-Dev.bat`은 이 파일을 `MNP_WORKSPACE_POOL_REGISTRY`로 지정합니다. 다른 중앙 구성 파일을 사용하려면 해당 런처의 환경변수 값을 조직에서 관리하는 절대 경로로 바꿀 수 있습니다.

## 계획 확인과 자체 검증

파일을 변경하지 않고 설치 계획과 필수 도구 상태만 확인합니다.

```powershell
.\Install-MnPSuite.ps1 -InstallRoot 'C:\Dev\MnPSuite' -NonInteractive -PlanOnly
```

Dev 배치 템플릿에 하드코딩된 드라이브 경로가 없는지 자체 검증합니다.

```powershell
.\Install-MnPSuite.ps1 -SelfTest -NonInteractive
```

## 안전 동작

- 드라이브 루트와 Windows·Program Files·ProgramData에는 설치하지 않습니다.
- 기존 비-Git 폴더를 덮어쓰지 않습니다.
- 기존 Git 저장소의 `origin`이 예상 주소와 다르면 중단합니다.
- 업데이트는 깨끗한 현재 브랜치에서 `git pull --ff-only`만 사용합니다.
- 업데이트 전 세 저장소를 먼저 검사하므로 뒤쪽 저장소의 로컬 변경 때문에 앞쪽 저장소만 갱신되는 부분 업데이트를 하지 않습니다.
- 다른 브랜치로 자동 전환하거나 로컬 변경을 초기화하지 않습니다.
- `server/data`의 운영 데이터를 Git 업데이트 대상으로 취급하지 않습니다.
- 작업공간 템플릿과 공통 규칙은 기존 파일이 있으면 덮어쓰지 않습니다.
- 바탕화면 바로가기는 영문 파일명으로 만들며, Windows 정책 때문에 생성이 실패해도 설치 결과는 유지하고 경고만 표시합니다.

## 설치 후 MCP 확인

AionUi를 한 번 실행하면 다음 stdio MCP 서버가 자동 등록되고 활성화됩니다.

```text
이름: MindNProgress
명령: node
인수: <설치 루트>\MindNProgress\mcp\server.mjs
```

MnP의 `AI 대화 시작` 창을 다시 열어 `MindNProgress · 필수`가 보이고 체크 해제가 불가능한지 확인합니다. 보이지 않으면 AionUi 콘솔에서 `updated MindNProgress server`가 포함된 MCP bootstrap 완료 로그와 MCP 엔트리 파일 존재 여부를 확인합니다. AionUi의 MCP와 Assistant 기본값 변경은 새 대화에 적용되며 이미 열려 있는 대화 런타임에는 소급 적용되지 않습니다.

## AionUi overlay 적용 상태와 업데이트

`installation-manifest.json`의 `aionUiMindNProgressMcpBootstrap`에서 fork 내장 기능을 사용했는지, 설치기 overlay가 적용됐는지 확인할 수 있습니다.

- `source=repository`: fork 자체에 기능이 있어 AionUi 작업 트리가 깨끗하게 유지됩니다.
- `source=installer-overlay`: 설치기가 호환 overlay를 적용했으며 AionUi 작업 트리에 세 개 파일의 변경이 남습니다. 설치기를 재실행해도 이 상태를 `repository`로 잘못 기록하지 않습니다.

overlay 상태에서는 설치기의 `-UpdateExistingRepositories`가 로컬 변경 보호를 위해 AionUi 업데이트를 중단합니다. fork에 동일 기능을 반영한 새 버전으로 전환할 때는 기존 설치를 보존한 채 새 설치 루트에 설치하거나, 변경 검토 후 유지보수자가 overlay를 fork 커밋으로 정식 반영해야 합니다. 설치기가 로컬 변경을 자동 삭제하거나 초기화하지는 않습니다.

Unity 프로젝트를 연결하거나 병렬 worker 작업공간을 사용할 때는 [`UNITY_MCP_AND_FORK_GUIDE.md`](UNITY_MCP_AND_FORK_GUIDE.md)를 먼저 확인합니다. 설치가 끝나면 같은 문서가 선택한 설치 루트에도 복사됩니다.
