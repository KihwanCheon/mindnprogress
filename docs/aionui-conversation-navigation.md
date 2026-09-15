# AionUi에서 MindNProgress 카드 선택

AionUi 백엔드는 현재 대화가 MindNProgress 카드에 연결되어 있는지 조회하고, 사용자가 요청하면 로컬 MindNProgress 화면에서 해당 문서와 카드를 선택할 수 있다. 브라우저에 MindNProgress 연동 토큰을 노출하지 않도록 두 API는 AionUi 백엔드에서 호출한다.

## 인증

두 API 모두 MindNProgress 데이터 폴더의 `_integration-token` 값을 Bearer 토큰으로 사용한다.

```http
Authorization: Bearer {integration-token}
```

## 연결 조회

```http
GET /api/integrations/aionui/conversations/{conversationId}/mindnprogress
```

카드에 연결된 대화는 `exists: true`와 현재 문서·카드 정보를 반환한다. 연결되지 않은 대화도 예상 가능한 조회 결과이므로 HTTP 200과 `exists: false`, `target: null`을 반환한다. AionUi 아이콘 표시 여부는 `exists`로 판단한다. `localSelectionAvailable`은 현재 `127.0.0.1`로 열린 MindNProgress SSE 화면이 하나 이상 연결되어 있는지를 함께 나타낸다.

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
  "localSelectionAvailable": true,
  "localViewCount": 1,
  "message": "MindNProgress에 연결된 대화입니다."
}
```

## 로컬 화면 선택

```http
POST /api/integrations/aionui/conversations/{conversationId}/mindnprogress/select
```

이 요청은 AionUi 백엔드가 MindNProgress의 `127.0.0.1` 주소로 호출해야 한다. 서버는 요청의 실제 접속 주소와 Host를 모두 확인하며, 원격 또는 LAN 주소 요청에는 `403 MNP_LOCAL_SELECTION_REQUIRED`를 반환한다. 선택 이벤트도 연결 당시 로컬 요청으로 판정된 SSE 클라이언트에만 전달하므로 웹으로 접속한 다른 사용자의 화면은 바뀌지 않는다.

성공 응답은 `selected: true`, 선택 대상, 실제 이벤트를 받은 `deliveredClientCount`를 포함한다. 로컬 화면이 열려 있지 않으면 `409 MNP_LOCAL_VIEW_NOT_CONNECTED`, 연결이 제거됐거나 문서·카드를 찾지 못하면 `404 MNP_AI_CONVERSATION_NOT_FOUND`를 반환한다.
