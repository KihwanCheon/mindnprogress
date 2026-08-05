export type ChecklistItem = {
  id: string
  text: string
  done: boolean
}

export type WaitingItem = {
  id: string
  label: string
  note?: string
  resumeCondition?: string
  since: string
}

export type TeamMember = {
  id: string
  name: string
  initials: string
  color: 'violet' | 'blue' | 'mint' | 'orange'
  active: boolean
}

export type KnowledgePolicy = 'reuse-first' | 'inspect-if-insufficient'

export type MindMapEdgeData = {
  relation?: 'hierarchy' | 'knowledge'
  knowledgePolicy?: KnowledgePolicy
  parallelOffset?: number
}

export type MindNodeReference = {
  mapId: string
  nodeId: string
}

export type MindImageData = {
  assetId: string
  fileName: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
  naturalWidth: number
  naturalHeight: number
  displayWidth: number
  displayHeight: number
}

export type MindDoorayTaskData = {
  provider: 'dooray-task'
  url: string
  hostname: string
  projectId: string
  postId: string
  title?: string
  taskNumber: string
  workflowName: string
  workflowClass: string
  closed: boolean
  resolvedAt: string
  displayWidth: number
  displayHeight: number
}

export type MindDoorayWikiData = {
  provider: 'dooray-wiki'
  url: string
  hostname: string
  wikiId: string
  pageId: string
  title?: string
  resolvedAt: string
  displayWidth: number
  displayHeight: number
}

export type MindDoorayLinkData = MindDoorayTaskData | MindDoorayWikiData

export type AiConversationRuntime = {
  conversationId: string
  state: 'running' | 'waiting-confirmation' | 'idle' | 'unknown'
  isProcessing: boolean
  pendingConfirmations: number
  turnId: string | null
  observedAt: string
}

export type MindNodeData = {
  label: string
  description: string
  sharedKnowledge?: string
  sharedKnowledgeUpdatedAt?: string
  sharedKnowledgeUpdatedBy?: {
    id: string
    name: string
  }
  progress: number
  status: 'planned' | 'in-progress' | 'done'
  kind: 'root' | 'branch' | 'task' | 'image'
  image?: MindImageData
  externalLink?: MindDoorayLinkData
  imageAssetUrl?: string
  imageEditable?: boolean
  onImageResizeStart?: () => void
  onImageResizeEnd?: (width: number, height: number) => void
  onOpenImagePreview?: () => void
  externalLinkEditable?: boolean
  onExternalLinkResizeStart?: () => void
  onExternalLinkResizeEnd?: (width: number, height: number) => void
  taskUrl?: string
  aiConversationId?: string
  reference?: MindNodeReference
  isWork?: boolean
  assigneeId?: string
  assignee?: TeamMember
  dueDate?: string
  checklist?: ChecklistItem[]
  blockedBy?: string[]
  waitingItems?: WaitingItem[]
  unresolvedDependencyCount?: number
  commentCount?: number
  unresolvedCommentCount?: number
  hasChildren?: boolean
  collapsed?: boolean
  hiddenDescendantCount?: number
  aiConversationRuntime?: AiConversationRuntime
  onToggleCollapse?: () => void
  onOpenWaitingItems?: () => void
}
