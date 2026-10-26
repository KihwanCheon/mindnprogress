export const sharedKnowledgeMaxLength: number

export const sharedKnowledgeAuthoringPolicy: Readonly<{
  purpose: string
  writeWhen: string
  keep: readonly string[]
  exclude: readonly string[]
  update: string
  preserve: string
  history: string
  capacity: string
  length: string
}>

export const SHARED_KNOWLEDGE_WRITE_INSTRUCTION: string

export const sharedKnowledgeAuditThresholds: Readonly<{
  attentionCharacters: number
  recommendedCharacters: number
  priorityCharacters: number
  limitCharacters: number
}>
