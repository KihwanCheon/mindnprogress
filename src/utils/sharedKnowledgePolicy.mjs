export const sharedKnowledgeMaxLength = 15_000

export const sharedKnowledgeAuthoringPolicy = Object.freeze({
  purpose: '공유 지식은 수행 보고가 아니라 다른 카드·후속 담당자의 판단·구현·사용에 필요한 현재 유효한 지식의 최신본입니다.',
  writeWhen: '일반 작업에서는 그 판단이나 행동을 바꾸는 새 결론 또는 기존 결론의 변경이 있을 때만 갱신하세요. 작업·검증을 했다는 사실만으로 추가하지 말고, 새 지식이 없으면 변경하지 마세요.',
  keep: Object.freeze(['현재의 확정 결정·제약', '소비자가 알아야 할 API·사용 조건·주의점', '판단에 필요한 검증된 결론과 적용 범위·남은 한계', '확인 가능한 원문·근거 링크']),
  exclude: Object.freeze(['시간순 진행·시행착오 기록', '도구 호출·원문 로그', '업무 설명·댓글·하위 완료 보고의 복사', '소비 판단에 필요 없는 시험 횟수·측정값·SHA 나열', '중복·대체된 결론']),
  update: '갱신 시 전체 원문과 대조해 같은 주제의 기존 절을 최신 결론으로 통합하고 무관한 유효 정보는 보존하세요. 변경된 절은 해시 조건부 부분 수정하고, 전체 재작성은 승인된 정리 범위에서 원문 보존과 버전·해시 확인 후 수행하세요.',
  preserve: '사용자 요구사항과 소비 카드가 의존하는 조건은 보존하세요. 유효성이 불명확한 내용은 임의 삭제하거나 확정 사실로 승격하지 말고 확인 필요로 구분하세요.',
  history: '진행·완료·검증 이력은 댓글과 기존 보고서·산출물에 기록하세요. 정리로 상세를 덜어낼 때는 원문 보존과 실제 참조 위치를 확인하고 출처를 꾸며내지 마세요.',
  capacity: '용량이 부족하면 같은 추가 요청을 반복하지 말고 새 기록의 필요성과 기존 절에 통합할 수 있는지 먼저 판단하세요. 현재 작업의 같은 주제 갱신은 해시 조건부 부분 수정하고, 전체 정리가 필요하면 원문·소비 관계를 확인해 정리안을 제시하고 카드별 승인을 받으세요. 한도를 이유로 유효 지식을 임의 삭제하지 마세요.',
  length: '15,000자는 상한이지 작성 목표가 아닙니다. 필요한 지식을 간결하게 유지하되 글자 수만 맞추려고 유효 정보를 삭제하지 마세요.',
})

export const SHARED_KNOWLEDGE_WRITE_INSTRUCTION = [
  sharedKnowledgeAuthoringPolicy.purpose,
  sharedKnowledgeAuthoringPolicy.writeWhen,
  sharedKnowledgeAuthoringPolicy.update,
].join(' ')

export const sharedKnowledgeAuditThresholds = Object.freeze({
  attentionCharacters: 5_000,
  recommendedCharacters: 8_000,
  priorityCharacters: 12_000,
  limitCharacters: sharedKnowledgeMaxLength,
})
