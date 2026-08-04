import { useLayoutEffect, useRef, useState } from 'react'
import { Handle, NodeResizer, Position } from '@xyflow/react'
import type { MindNodeData } from '../types/mindMap'
import { normalizedDoorayTaskUrl } from '../utils/externalLinks'
import './DoorayTaskNode.css'

export function DoorayTaskNode({ data, selected, isConnectable }: {
  data: MindNodeData
  selected: boolean
  isConnectable: boolean
}) {
  const externalLink = data.externalLink
  const taskUrl = normalizedDoorayTaskUrl(data.taskUrl ?? '')
  const titleRef = useRef<HTMLHeadingElement | null>(null)
  const titleBoxRef = useRef<HTMLDivElement | null>(null)
  const [titleLines, setTitleLines] = useState(2)

  useLayoutEffect(() => {
    const title = titleRef.current
    const titleBox = titleBoxRef.current
    if (!title || !titleBox) return
    const updateTitleLines = () => {
      const lineHeight = Number.parseFloat(window.getComputedStyle(title).lineHeight) || 18
      setTitleLines(Math.max(1, Math.floor(titleBox.clientHeight / lineHeight)))
    }
    updateTitleLines()
    const observer = new ResizeObserver(updateTitleLines)
    observer.observe(titleBox)
    return () => observer.disconnect()
  }, [])

  if (!taskUrl) return null
  const closed = externalLink?.closed ?? data.progress >= 100
  const statusLabel = externalLink?.workflowName
    || (closed ? '완료' : data.status === 'in-progress' ? '진행 중' : '할 일')
  const cardTitle = externalLink?.title?.trim() || data.label
  const knowledgeDescription = data.description?.trim() ?? ''
  const tooltip = [
    cardTitle,
    knowledgeDescription ? `설명: ${knowledgeDescription}` : '',
  ].filter(Boolean).join('\n')
  const waitingItems = (data.waitingItems ?? []).filter((item) => item.label.trim())
  const waitingTitle = waitingItems.map((item) => [
    item.label,
    item.note,
    item.resumeCondition ? `재개 조건: ${item.resumeCondition}` : '',
  ].filter(Boolean).join(' · ')).join('\n')

  return (
    <>
      <NodeResizer
        isVisible={selected && data.externalLinkEditable === true}
        minWidth={160}
        minHeight={96}
        maxWidth={1_200}
        maxHeight={800}
        lineClassName="dooray-task-resize-line"
        handleClassName="dooray-task-resize-handle"
        onResizeStart={() => data.onExternalLinkResizeStart?.()}
        onResizeEnd={(_event, params) => data.onExternalLinkResizeEnd?.(params.width, params.height)}
      />
      <article className={`mind-node dooray-task-node ${closed ? 'closed' : ''} ${selected ? 'selected' : ''}`} title={tooltip}>
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
        <Handle type="target" position={Position.Left} isConnectable={isConnectable} />
        {([
          ['top', Position.Top],
          ['right', Position.Right],
          ['bottom', Position.Bottom],
          ['left', Position.Left],
        ] as const).map(([side, position]) => (
          <Handle
            key={side}
            id={`knowledge-target-${side}`}
            className="knowledge-route-handle"
            type="target"
            position={position}
            isConnectable={false}
          />
        ))}
        <header className="dooray-task-heading">
          <span className="dooray-task-provider"><i aria-hidden="true">D</i>Dooray 업무</span>
          {Boolean(data.commentCount) && (
            <span className={`node-comments-badge ${data.unresolvedCommentCount ? 'unresolved' : ''}`} title={`댓글 ${data.commentCount}개 · 미해결 스레드 ${data.unresolvedCommentCount ?? 0}개`}>
              <span aria-hidden="true">💬</span>{data.commentCount}
            </span>
          )}
          <span className="dooray-task-status">{statusLabel}</span>
        </header>
        <div ref={titleBoxRef} className="dooray-task-title-box">
          <h3 ref={titleRef} style={{ WebkitLineClamp: titleLines }}>{cardTitle}</h3>
        </div>
        <footer className="dooray-task-footer">
          <span title={externalLink?.taskNumber}>{externalLink?.taskNumber || 'Dooray 원본'}</span>
          <a
            className="nodrag nopan"
            href={taskUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Dooray 업무 원본 열기"
            title="Dooray 업무 원본 열기"
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
