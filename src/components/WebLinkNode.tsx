import { Handle, Position } from '@xyflow/react'
import type { MindNodeData } from '../types/mindMap'
import { parseWebLinkUrl } from '../utils/webLinks.mjs'
import { AiConversationRuntimeBadge, AiDelegationStatusBadge } from './AiConversationRuntimeBadge'
import { NodeOverlapBadge } from './NodeOverlapBadge'
import './WebLinkNode.css'

export function WebLinkNode({ data, selected, isConnectable }: {
  data: MindNodeData
  selected: boolean
  isConnectable: boolean
}) {
  const link = parseWebLinkUrl(data.webLink?.url)
  if (!link || data.taskUrl !== data.webLink?.url) return null
  const waitingItems = (data.waitingItems ?? []).filter((item) => item.label.trim())
  const waitingTitle = waitingItems.map((item) => [
    item.label,
    item.note,
    item.resumeCondition ? `재개 조건: ${item.resumeCondition}` : '',
  ].filter(Boolean).join(' · ')).join('\n')

  return (
    <>
      <NodeOverlapBadge data={data} />
      <article className={`mind-node web-link-node ${selected ? 'selected' : ''}`} title={link.url}>
        <Handle type="target" position={Position.Left} isConnectable={isConnectable} />
        {([
          ['top', Position.Top],
          ['right', Position.Right],
          ['bottom', Position.Bottom],
          ['left', Position.Left],
        ] as const).map(([side, position]) => (
          <Handle
            key={`knowledge-target-${side}`}
            id={`knowledge-target-${side}`}
            className="knowledge-route-handle"
            type="target"
            position={position}
            isConnectable={false}
          />
        ))}
        {([
          ['top', Position.Top],
          ['right', Position.Right],
          ['bottom', Position.Bottom],
          ['left', Position.Left],
        ] as const).map(([side, position]) => (
          <Handle
            key={`knowledge-source-${side}`}
            id={`dooray-knowledge-source-${side}`}
            className="knowledge-route-handle"
            type="source"
            position={position}
            isConnectable={false}
          />
        ))}
        {waitingItems.length > 0 && (
          <button
            type="button"
            className="node-waiting nodrag nopan"
            title={`${waitingTitle}\n대기 항목 세부 정보 열기`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => data.onOpenWaitingItems?.()}
          >
            <span className="node-waiting-text">⏸️ {waitingItems.length === 1 ? `${waitingItems[0].label} 대기` : `대기 ${waitingItems.length}건`}</span>
          </button>
        )}
        {data.hasChildren && (
          <button
            type="button"
            className={`node-collapse-toggle nodrag nopan ${data.collapsed ? 'collapsed' : ''}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => { event.stopPropagation(); data.onToggleCollapse?.() }}
            title={data.collapsed ? `숨긴 하위 노드 ${data.hiddenDescendantCount ?? 0}개 펼치기` : `하위 노드 ${data.hiddenDescendantCount ?? 0}개 접기`}
            aria-label={data.collapsed ? '하위 가지 펼치기' : '하위 가지 접기'}
            aria-expanded={!data.collapsed}
          >
            <span>{data.collapsed ? '+' : '−'}</span>
            {data.collapsed && <b>{data.hiddenDescendantCount}</b>}
          </button>
        )}
        <header className="web-link-heading node-topline">
          <span className="web-link-provider">
            <i aria-hidden="true">
              <svg viewBox="0 0 16 16">
                <circle cx="8" cy="8" r="5.75" />
                <path d="M2.5 8h11M8 2.25c1.6 1.55 2.4 3.47 2.4 5.75S9.6 12.2 8 13.75C6.4 12.2 5.6 10.28 5.6 8S6.4 3.8 8 2.25Z" />
              </svg>
            </i>
            <span>웹 링크</span>
          </span>
          {Boolean(data.commentCount) && (
            <span className={`node-comments-badge ${data.unresolvedCommentCount ? 'unresolved' : ''}`} title={`댓글 ${data.commentCount}개 · 미해결 스레드 ${data.unresolvedCommentCount ?? 0}개`}>
              <span aria-hidden="true">💬</span>{data.commentCount}
            </span>
          )}
          <AiDelegationStatusBadge status={data.aiDelegationStatus} />
        </header>
        <h3>{data.label || link.title}</h3>
        <footer className="web-link-footer">
          <span className="web-link-address">
            <strong>{link.displayHostname}</strong>
            <small>{link.path}</small>
          </span>
          <AiConversationRuntimeBadge runtime={data.aiConversationRuntime} />
          <a
            className="node-source-open nodrag nopan"
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="웹 링크 열기"
            title="웹 링크 열기"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            ↗
          </a>
        </footer>
        <Handle type="source" position={Position.Right} isConnectable={isConnectable} />
      </article>
    </>
  )
}
