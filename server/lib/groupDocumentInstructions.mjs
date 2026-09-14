import { createHash } from 'node:crypto'

export const GROUP_DOCUMENT_INSTRUCTION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_:-]{0,95}$/
export const GROUP_DOCUMENT_INSTRUCTION_TYPES = Object.freeze([
  'planning',
  'scope-adjustment',
  'execution',
  'validation',
  'status-request',
])
export const GROUP_DOCUMENT_INSTRUCTION_SCOPES = Object.freeze([
  'analysis-only',
  'card-maintenance',
  'implementation',
  'validation',
])

export function isValidGroupDocumentInstructionId(value) {
  return GROUP_DOCUMENT_INSTRUCTION_ID_PATTERN.test(String(value ?? ''))
}

export function legacyGroupDelegationCreationAllowed(value) {
  return String(value ?? '').trim() === '1'
}

function normalizeInstructionBlock(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n').trim()
}

export function containsApprovalEvidenceDuplicate({ approvalEvidence, instruction } = {}) {
  const evidence = normalizeInstructionBlock(approvalEvidence)
  const body = normalizeInstructionBlock(instruction)
  return Boolean(evidence) && body.includes(evidence)
}

export function groupDocumentInstructionOperationId(id) {
  return `gdi:${id}`
}

export function createGroupDocumentInstructionSignature({
  parentMapId,
  parentCardId,
  targetMapId,
  targetRevision,
  groupProjectVersion,
  sourceRevision,
  strategy,
  conversationId,
  machineId,
  instructionType,
  approvalScope,
  approvalEvidence,
  instruction,
  decisionReason,
  newConversation,
}) {
  const requestedConversation = newConversation && typeof newConversation === 'object'
    ? {
        agentId: String(newConversation.agentId ?? '').trim() || null,
        modelId: String(newConversation.modelId ?? '').trim() || null,
        modeId: String(newConversation.modeId ?? '').trim() || null,
        thoughtLevelId: String(newConversation.thoughtLevelId ?? '').trim() || null,
        enabledSkillIds: [...new Set((newConversation.enabledSkillIds ?? []).map(String))].sort(),
        disabledBuiltinSkillIds: [...new Set((newConversation.disabledBuiltinSkillIds ?? []).map(String))].sort(),
        mcpIds: [...new Set((newConversation.mcpIds ?? []).map(String))].sort(),
        workspace: String(newConversation.workspace ?? '').trim() || null,
      }
    : null
  return createHash('sha256').update(JSON.stringify({
    parentMapId,
    parentCardId,
    targetMapId,
    targetRevision,
    groupProjectVersion,
    sourceRevision,
    strategy,
    conversationId: String(conversationId ?? '').trim() || null,
    machineId: String(machineId ?? '').trim() || null,
    instructionType,
    approvalScope,
    approvalEvidence,
    instruction,
    decisionReason,
    newConversation: strategy === 'new' ? requestedConversation : null,
  })).digest('hex')
}

export function buildGroupDocumentInstruction({
  groupId,
  parentMapId,
  targetMapId,
  targetCardId,
  targetRevision,
  groupProjectVersion,
  instructionId,
  instructionType,
  approvalScope,
  approvalEvidence,
  instruction,
  editorId,
  attributionToken,
  documentCoordinatorInstruction,
}) {
  const scopeInstruction = approvalScope === 'analysis-only'
    ? '이 지시는 읽기 전용 분석·제안 범위입니다. 카드·관계·코드·Prefab을 변경하거나 하위 AI에 구현을 위임하지 마세요.'
    : approvalScope === 'card-maintenance'
      ? '승인된 카드 정비 범위만 수행하고 구현이나 구현 위임으로 확대하지 마세요.'
      : approvalScope === 'implementation'
        ? '승인된 구현 범위는 문서 내부의 실제 하위 업무 카드에 AI 위임하고, 문서 루트 AI가 코드·Prefab을 직접 수정하지 마세요.'
        : '승인된 검증 범위만 수행하고 새로운 구현이나 범위 확대가 필요하면 총괄 AI에 수정안을 반환하세요.'
  return `# MindNProgress 그룹 문서 지시

이 전문은 그룹 총괄 문서 AI가 소속 문서의 루트 카드 AI에 전달한 지시입니다. AI 작업 위임이나 worker 작업공간 배정이 아닙니다. 지시 수신 자체를 업무 완료로 처리하지 말고, 실제 카드와 문서 내부 위임 결과를 기준으로 진행·완료를 판단하세요.

가장 먼저 MindNProgress MCP 도구 \`mindnprogress_get_context\`를 아래 값으로 한 번 성공적으로 호출한 뒤 \`mindnprogress_get_group_context\`로 최신 그룹 기준과 담당 범위를 확인하세요. \`editorId\`와 \`attributionToken\`은 이후 MindNProgress MCP 작업이 끝날 때까지 유지하세요.

- groupId: \`${groupId}\`
- mapId: \`${targetMapId}\`
- cardId: \`${targetCardId}\`
- editorId: \`${editorId}\`
- attributionToken: \`${attributionToken}\`
- instructionId: \`${instructionId}\`
- 발신 총괄 문서: \`${parentMapId}\`
- 그룹 기준 버전: \`${groupProjectVersion}\`
- 대상 문서 버전: \`${targetRevision}\`
- 지시 유형: \`${instructionType}\`
- 승인 범위: \`${approvalScope}\`

${documentCoordinatorInstruction}

## 실행 권한 경계

${scopeInstruction}
총괄 AI가 전달한 확인 가능한 승인 근거는 아래와 같습니다. 같은 승인을 사용자에게 반복해서 요구하지 마세요. 근거와 지시가 서로 맞지 않거나 최신 그룹 기준·담당 범위가 달라졌다면 실행을 확대하지 말고 총괄 AI에 수정안을 보고하세요.

${approvalEvidence.trim()}

## 총괄 AI 지시

${instruction.trim()}`
}

export function groupDocumentInstructionPublicView(instruction, { includeContent = false } = {}) {
  const value = { ...instruction }
  if (includeContent) {
    value.instruction ??= value.pendingInstruction
    value.approvalEvidence ??= value.pendingApprovalEvidence
  }
  delete value.requestSignature
  delete value.pendingSelection
  delete value.pendingInstruction
  delete value.pendingApprovalEvidence
  if (!includeContent) {
    delete value.instruction
    delete value.approvalEvidence
    delete value.response
  }
  return value
}

export function groupDocumentInstructionResponseBody(statusCode, reasonCode, message, payload = {}) {
  return {
    ok: statusCode >= 200 && statusCode < 300,
    reasonCode: String(reasonCode ?? '').trim(),
    message: String(message ?? '').trim(),
    ...payload,
  }
}
