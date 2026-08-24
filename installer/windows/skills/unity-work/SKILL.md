---
name: unity-work
description: >
  Unity 프로젝트에서 MCP로 에디터를 조작하거나 Unity UI 코드를 작성할 때 사용한다.
  대상 에디터 인스턴스 식별, 여러 에디터가 한 MCP 서버를 공유할 때의 오수정 방지,
  execute_code 경로 가드와 임시 오브젝트 정리, Unity UI 레이아웃 책임 분리를 다룬다.
  Unity MCP 변경 도구를 호출하거나 Unity UI 배치를 다루는 코드를 쓰기 전에 사용한다.
---

# Unity 작업 안전 절차

## UI 레이아웃 책임

- Unity UI의 시각적 레이아웃 값은 프리팹과 에디터에서 관리한다.
- `RectTransform`의 부모·앵커·피벗·위치·크기·스케일을 코드나 Play 진입 시 덮어쓰지 않는다.
- `GridLayoutGroup`, `HorizontalLayoutGroup`, `VerticalLayoutGroup`의 셀 크기·간격·패딩·정렬·제약을 코드에서 정하지 않는다.
- `ScrollRect`의 축 활성화와 Viewport·Content 배치를 코드에서 정하지 않는다.
- UI 코드는 데이터 표시, 아이템 생성, 이벤트 연결과 노출 조건 같은 동작만 담당한다.
- 데이터에 따른 동적 레이아웃 계산이 불가피하면 필요성과 범위를 설명하고 사용자에게 명시적으로 확인받은 뒤 적용한다.

## 대상 Unity 인스턴스 식별

여러 Unity Editor가 하나의 MCP 서버를 공유할 수 있으므로 이름만으로 대상을 선택하지 않는다.

1. 배정되거나 사용자가 지정한 프로젝트 루트를 확정한다.
2. 프로젝트 경로의 역슬래시를 `/`로 바꾸고 `/Assets`를 붙여 `assetsPath`를 만든다.
3. `SHA1(assetsPath)`의 앞 16자를 인스턴스 해시로 사용한다.
4. `mcpforunity://instances`에서 해시가 일치하는 항목을 찾는다.
5. `set_active_instance`를 보조적으로 호출한 뒤 `mcpforunity://project/info`의 `projectRoot`가 대상과 같은지 확인한다.

인스턴스 목록에 프로젝트 경로가 없거나 같은 이름의 복제 프로젝트가 있으면 이름을 판단 근거로 사용하지 않는다.

## 변경 호출 안전 규칙

- 프로젝트를 변경하는 모든 Unity MCP 호출에 `unity_instance`를 직접 지정한다. `set_active_instance`만으로 세션 고정을 가정하지 않는다.
- `execute_code`의 첫 줄에서 `Application.dataPath`가 예상 `assetsPath`와 같은지 검사하고, 다르면 아무것도 변경하지 않고 반환한다.
- `execute_code`의 `replay`를 사용하지 않는다. 다시 실행해야 하면 경로 가드를 포함한 코드를 새로 보낸다.
- 에디터에서 만든 임시 오브젝트는 `try`/`finally`로 파괴한다.
- 리소스 조회 결과는 응답의 `instance_id`와 `projectRoot`가 대상과 일치할 때만 판단 근거로 사용한다.

## 오수정 또는 실패 복구

- 호출이 실패하거나 대상이 잘못되었으면 연결된 다른 에디터에 임시 오브젝트나 변경 부산물이 남았는지 즉시 확인한다.
- 잘못된 작업공간의 씬과 에셋을 저장하지 않는다.
- 안전하게 제거할 수 있는 임시 부산물만 회수하고, 의도하지 않은 변경 범위와 복구 결과를 사용자에게 보고한다.
