import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AI_EDITOR_REQUEST_MAX_LENGTH,
  aiConversationTitle,
  buildAiConversationPrompt,
  buildAiDelegationModelInstruction,
  combineAiEditorRequest,
  buildSharedKnowledgeCleanupLaunch,
  buildSharedKnowledgeCleanupRequest,
  DEFAULT_AI_EDITOR_REQUEST,
  isAiConversationPurpose,
  normalizeAiCardTitle,
  normalizeAiEditorRequest,
  normalizeAiAutomaticRequest,
  resolveAiConversationTarget,
} from '../src/utils/aiConversationLaunch.mjs'
import { SHARED_KNOWLEDGE_WRITE_INSTRUCTION, sharedKnowledgeAuthoringPolicy } from '../src/utils/sharedKnowledgePolicy.mjs'

const selection = {
  open: true,
  mapId: 'map-current',
  cardId: 'node-selected',
  cardLabel: '선택한 카드 (ref)',
  cardKind: 'task',
  isReference: false,
  documentTitle: '현재 문서',
  knowledgeSources: [{ id: 'node-source', label: '선행 지식', policy: 'reuse-first' }],
}

test('Dooray 승인은 담당 카드가 없어도 새 대화를 열고 승인 근거 확인 전문을 보존한다', () => {
  const doorayApproval = { responseId: 'dooray-request1', proposalRevision: 'a'.repeat(64) }
  const initialRequest = '승인 제안 전문\n' + '상세 조건\n'.repeat(1500) + '마지막 문장'
  const target = resolveAiConversationTarget({ explicitTarget: { purpose: 'dooray-response', mapId: '', cardId: '', doorayApproval, fullInitialRequest: true, initialRequest }, selection })
  assert.equal(target.mapId, '')
  assert.deepEqual(target.doorayApproval, doorayApproval)
  assert.equal(target.initialRequest, initialRequest)
  const prompt = buildAiConversationPrompt({ purpose: target.purpose, doorayApproval, mapId: '', cardId: '', editorId: 'user1', attributionToken: 'token', request: initialRequest })
  assert.ok(prompt.includes(initialRequest))
  assert.match(prompt, /mindnprogress_get_dooray_response_approval/)
  assert.match(prompt, /서버에 저장된 사용자 승인을 검증/)
  assert.equal(resolveAiConversationTarget({ explicitTarget: { purpose: 'dooray-response', mapId: '', cardId: '' } }), null)
})

test('담당 카드 전달 전문은 4,000자 뒤의 제안·URL·재제안 지침까지 보존한다', () => {
  const proposal = `# 전달 제안\n${'긴 제안 내용입니다.\n'.repeat(600)}\nhttps://example.test/post#comment\n실행하지 말고 다시 제안하세요.`
  const target = resolveAiConversationTarget({ explicitTarget: { mapId: 'map1', cardId: 'card1', initialRequest: proposal, fullInitialRequest: true }, selection })
  assert.equal(target.initialRequest, proposal)
  assert.equal(target.fullInitialRequest, true)
  assert.equal(normalizeAiAutomaticRequest(proposal, true), proposal)
  const request = combineAiEditorRequest(target.initialRequest, '추가 요청', target.fullInitialRequest)
  assert.equal(request, `${proposal}\n\n# 사용자 요청\n추가 요청`)
  assert.ok(buildAiConversationPrompt({ mapId: 'map1', cardId: 'card1', editorId: 'user1', attributionToken: 'token', request }).includes(proposal))
  assert.equal(normalizeAiAutomaticRequest(proposal).length, AI_EDITOR_REQUEST_MAX_LENGTH)
  assert.throws(() => normalizeAiAutomaticRequest('가'.repeat(100001), true), /임의로 자르지/)
})

const reviewContext = {
  document: { id: 'map-other', title: '다른 문서' },
  card: { id: 'node-candidate', label: '정리 후보 카드', textIntegrity: { length: 8_432 } },
  candidate: { reviewLevel: 'recommended', limitUsagePercent: 56.2, exactDuplicateStatementCount: 3 },
  relations: { totals: { knowledgeConsumers: 2 } },
}

