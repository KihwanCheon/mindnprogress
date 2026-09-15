# AionUi에서 MindNProgress 카드 선택

AionUi 백엔드는 현재 대화가 MindNProgress 카드에 연결되어 있는지 조회하고, 사용자가 요청하면 같은 계정과 디바이스로 열어 둔 MindNProgress 화면에서 해당 문서와 카드를 선택할 수 있다. 로컬과 외부 접속에 같은 규칙을 적용하며 다른 사용자나 다른 디바이스의 화면에는 선택 이벤트를 보내지 않는다.

브라우저에 MindNProgress 연동 토큰을 노출하지 않도록 두 API는 AionUi 백엔드에서 호출한다.

## 인증과 선택 식별자

두 API 모두 MindNProgress 데이터 폴더의 `_integration-token` 값을 Bearer 토큰으로 사용한다.

```http
Authorization: Bearer {integration-token}
X-MNP-AI-Editor-Id: {현재 AionUi 사용자와 연결된 MindNProgress 사용자 ID}
X-MNP-Selection-Device-Address: {AionUi 브라우저의 원본 접속 IP 주소}
```

`X-MNP-AI-Editor-Id`는 활성화된 MindNProgress 편집자 또는 관리자 계정이어야 한다. AionUi 백엔드는 인증된 현재 사용자에 대응하는 ID를 서버 측에서 정해야 하며 브라우저가 보낸 임의 값을 그대로 전달하면 안 된다.

`X-MNP-Selection-Device-Address`도 AionUi 백엔드가 요청 소켓 또는 신뢰하는 프록시 체인에서 구한 원본 브라우저 주소를 사용한다. AionUi 백엔드가 사용자 디바이스에서 직접 실행되어 MindNProgress를 호출한다면 이 헤더를 생략할 수 있고, 이때 MindNProgress는 요청 소켓 주소를 사용한다. 중앙 AionUi 서버가 외부 브라우저 요청을 중계한다면 반드시 이 헤더를 보낸다.

MindNProgress는 주소를 정규화한 뒤 해시만 SSE 접속 정보에 보관한다. 주소 원문이나 해시는 API 응답에 포함하지 않는다.

## 연결 조회

```http
GET /api/integrations/aionui/conversations/{conversationId}/mindnprogress
```

카드에 연결된 대화는 `exists: true`와 현재 문서·카드 정보를 반환한다. 연결되지 않은 대화도 예상 가능한 조회 결과이므로 HTTP 200과 `exists: false`, `target: null`을 반환한다. AionUi 아이콘 표시 여부는 `exists`로 판단한다.

`selectionAvailable`은 대화 연결이 존재하고 현재 요청의 계정·디바이스와 일치하는 MindNProgress SSE 화면이 하나 이상 연결되어 있음을 뜻한다. `matchingViewCount`는 그 화면 수다. 기존 `localSelectionAvailable`과 `localViewCount`는 이전 AionUi 구현과의 응답 호환을 위해 유지하지만 새 코드의 선택 가능 여부 판정에는 사용하지 않는다.

```json
{
  "conversationId": "2b31432e",
  "exists": true,
  "target": {
    "mapId": "map-123",
    "documentTitle": "총괄 문서",
    "cardId": "card-456",
    "cardTitle": "연결 기능",
    "archived": false
  },
  "selectionAvailable": true,
  "matchingViewCount": 1,
  "localSelectionAvailable": false,
  "localViewCount": 0,
  "message": "MindNProgress에 연결된 대화입니다."
}
```

## 같은 계정·디바이스 화면 선택

```http
POST /api/integrations/aionui/conversations/{conversationId}/mindnprogress/select
```

MindNProgress는 현재 SSE 연결 가운데 다음 조건을 모두 만족하는 화면에만 선택 이벤트를 보낸다.

- SSE 화면의 로그인 계정 ID가 `X-MNP-AI-Editor-Id`와 같다.
- SSE 화면과 AionUi 브라우저의 정규화된 원본 접속 주소가 같다.

성공 응답은 `selected: true`, 선택 대상, 실제 이벤트를 받은 `deliveredClientCount`를 포함한다. MnP 화면은 이벤트를 받으면 문서와 카드 상세를 열고 카드 노드 선택 상태도 마우스로 클릭했을 때와 동일하게 갱신한다.

주요 실패 응답은 다음과 같다.

- `400 MNP_SELECTION_ACCOUNT_REQUIRED`: MnP 사용자 ID가 없음
- `400 MNP_SELECTION_DEVICE_ADDRESS_INVALID`: 전달한 원본 접속 주소가 IP 주소가 아님
- `400 MNP_SELECTION_DEVICE_REQUIRED`: 비교할 디바이스 주소를 확인할 수 없음
- `403 MNP_SELECTION_ACCOUNT_UNAVAILABLE`: 계정이 없거나 비활성 또는 편집 권한 없음
- `404 MNP_AI_CONVERSATION_NOT_FOUND`: 연결된 문서·카드를 찾을 수 없음
- `409 MNP_MATCHING_VIEW_NOT_CONNECTED`: 같은 계정·디바이스의 MnP 화면이 현재 연결되어 있지 않음

## 네트워크 경계

이 계약에서 디바이스 경계는 두 서비스가 관측한 원본 클라이언트 IP 주소다. 역방향 프록시는 신뢰할 수 있는 방식으로 실제 주소를 보존해야 한다. 같은 계정의 여러 물리 디바이스가 동일 NAT 공인 주소를 공유하는 환경까지 서로 구분해야 한다면 후속으로 두 앱이 공유하는 불투명 장치 ID 또는 페어링 토큰 계약이 필요하다.
