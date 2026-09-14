# MCP 문서 소속 정보

문서·카드 조회와 편집 결과에는 그룹 ID·이름을 직접 제공한다. 기존 `documentLayout`과 도구 이름·인자는 호환 유지하며, 그룹 소속 정보는 관련 도구의 응답 메타데이터로 제공한다. 기획서·공통 지침 전문은 `mindnprogress_get_group_context`에서만 조회한다.

## 응답 계약

| 필드 | 의미 |
| --- | --- |
| `group` | 현재 활성 문서의 소속 `{ id, name }`. 총괄 문서가 없는 일반 그룹도 포함한다. |
| `groupMembership` | `grouped`, `ungrouped`, `archived`, `trashed`, `pending`, `missing`, `unavailable`. `ungrouped`만 현재 미소속이 확인된 상태다. |
| `groupProject` | 총괄 설정이 있는 그룹의 기존 총괄 문서·역할 정보. 일반 그룹이면 `null`. 기존 `get_context`의 역할별 지침은 유지한다. |
| `documentGroups` | 응답에 관련된 문서들의 위 정보를 `mapId`별로 한 번씩 모은 배열. 원본·대상 문서가 다른 위임, 문서 전환 요청 등은 이 배열로 구분한다. |
| `documentGroupsStatus` | MCP 부가 정보가 확인되면 `available`, 확인하지 못하면 `unavailable`. |
| `previousGroupKnown` | 비활성 문서에 저장된 과거 소속 기록을 확인했는지 여부. 가장 최근 이동 시점의 소속까지 검증했다는 뜻은 아니다. |
| `previousGroupSource` | `archive-origin`은 저장된 보관 원본 소속, `unknown`은 기록 없음. |
| `previousGroup` | 보관 기록의 `originGroupId`에 남은 그룹 `{ id, name: null }`. 복원·이동 후 재보관한 경우 가장 최근 보관 당시 소속과 다를 수 있다. 과거 이름은 현재 이름으로 대체하지 않는다. |

`group: null`만 보고 미소속으로 판단하지 않는다. 비활성 문서의 소속과 영구 삭제한 문서의 존재 여부는 `groupMembership`을 함께 확인한다. 휴지통 이동 당시 그룹을 기록하지 않은 기존 데이터는 `previousGroupKnown: false`로 제공하며 현재 배치나 과거 보관 그룹을 휴지통 이동 당시 그룹으로 추측하지 않는다. 그룹 설정 해제·이름 변경·문서 이동은 다음 조회부터 반영되며 장기 소속 캐시는 사용하지 않는다.

단일 문서 작업은 최상위 `group`으로, 여러 문서 작업은 `documentGroups`로 확인한다. 문서 요약(`document`·`summary`), 목록(`maps`·`trash`), 공유 지식 후보와 알림 항목에도 같은 정보를 붙인다. 원본 `map.nodes`·`map.edges`, 기획·승인·배치 스냅샷, 재구성 계획과 무결성 해시 대상에는 필드를 주입하지 않는다.

위임의 기존 `groupId`·`groupProjectVersion`, 승인 원문과 재구성 `groupBaselines`는 당시 범위·기준이다. 현재 소속 정보로 덮어쓰지 않는다. 소속 표시는 사용자 승인, 위임 권한, 작업공간 선택·점유 근거가 아니며 기존 서버 검증을 우회하지 않는다.

## 적용 범위와 조회 비용

- 문서 목록·개별 문맥·카드·공유 지식 검토, 문서·카드 생성/편집/복원, 대화·작업 상태·위임, 재구성·배치 요청, 알림 목록에 적용한다. 정확한 도구 목록은 `mcp/documentGroupMetadata.mjs`의 `groupAwareToolNames`에서 관리한다.
- 그룹 전용 문맥과 설정 도구는 이미 그룹 전체를 반환하므로 중복 확장하지 않는다. 계정·작업공간 풀·체크포인트와 단순 댓글/반응·지식선 조작도 불필요한 그룹 조회를 하지 않는다.
- 인증된 읽기 전용 `GET /api/document-groups?mapId=...`는 최대 60개 문서를 묶어 처리한다. 최신 활성 목록·배치를 한 번 읽고 관련 그룹 설정도 그룹당 한 번만 읽는다. 실제 문서 목록 API가 이미 준 `documentGroups`는 MCP에서 재사용한다.
- 내부 `listMaps`는 기존의 문서 수집·정렬 함수로 유지한다. 여기에 `groupProjects.forDocument`를 넣어 `listMaps`를 재귀 호출하거나 문서 수만큼 전체 그룹 문맥을 읽지 않는다.

그룹 부가 정보 조회만 실패했다면 MCP는 기존 성공 결과를 유지하고 `documentGroupsStatus: unavailable`과 `documentGroupsWarning`을 붙인다. 문서 목록 API도 그룹 설정 읽기 실패로 목록 전체를 차단하지 않는다. 저장·위임을 반복하지 말고 조회 도구로 소속만 재확인한다. 최초 문서 조회 자체가 실패한 경우까지 성공으로 바꾸지는 않는다.

## 적용과 검증

서버 재시작과 기존 MCP 연결의 재연결이 필요하다. 기존 대화 전문·카드·댓글·승인·위임 기록은 자동 수정하지 않는다. 재시작은 사용자와 조율해 수행한다.

검증은 `tests/document-group-metadata.test.mjs` 및 `tests/document-group-metadata-api.test.mjs`로 실행한다. 일반 그룹·총괄 역할·미소속, 그룹 이름 변경·문서 이동, 보관·휴지통의 미확인 기록, 조회 시 파일 무변경, 부가 조회 실패 시 성공 결과 보존, 요청 분할과 도구 수 유지를 확인한다. 실제 사용자 데이터가 아닌 임시 서버·문서와 격리 MCP 연결만 사용한다.