test('서술형 위임 설정은 선택형과 섞지 않고 원문 줄바꿈과 사용자 요청 경계를 보존한다', () => {
  const narrativeText = '구현은 Claude Code의 Opus를 사용하세요.\n검수는 Codex로 위임하세요.'
  const instruction = buildAiDelegationModelInstruction({ narrativeMode: true, narrativeText, agentName: '선택형 AI', model: '선택형 모델' })
  assert.equal(instruction, `하위 카드에 업무를 위임할 때 다음 AI 설정을 사용하세요:\n${narrativeText}`)
  assert.equal(combineAiEditorRequest('자동 요청', '추가 요청', false, instruction), `자동 요청\n\n${instruction}\n\n# 사용자 요청\n추가 요청`)
  for (const narrativeText of ['', ' \n ']) assert.equal(buildAiDelegationModelInstruction({ narrativeMode: true, narrativeText, agentName: '선택형 AI' }), '')
  assert.equal(buildAiDelegationModelInstruction({ narrativeMode: false, narrativeText, agentName: '선택형 AI' }), '하위 카드에 업무를 위임할 때 다음 AI 설정을 사용하세요: AI 종류 `선택형 AI`.')
})

test('선택 카드가 없어도 바로 지정한 카드로 대화 대상을 만든다', () => {
  const target = resolveAiConversationTarget({
    explicitTarget: { mapId: 'map-other', cardId: 'node-candidate', cardTitle: '정리 후보 카드', documentTitle: '다른 문서', initialRequest: '정리안을 제안해 주세요.' },
    selection: null,
  })
  assert.deepEqual(target, {
    source: 'explicit',
    purpose: 'card',
    mapId: 'map-other',
    cardId: 'node-candidate',
    cardTitle: '정리 후보 카드',
    documentTitle: '다른 문서',
    knowledgeSources: [],
    initialRequest: '정리안을 제안해 주세요.',
  })
})

test('바로 지정한 카드는 선택 카드보다 우선한다', () => {
  const target = resolveAiConversationTarget({
    explicitTarget: { mapId: 'map-other', cardId: 'node-candidate' },
    selection,
  })
  assert.equal(target.mapId, 'map-other')
  assert.equal(target.cardId, 'node-candidate')
  assert.equal(target.cardTitle, 'node-candidate')
  assert.deepEqual(target.knowledgeSources, [])
  assert.equal(target.initialRequest, undefined)
})

test('선택 카드 경로는 기존 대상 계산을 유지한다', () => {
  const target = resolveAiConversationTarget({ explicitTarget: null, selection })
  assert.deepEqual(target, {
    source: 'selection',
    purpose: 'card',
    mapId: 'map-current',
    cardId: 'node-selected',
    cardTitle: '선택한 카드',
    documentTitle: '현재 문서',
    knowledgeSources: selection.knowledgeSources,
  })
})

test('Ref 카드는 선행 지식 목록을 넘기지 않는다', () => {
  const target = resolveAiConversationTarget({ selection: { ...selection, isReference: true } })
  assert.deepEqual(target.knowledgeSources, [])
})

test('열려 있지 않거나 대상이 없으면 대화를 시작하지 않는다', () => {
  assert.equal(resolveAiConversationTarget({ selection: { ...selection, open: false } }), null)
  assert.equal(resolveAiConversationTarget({ selection: { ...selection, cardKind: 'image' } }), null)
  assert.equal(resolveAiConversationTarget({ selection: { ...selection, documentTitle: null } }), null)
  assert.equal(resolveAiConversationTarget({ selection: { ...selection, mapId: '' } }), null)
  assert.equal(resolveAiConversationTarget({ explicitTarget: { mapId: 'map-other' } }), null)
  assert.equal(resolveAiConversationTarget({}), null)
  assert.equal(resolveAiConversationTarget(), null)
})

test('카드 제목의 ref 접미사만 정리한다', () => {
  assert.equal(normalizeAiCardTitle('카드 이름 (ref)'), '카드 이름')
  assert.equal(normalizeAiCardTitle('카드 (REF) '), '카드')
  assert.equal(normalizeAiCardTitle('참조(reference) 카드'), '참조(reference) 카드')
  assert.equal(normalizeAiCardTitle(undefined), '')
})

test('대화 용도에 따라 제목을 만들고 접두사를 보존한 채 120자로 제한한다', () => {
  assert.equal(aiConversationTitle({ documentTitle: '문서', cardTitle: '카드' }), '문서: 카드')
  assert.equal(aiConversationTitle({
    purpose: 'shared-knowledge-review',
    documentTitle: '문서\n제목',
    cardTitle: '카드   제목',
  }), '[지식정리] 문서 제목: 카드 제목')
  const longTitle = aiConversationTitle({
    purpose: 'shared-knowledge-review',
    documentTitle: '문서',
    cardTitle: '카드'.repeat(100),
  })
  assert.equal(longTitle.length, 120)
  assert.ok(longTitle.startsWith('[지식정리] '))
  assert.equal(isAiConversationPurpose('card'), true)
  assert.equal(isAiConversationPurpose('shared-knowledge-review'), true)
  assert.equal(isAiConversationPurpose('unknown'), false)
})

