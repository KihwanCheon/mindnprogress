import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectDirectory = path.resolve(moduleDirectory, '../..')

export const AI_DELEGATION_INSTRUCTION_FILE_NAME = 'ai-delegation-instruction.md'
export const AI_CONVERSATION_REQUEST_MAX_LENGTH = 100_000
export const bundledAiDelegationInstructionPath = path.join(
  projectDirectory,
  'config',
  AI_DELEGATION_INSTRUCTION_FILE_NAME,
)

export function resolveMnpConfigDirectory({ env = process.env, homeDirectory = homedir() } = {}) {
  const configuredDirectory = String(env.MNP_CONFIG_DIR ?? '').trim()
  return path.resolve(configuredDirectory || path.join(homeDirectory, '.mnp'))
}

export function loadAiDelegationInstructionTemplate({
  env = process.env,
  homeDirectory = homedir(),
  readFileSyncImpl = readFileSync,
} = {}) {
  const configDirectory = resolveMnpConfigDirectory({ env, homeDirectory })
  const configuredPath = path.join(configDirectory, AI_DELEGATION_INSTRUCTION_FILE_NAME)
  const candidates = [configuredPath, bundledAiDelegationInstructionPath]

  for (const candidate of candidates) {
    try {
      const template = String(readFileSyncImpl(candidate, 'utf8'))
      if (!template.trim()) throw new Error('지시문 템플릿이 비어 있습니다.')
      return {
        configDirectory,
        source: candidate,
        template,
        usingCustomConfig: candidate === configuredPath,
      }
    } catch (error) {
      if (error?.code === 'ENOENT') continue
      throw new Error(`MindNProgress 위임 지시문을 읽을 수 없습니다: ${candidate}`, { cause: error })
    }
  }

  throw new Error(`MindNProgress 기본 위임 지시문이 없습니다: ${bundledAiDelegationInstructionPath}`)
}

export function renderAiDelegationInstruction(template, values = {}) {
  const replacements = {
    requestTitle: values.requestTitle,
    mapId: values.mapId,
    cardId: values.cardId,
    editorId: values.editorId,
    attributionToken: values.attributionToken,
    approvalInstruction: values.approvalInstruction,
    taskContext: values.taskContext,
    workspaceInstruction: values.workspaceInstruction,
    instructionHeading: values.instructionHeading,
    instruction: values.instruction,
  }

  return String(template).replace(/\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g, (match, key) => {
    if (!Object.hasOwn(replacements, key)) throw new Error(`알 수 없는 위임 지시문 변수입니다: ${match}`)
    return String(replacements[key] ?? '')
  }).trim()
}

export function renderAiConversationPrompt(template, values = {}) {
  return renderAiDelegationInstruction(template, {
    ...values,
    requestTitle: 'MindNProgress 작업 요청',
    instructionHeading: '편집자 요청',
    workspaceInstruction: values.workspaceInstruction ?? '',
  })
}

export function buildTaskContextBlock({
  cardTitle,
  cardId,
  doorayLink = null,
  agentLabel,
  modelLabel,
  modeLabel = null,
  thoughtLevelLabel = null,
  roleLabel,
} = {}) {
  const lines = []
  if (doorayLink?.url) {
    lines.push(`- Dooray: ${doorayLink.title ? `${doorayLink.title}(${doorayLink.url})` : doorayLink.url}`)
  }
  lines.push(`- mnp: ${cardTitle}(${cardId})`)
  const aiDetails = [
    `모델: ${agentLabel}(${modelLabel})`,
    ...(modeLabel ? [`모드: ${modeLabel}`] : []),
    ...(thoughtLevelLabel ? [`추론깊이: ${thoughtLevelLabel}`] : []),
  ].join(', ')
  lines.push(`- AI: ${aiDetails}, 역할: ${roleLabel}`)
  return lines.join('\n')
}
