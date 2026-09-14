import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildGroupDocumentInstruction,
  containsApprovalEvidenceDuplicate,
  createGroupDocumentInstructionSignature,
  groupDocumentInstructionOperationId,
  groupDocumentInstructionPublicView,
  groupDocumentInstructionResponseBody,
  isValidGroupDocumentInstructionId,
  legacyGroupDelegationCreationAllowed,
} from '../server/lib/groupDocumentInstructions.mjs'

const request = {
  parentMapId: 'map-coordinator',
  parentCardId: 'root-coordinator',
  targetMapId: 'map-lobby',
  targetRevision: 7,
  groupProjectVersion: 3,
  sourceRevision: 11,
  strategy: 'new',
  conversationId: '',
  machineId: 'main',
  instructionType: 'execution',
  approvalScope: 'implementation',
  approvalEvidence: '사용자가 문서별 실행 전문을 승인했습니다. 대화 turn-42.',
  instruction: '로비 문서의 승인된 범위를 정비하고 하위 구현 카드에 위임하세요.',
  decisionReason: '문서 담당 대화가 없습니다.',
  newConversation: {
    agentId: 'codex', modelId: 'gpt-5', enabledSkillIds: ['b', 'a'], mcpIds: ['mnp'], workspace: 'C:\\Git\\MindNProgress',
  },
}

test('그룹 문서 지시 키와 요청 서명은 안정적이며 다른 지시를 구분한다', () => {
  assert.equal(isValidGroupDocumentInstructionId('group:3-map-lobby-v7'), true)
  assert.equal(isValidGroupDocumentInstructionId('bad key'), false)
  assert.equal(groupDocumentInstructionOperationId('group:3-map-lobby-v7'), 'gdi:group:3-map-lobby-v7')
  assert.equal(
    createGroupDocumentInstructionSignature(request),
    createGroupDocumentInstructionSignature({
      ...request,
      newConversation: { ...request.newConversation, enabledSkillIds: ['a', 'b'] },
    }),
  )
  assert.notEqual(
    createGroupDocumentInstructionSignature(request),
    createGroupDocumentInstructionSignature({ ...request, approvalScope: 'analysis-only' }),
  )
})

test('과거 교차 문서 위임 생성은 명시적인 마이그레이션 테스트 설정에서만 허용한다', () => {
  assert.equal(legacyGroupDelegationCreationAllowed(undefined), false)
  assert.equal(legacyGroupDelegationCreationAllowed('true'), false)
  assert.equal(legacyGroupDelegationCreationAllowed('1'), true)
})

test('승인 근거 전문의 실행 지시 중복만 검출하고 일반적인 승인 범위 표현은 허용한다', () => {
  assert.equal(containsApprovalEvidenceDuplicate({
    approvalEvidence: '사용자가 문서별 실행 전문을 승인했습니다.\r\n대화 turn-42.',
    instruction: '로비 문서를 검증하세요.\n\n사용자가 문서별 실행 전문을 승인했습니다.\n대화 turn-42.',
  }), true)
  assert.equal(containsApprovalEvidenceDuplicate({
    approvalEvidence: request.approvalEvidence,
    instruction: '승인된 범위에서 로비 문서를 검증하세요.',
  }), false)
})

test('그룹 문서 지시 전문은 위임·worker 완료와 분리하고 승인 경계를 전달한다', () => {
  const instruction = buildGroupDocumentInstruction({
    groupId: 'group-project',
    parentMapId: request.parentMapId,
    targetMapId: request.targetMapId,
    targetCardId: 'root-lobby',
    targetRevision: request.targetRevision,
    groupProjectVersion: request.groupProjectVersion,
    instructionId: 'group:3-map-lobby-v7',
    instructionType: request.instructionType,
    approvalScope: request.approvalScope,
    approvalEvidence: request.approvalEvidence,
    instruction: request.instruction,
    editorId: 'editor-1',
    attributionToken: 'token-1',
    documentCoordinatorInstruction: '문서 루트 AI 운영 지침',
  })
  assert.match(instruction, /^# MindNProgress 그룹 문서 지시/m)
  assert.match(instruction, /AI 작업 위임이나 worker 작업공간 배정이 아닙니다/)
  assert.match(instruction, /실제 하위 업무 카드에 AI 위임/)
  assert.match(instruction, /같은 승인을 사용자에게 반복해서 요구하지 마세요/)
  assert.match(instruction, /사용자가 문서별 실행 전문을 승인했습니다/)
  assert.equal(instruction.split(request.approvalEvidence).length - 1, 1)
  assert.doesNotMatch(instruction, /# MindNProgress 하위 카드 위임 작업 요청/)
})

test('그룹 문서 지시 공개 응답은 기본적으로 전문을 숨기고 reasonCode와 message를 보장한다', () => {
  const stored = {
    id: 'instruction-1', state: 'delivered', requestSignature: 'hash',
    pendingSelection: { agent: { id: 'codex' } }, pendingInstruction: '대기 원문',
    pendingApprovalEvidence: '승인 원문', instruction: '전달 원문', approvalEvidence: '승인 근거', response: '응답 원문',
  }
  assert.deepEqual(groupDocumentInstructionPublicView(stored), { id: 'instruction-1', state: 'delivered' })
  assert.equal(groupDocumentInstructionPublicView(stored, { includeContent: true }).instruction, '전달 원문')
  assert.deepEqual(
    groupDocumentInstructionResponseBody(202, 'GROUP_DOCUMENT_INSTRUCTION_DELIVERED', '전달했습니다.', { repeated: false }),
    { ok: true, reasonCode: 'GROUP_DOCUMENT_INSTRUCTION_DELIVERED', message: '전달했습니다.', repeated: false },
  )
})