test('문서 최상위 대화는 상위 접두어를 붙이고 별도 용도의 접두어를 우선한다', () => {
  const target = { documentTitle: '문서', cardTitle: '루트', isDocumentRoot: true }
  assert.equal(aiConversationTitle(target), '[상위] 문서: 루트')
  assert.equal(aiConversationTitle({ ...target, isDocumentRoot: false }), '문서: 루트')
  for (const [purpose, prefix] of [
    ['group-coordination', '[그룹 총괄]'], ['shared-knowledge-review', '[지식정리]'],
    ['document-reconstruction', '[문서 정리]'], ['card-layout', '[배치 제안]'], ['dooray-response', '[Dooray 승인]'],
  ]) assert.equal(aiConversationTitle({ ...target, purpose }), `${prefix} 문서: 루트`)
  const longTitle = aiConversationTitle({ ...target, cardTitle: '긴 제목'.repeat(100) })
  assert.equal(longTitle.length, 120)
  assert.ok(longTitle.startsWith('[상위] '))
})

test('전문은 대상 식별자와 편집자 요청을 그대로 담는다', () => {
  const prompt = buildAiConversationPrompt({
    mapId: 'map-other',
    cardId: 'node-candidate',
    editorId: 'user-editor',
    attributionToken: 'token-1',
    request: '  정리안을 제안해 주세요.  ',
  })
  assert.match(prompt, /^# MindNProgress 작업 요청/)
  assert.ok(prompt.includes('- mapId: `map-other`'))
  assert.ok(prompt.includes('- cardId: `node-candidate`'))
  assert.ok(prompt.includes('- editorId: `user-editor`'))
  assert.ok(prompt.includes('- attributionToken: `token-1`'))
  assert.ok(prompt.includes('mindnprogress_get_context'))
  assert.ok(prompt.includes('한 번 성공적으로 호출'))
  assert.ok(prompt.includes('응답을 받지 못한 시도는 성공 호출로 보지 말고'))
  assert.ok(prompt.includes('호출 시점의 초기 스냅샷'))
  assert.ok(prompt.includes('최신 상태 갱신만을 목적으로'))
  assert.ok(prompt.includes('guide.contextLifecycle'))
  assert.ok(prompt.endsWith('# 편집자 요청\n\n정리안을 제안해 주세요.'))
})

test('자동 적용 내용 뒤에 사용자 입력을 별도 사용자 요청 절로 붙인다', () => {
  assert.equal(
    combineAiEditorRequest('  자동 적용 내용  ', '  추가 정보 또는 요청  '),
    '자동 적용 내용\n\n# 사용자 요청\n추가 정보 또는 요청',
  )
  assert.equal(combineAiEditorRequest('', '사용자 요청'), '# 사용자 요청\n사용자 요청')
  for (const emptyInput of ['', ' \n\t ', undefined, null]) {
    assert.equal(combineAiEditorRequest('자동 적용 내용', emptyInput), '자동 적용 내용')
    assert.equal(combineAiEditorRequest('', emptyInput), '')
  }
})

test('사용자 요청 본문의 줄바꿈과 4,000자 입력 한도를 제목과 별개로 보존한다', () => {
  const multiline = '첫 번째 요청\n\n## 확인 항목\n- 두 번째 요청'
  assert.equal(combineAiEditorRequest('자동 적용 내용', multiline), `자동 적용 내용\n\n# 사용자 요청\n${multiline}`)
  const maximumInput = '가'.repeat(AI_EDITOR_REQUEST_MAX_LENGTH)
  assert.equal(combineAiEditorRequest('', maximumInput), `# 사용자 요청\n${maximumInput}`)
  assert.equal(combineAiEditorRequest('', `${maximumInput}초과`), `# 사용자 요청\n${maximumInput}`)
})

test('일반·총괄·Dooray 최종 전달 전문 모두 사용자 요청 제목과 본문을 보존한다', () => {
  const userInput = '첫 번째 요청\n\n두 번째 요청'
  for (const purpose of ['card', 'group-coordination', 'dooray-response']) {
    const prompt = buildAiConversationPrompt({
      purpose, mapId: 'map-test', cardId: 'card-test', editorId: 'editor-test', attributionToken: 'token-test',
      doorayApproval: { responseId: 'dooray-test', proposalRevision: 'a'.repeat(64) },
      request: combineAiEditorRequest('자동 적용 내용', userInput),
    })
    assert.ok(prompt.endsWith(`자동 적용 내용\n\n# 사용자 요청\n${userInput}`))
    assert.equal(prompt.match(/^# 사용자 요청$/gm)?.length, 1)
  }
})

test('위임 모델은 선택한 항목만 전문에 추가하고 모두 비우면 기존 요청을 유지한다', () => {
  assert.equal(buildAiDelegationModelInstruction(), '')
  assert.equal(buildAiDelegationModelInstruction({ agentName: '', model: '이전 모델' }), '')
  const agentOnly = buildAiDelegationModelInstruction({ agentName: 'Claude Code' })
  assert.equal(agentOnly, '하위 카드에 업무를 위임할 때 다음 AI 설정을 사용하세요: AI 종류 `Claude Code`.')
  const withModel = buildAiDelegationModelInstruction({ agentName: 'Claude Code', model: 'Opus' })
  assert.equal(withModel, '하위 카드에 업무를 위임할 때 다음 AI 설정을 사용하세요: AI 종류 `Claude Code`, 모델 `Opus`.')
  for (const [key, label, value] of [['mode', '권한', '편집 허용'], ['thoughtLevel', '사고 수준', '높음']]) {
    const instruction = buildAiDelegationModelInstruction({ agentName: 'Claude Code', [key]: value })
    assert.ok(instruction.includes(`${label} \`${value}\``))
    assert.ok(!instruction.includes('모델 `'), '권한·사고 수준을 고르더라도 모델은 자동 지정하지 않는다')
  }
  assert.equal(combineAiEditorRequest('기본 요청', '추가 요청', false, ''), '기본 요청\n\n# 사용자 요청\n추가 요청')
  assert.equal(combineAiEditorRequest('기본 요청', '추가 요청', false, withModel), `기본 요청\n\n${withModel}\n\n# 사용자 요청\n추가 요청`)
})

test('기본 전문이 길어도 위임 설정을 자르지 않고 긴 승인 전문도 보존한다', () => {
  const instruction = buildAiDelegationModelInstruction({ agentName: 'Claude Code', model: 'Opus', mode: '편집 허용', thoughtLevel: '높음' })
  const ordinary = '가'.repeat(AI_EDITOR_REQUEST_MAX_LENGTH)
  const preview = combineAiEditorRequest(ordinary, '', false, instruction)
  const request = combineAiEditorRequest(ordinary, '사용자 추가 요청', false, instruction)
  assert.equal(preview, `${ordinary}\n\n${instruction}`)
  assert.equal(request, `${preview}\n\n# 사용자 요청\n사용자 추가 요청`)
  const approval = `${ordinary}승인 전문 마지막 조건`
  assert.equal(combineAiEditorRequest(approval, '추가 요청', true, instruction), `${approval}\n\n${instruction}\n\n# 사용자 요청\n추가 요청`)
})

test('전문 조립에 필요한 값이 없으면 실패로 알린다', () => {
  assert.throws(() => buildAiConversationPrompt({ mapId: 'map-other', cardId: 'node-candidate', editorId: 'user-editor', attributionToken: 'token-1', request: '   ' }), /정보가 부족/)
  assert.throws(() => buildAiConversationPrompt({ cardId: 'node-candidate', editorId: 'user-editor', attributionToken: 'token-1', request: '요청' }), /정보가 부족/)
})

test('정리 제안 전문은 자동 저장을 금지하고 검토 문맥 조회를 지시한다', () => {
  const request = buildSharedKnowledgeCleanupRequest(reviewContext)
  assert.ok(request.includes('mindnprogress_get_shared_knowledge_review_context'))
  assert.ok(request.includes('`mindnprogress_apply_shared_knowledge_review`를 호출하지 마세요.'))
  assert.ok(request.includes('공유 지식을 직접 고치지 마세요'))
  assert.ok(request.includes('지식선으로 소비하는 카드가 재사용하는 내용은 지우지 마세요'))
  assert.match(request, /공유 지식 전체를 현재 기준의 최신본으로 재구성/)
  assert.ok(request.includes(sharedKnowledgeAuthoringPolicy.keep.join(', ')))
  assert.ok(request.includes(sharedKnowledgeAuthoringPolicy.exclude.join(', ')))
  assert.ok(request.includes(sharedKnowledgeAuthoringPolicy.preserve))
  assert.ok(request.includes(sharedKnowledgeAuthoringPolicy.history))
  assert.ok(request.includes(sharedKnowledgeAuthoringPolicy.length))
  assert.ok(request.includes('- 공유 지식 8,432자 (15,000자 제한의 56.2%) · 검토 수준 정리 권장'))
  assert.ok(request.includes('완전히 같은 문장 반복 3건 · 이 공유 지식을 지식선으로 쓰는 카드 2개'))
  assert.ok(request.length <= AI_EDITOR_REQUEST_MAX_LENGTH)
})

test('제한 사용률이 소수여도 버리지 않고 그대로 알린다', () => {
  const request = buildSharedKnowledgeCleanupRequest({
    ...reviewContext,
    card: { ...reviewContext.card, textIntegrity: { length: 6_040 } },
    candidate: { reviewLevel: 'attention', limitUsagePercent: 40.3, exactDuplicateStatementCount: 0 },
  })
  assert.ok(request.includes('- 공유 지식 6,040자 (15,000자 제한의 40.3%) · 검토 수준 확인 필요'))
})

test('지표가 없어도 정리 제안 전문을 만든다', () => {
  const request = buildSharedKnowledgeCleanupRequest({})
  assert.ok(!request.includes('- 공유 지식 '))
  assert.ok(request.includes('완전히 같은 문장 반복 0건 · 이 공유 지식을 지식선으로 쓰는 카드 0개'))
  assert.ok(request.includes('mindnprogress_get_shared_knowledge_review_context'))
})

test('검토 문맥에서 정리 제안 대상과 전문을 함께 만든다', () => {
  const launch = buildSharedKnowledgeCleanupLaunch(reviewContext)
  assert.equal(launch.purpose, 'shared-knowledge-review')
  assert.equal(launch.mapId, 'map-other')
  assert.equal(launch.cardId, 'node-candidate')
  assert.equal(launch.cardTitle, '정리 후보 카드')
  assert.equal(launch.documentTitle, '다른 문서')
  assert.equal(launch.initialRequest, buildSharedKnowledgeCleanupRequest(reviewContext))

  const target = resolveAiConversationTarget({ explicitTarget: launch, selection })
  assert.equal(target.mapId, 'map-other')
  assert.equal(target.cardId, 'node-candidate')
  assert.equal(target.purpose, 'shared-knowledge-review')
  assert.equal(target.initialRequest, launch.initialRequest)
})

test('검토 문맥에 문서나 카드 식별자가 없으면 대상을 만들지 않는다', () => {
  assert.equal(buildSharedKnowledgeCleanupLaunch({ card: { id: 'node-candidate' } }), null)
  assert.equal(buildSharedKnowledgeCleanupLaunch({ document: { id: 'map-other' } }), null)
  assert.equal(buildSharedKnowledgeCleanupLaunch(), null)
})

test('기본 요구 문구는 카드 검토 진입점 문구를 유지한다', () => {
  assert.ok(DEFAULT_AI_EDITOR_REQUEST.startsWith('이 카드의 최신 내용을 검토하세요.'))
  assert.match(DEFAULT_AI_EDITOR_REQUEST, /개발 계획을 세우거나 카드를 정비할 때.*구현·검증 조건이 2개 이상.*결과 중심 체크리스트/)
  assert.match(DEFAULT_AI_EDITOR_REQUEST, /별도 하위 카드.*체크리스트에 중복하지 말고/)
  assert.ok(DEFAULT_AI_EDITOR_REQUEST.includes(SHARED_KNOWLEDGE_WRITE_INSTRUCTION))
  assert.ok(DEFAULT_AI_EDITOR_REQUEST.includes('그다음 수행할 작업을 우선순위와 완료 조건을 포함해 제안해 주세요.'))
  assert.equal(DEFAULT_AI_EDITOR_REQUEST, DEFAULT_AI_EDITOR_REQUEST.trim())
  assert.ok(DEFAULT_AI_EDITOR_REQUEST.length <= AI_EDITOR_REQUEST_MAX_LENGTH)
})

test('편집자 요청 문구는 상한을 넘기지 않는다', () => {
  assert.equal(normalizeAiEditorRequest('  요청  '), '요청')
  assert.equal(normalizeAiEditorRequest(42), '')
  assert.equal(normalizeAiEditorRequest('가'.repeat(AI_EDITOR_REQUEST_MAX_LENGTH + 50)).length, AI_EDITOR_REQUEST_MAX_LENGTH)
})
