import assert from 'node:assert/strict'
import test from 'node:test'
import {
  analyzeSharedKnowledgeText,
  buildSharedKnowledgeAudit,
  sharedKnowledgeAuditThresholds,
} from '../server/lib/sharedKnowledgeAudit.mjs'

test('공유 지식의 구조와 정확히 반복된 문장을 본문 노출 없이 집계한다', () => {
  const text = [
    '# 현재 결론',
    '- 검증된 결론 문장입니다.',
    '- 검증된 결론 문장입니다.',
    '',
    '1. 다른 적용 조건입니다.',
  ].join('\n')
  const result = analyzeSharedKnowledgeText(text)

  assert.equal(result.length, text.length)
  assert.ok(result.utf8Bytes > result.length)
  assert.match(result.sha256, /^[a-f0-9]{64}$/)
  assert.equal(result.paragraphCount, 2)
  assert.equal(result.nonEmptyLineCount, 4)
  assert.equal(result.listItemCount, 3)
  assert.equal(result.exactDuplicateStatementGroupCount, 1)
  assert.equal(result.exactDuplicateStatementCount, 1)
  assert.equal(result.lengthLevel, 'normal')
  assert.equal(result.reviewLevel, 'attention')
  assert.deepEqual(result.reasons, ['exact-duplicate-statements'])
  assert.equal(JSON.stringify(result).includes('검증된 결론'), false)
})

test('글자 수 임계값에 따라 관심·정리 권장·우선 정리 단계를 구분한다', () => {
  const { attentionCharacters, recommendedCharacters, priorityCharacters } = sharedKnowledgeAuditThresholds
  assert.equal(analyzeSharedKnowledgeText('가'.repeat(attentionCharacters - 1)).reviewLevel, 'normal')
  assert.equal(analyzeSharedKnowledgeText('가'.repeat(attentionCharacters)).reviewLevel, 'attention')
  assert.equal(analyzeSharedKnowledgeText('가'.repeat(recommendedCharacters)).reviewLevel, 'recommended')
  assert.equal(analyzeSharedKnowledgeText('가'.repeat(priorityCharacters)).reviewLevel, 'priority')
  assert.equal(analyzeSharedKnowledgeText('가'.repeat(priorityCharacters)).limitUsagePercent, 80)
})

test('활성 문서의 공유 지식 카드와 실제 지식선 소비자를 우선순위대로 집계한다', () => {
  const sourceKnowledge = `외부에 노출되면 안 되는 원문\n${'가'.repeat(5_100)}`
  const priorityKnowledge = '나'.repeat(8_100)
  const audit = buildSharedKnowledgeAudit([
    {
      id: 'map-a',
      title: '첫 문서',
      version: 3,
      updatedAt: '2026-08-18T00:00:00.000Z',
      nodes: [
        { id: 'source', data: { label: '공급 카드', kind: 'branch', sharedKnowledge: sourceKnowledge } },
        { id: 'consumer', data: { label: '소비 카드', kind: 'task' } },
        { id: 'reference', data: { label: '참조 카드', sharedKnowledge: priorityKnowledge, reference: { mapId: 'map-b', nodeId: 'root' } } },
      ],
      edges: [
        { source: 'source', target: 'consumer', data: { relation: 'knowledge' } },
        { source: 'source', target: 'consumer', data: { relation: 'knowledge' } },
      ],
    },
    {
      id: 'map-b',
      title: '둘째 문서',
      version: 1,
      nodes: [{ id: 'root', data: { label: '짧은 카드', sharedKnowledge: '짧은 지식' } }],
      edges: [],
    },
    {
      id: 'map-trashed',
      title: '휴지통 문서',
      trashedAt: '2026-08-18T00:00:00.000Z',
      nodes: [{ id: 'trashed', data: { sharedKnowledge: priorityKnowledge } }],
      edges: [],
    },
  ], { generatedAt: '2026-08-18T01:00:00.000Z' })

  assert.equal(audit.generatedAt, '2026-08-18T01:00:00.000Z')
  assert.equal(audit.summary.documentCount, 2)
  assert.equal(audit.summary.cardCount, 4)
  assert.equal(audit.summary.cardsWithSharedKnowledge, 3)
  assert.equal(audit.summary.actionableCandidateCount, 1)
  assert.equal(audit.summary.referenceCardCount, 1)
  assert.deepEqual(audit.candidates.map((card) => card.cardId), ['source'])
  assert.equal(audit.candidates[0].consumerCount, 1)
  assert.deepEqual(audit.candidates[0].consumerCardIds, ['consumer'])
  assert.equal(audit.documents[0].cards.find((card) => card.cardId === 'reference').maintenanceMode, 'source-card-only')
  assert.equal(audit.documents[0].cards.find((card) => card.cardId === 'reference').actionable, false)
  assert.equal(JSON.stringify(audit).includes('외부에 노출되면 안 되는 원문'), false)
})
