import { useMemo, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
} from '@xyflow/react'
import type { MindMapEdgeData, MindNodeData, TeamMember } from '../types/mindMap'
import { blockingNodes } from '../utils/dependencies'
import { isHierarchyEdge, isKnowledgeEdge, knowledgePolicyOf } from '../utils/knowledgeEdges'
import { KnowledgeEdge } from './KnowledgeEdge'
import { MindNode } from './MindNode'
import './DailyBackupPreviewDialog.css'

type PreviewNode = Node<MindNodeData, 'mind'>
type PreviewEdge = Edge<MindMapEdgeData>
type CommentStats = Record<string, { total: number; unresolved: number }>

export type DailyBackupPreview = {
  date: string
  mapId: string
  title: string
  nodeCount: number
  backedUpAt: string
  mapUpdatedAt: string | null
  map: {
    id: string
    title: string
    color: string
    nodes: PreviewNode[]
    edges: PreviewEdge[]
    updatedAt: string | null
  }
}

type NodeSide = 'top' | 'right' | 'bottom' | 'left'

function nodeDimensions(node: PreviewNode) {
  const styleWidth = typeof node.style?.width === 'number' ? node.style.width : Number.parseFloat(String(node.style?.width ?? ''))
  const styleHeight = typeof node.style?.height === 'number' ? node.style.height : Number.parseFloat(String(node.style?.height ?? ''))
  return {
    width: node.data.image?.displayWidth
      ?? node.data.externalLink?.displayWidth
      ?? (Number.isFinite(styleWidth) ? styleWidth : undefined)
      ?? node.measured?.width
      ?? node.width
      ?? 218,
    height: node.data.image?.displayHeight
      ?? node.data.externalLink?.displayHeight
      ?? (Number.isFinite(styleHeight) ? styleHeight : undefined)
      ?? node.measured?.height
      ?? node.height
      ?? 112,
  }
}

function nodeSideAnchors(node: PreviewNode) {
  const { width, height } = nodeDimensions(node)
  const { x, y } = node.position
  return [
    { side: 'top' as NodeSide, x: x + width / 2, y },
    { side: 'right' as NodeSide, x: x + width, y: y + height / 2 },
    { side: 'bottom' as NodeSide, x: x + width / 2, y: y + height },
    { side: 'left' as NodeSide, x, y: y + height / 2 },
  ]
}

function nearestKnowledgeHandles(source: PreviewNode, target: PreviewNode, sourceHandlePrefix: string) {
  let nearest: { source: NodeSide; target: NodeSide; distance: number } | null = null
  for (const sourceAnchor of nodeSideAnchors(source)) {
    for (const targetAnchor of nodeSideAnchors(target)) {
      const distance = Math.hypot(targetAnchor.x - sourceAnchor.x, targetAnchor.y - sourceAnchor.y)
      if (!nearest || distance < nearest.distance) {
        nearest = { source: sourceAnchor.side, target: targetAnchor.side, distance }
      }
    }
  }
  return nearest ? {
    sourceHandle: `${sourceHandlePrefix}-${nearest.source}`,
    targetHandle: `knowledge-target-${nearest.target}`,
  } : undefined
}

function imageAssetUrl(mapId: string, assetId: string) {
  return `/api/maps/${encodeURIComponent(mapId)}/images/${encodeURIComponent(assetId)}`
}

function formattedDate(value: string | null) {
  return value ? new Date(value).toLocaleString('ko-KR') : '시간 기록 없음'
}

function DailyBackupPreviewCanvas({
  preview,
  teamMembers,
  commentStats,
  referenceCommentStats,
  onClose,
}: {
  preview: DailyBackupPreview
  teamMembers: TeamMember[]
  commentStats: CommentStats
  referenceCommentStats: CommentStats
  onClose: () => void
}) {
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<Set<string>>(() => new Set())
  const hierarchyEdges = useMemo(() => preview.map.edges.filter(isHierarchyEdge), [preview.map.edges])
  const childrenById = useMemo(() => {
    const result = new Map<string, string[]>()
    hierarchyEdges.forEach((edge) => result.set(edge.source, [...(result.get(edge.source) ?? []), edge.target]))
    return result
  }, [hierarchyEdges])
  const descendantCounts = useMemo(() => {
    const result = new Map<string, number>()
    const countDescendants = (nodeId: string, visiting: Set<string>): number => {
      if (visiting.has(nodeId)) return 0
      const nextVisiting = new Set(visiting).add(nodeId)
      return (childrenById.get(nodeId) ?? []).reduce(
        (count, childId) => count + 1 + countDescendants(childId, nextVisiting),
        0,
      )
    }
    preview.map.nodes.forEach((node) => result.set(node.id, countDescendants(node.id, new Set())))
    return result
  }, [childrenById, preview.map.nodes])
  const hiddenNodeIds = useMemo(() => {
    const hidden = new Set<string>()
    collapsedNodeIds.forEach((nodeId) => {
      const stack = [...(childrenById.get(nodeId) ?? [])]
      while (stack.length > 0) {
        const childId = stack.pop() as string
        if (hidden.has(childId)) continue
        hidden.add(childId)
        stack.push(...(childrenById.get(childId) ?? []))
      }
    })
    return hidden
  }, [childrenById, collapsedNodeIds])

  const nodes = useMemo(() => preview.map.nodes.map((node) => {
    const image = node.data.kind === 'image' ? node.data.image : undefined
    const externalLink = node.data.externalLink
    return {
      ...node,
      selected: false,
      draggable: false,
      connectable: false,
      deletable: false,
      hidden: hiddenNodeIds.has(node.id),
      style: image
        ? { ...node.style, width: image.displayWidth, height: image.displayHeight }
        : externalLink
          ? { ...node.style, width: externalLink.displayWidth, height: externalLink.displayHeight }
          : node.style,
      data: {
        ...node.data,
        imageAssetUrl: image ? imageAssetUrl(preview.mapId, image.assetId) : undefined,
        imageEditable: false,
        externalLinkEditable: false,
        assignee: teamMembers.find((member) => member.id === node.data.assigneeId),
        unresolvedDependencyCount: blockingNodes(node, preview.map.nodes).length,
        commentCount: (node.data.reference ? referenceCommentStats[node.id] : commentStats[node.id])?.total ?? 0,
        unresolvedCommentCount: (node.data.reference ? referenceCommentStats[node.id] : commentStats[node.id])?.unresolved ?? 0,
        hasChildren: childrenById.has(node.id),
        collapsed: collapsedNodeIds.has(node.id),
        hiddenDescendantCount: descendantCounts.get(node.id) ?? 0,
        onToggleCollapse: () => setCollapsedNodeIds((current) => {
          const next = new Set(current)
          if (next.has(node.id)) next.delete(node.id)
          else next.add(node.id)
          return next
        }),
        onOpenWaitingItems: undefined,
        onOpenImagePreview: undefined,
        onImageResizeStart: undefined,
        onImageResize: undefined,
        onImageResizeEnd: undefined,
        onExternalLinkResizeStart: undefined,
        onExternalLinkResize: undefined,
        onExternalLinkResizeEnd: undefined,
      },
    }
  }), [childrenById, collapsedNodeIds, commentStats, descendantCounts, hiddenNodeIds, preview.map.nodes, preview.mapId, referenceCommentStats, teamMembers])

  const edges = useMemo(() => {
    const visibleNodeIds = new Set(nodes.filter((node) => !node.hidden).map((node) => node.id))
    const nodesById = new Map(nodes.map((node) => [node.id, node]))
    const pairKey = (edge: PreviewEdge) => JSON.stringify([edge.source, edge.target])
    const hierarchyPairs = new Set(hierarchyEdges.map(pairKey))
    return preview.map.edges.map((edge) => {
      const sourceNode = nodesById.get(edge.source)
      const targetNode = nodesById.get(edge.target)
      const hidden = !visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target)
      if (!isKnowledgeEdge(edge)) return {
        ...edge,
        sourceHandle: sourceNode?.data.kind === 'image' ? 'image-source-right' : edge.sourceHandle,
        hidden,
      }
      const primary = knowledgePolicyOf(edge) === 'reuse-first'
      const sourceHandlePrefix = sourceNode?.data.kind === 'image'
        ? 'image-source'
        : sourceNode?.data.externalLink ? 'dooray-knowledge-source' : null
      const nearestHandles = sourceHandlePrefix && sourceNode && targetNode
        ? nearestKnowledgeHandles(sourceNode, targetNode, sourceHandlePrefix)
        : undefined
      return {
        ...edge,
        ...nearestHandles,
        type: 'knowledge-parallel',
        hidden,
        selectable: false,
        reconnectable: false,
        data: {
          ...edge.data,
          parallelOffset: hierarchyPairs.has(pairKey(edge)) ? 18 : undefined,
        },
        className: `knowledge-edge ${primary ? 'reuse-first' : 'inspect-if-insufficient'}`,
        label: primary ? '주요 지식' : '부족할 때 확인',
        labelStyle: { fill: primary ? 'var(--theme-knowledge-primary-text)' : 'var(--theme-knowledge-fallback-text)', fontSize: 9, fontWeight: 700 },
        labelBgStyle: { fill: primary ? 'var(--theme-knowledge-primary-bg)' : 'var(--theme-knowledge-fallback-bg)', fillOpacity: .96 },
        labelBgPadding: [5, 3] as [number, number],
        labelBgBorderRadius: 5,
        style: { stroke: primary ? 'var(--theme-knowledge-primary)' : 'var(--theme-knowledge-fallback)', strokeWidth: 2.2, strokeDasharray: primary ? undefined : '6 5' },
        markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: primary ? 'var(--theme-knowledge-primary)' : 'var(--theme-knowledge-fallback)' },
      }
    })
  }, [hierarchyEdges, nodes, preview.map.edges])

  return (
    <div className="daily-backup-preview" role="dialog" aria-modal="true" aria-label={`${preview.date} 일일 백업 가상 미리보기`}>
      <header className="daily-backup-preview-header">
        <div>
          <span>읽기 전용 · 운영 문서 변경 없음</span>
          <strong>{preview.date} 일일 백업</strong>
          <small>{preview.map.title} · 문서 상태 {formattedDate(preview.mapUpdatedAt)} · {preview.nodeCount}개 항목</small>
        </div>
        <button type="button" onClick={onClose} aria-label="가상 미리보기 닫기" title="닫기 (Esc)">×</button>
      </header>
      <main className="daily-backup-preview-canvas">
        <ReactFlow<PreviewNode, PreviewEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={{ mind: MindNode }}
          edgeTypes={{ 'knowledge-parallel': KnowledgeEdge }}
          nodesDraggable={false}
          nodesConnectable={false}
          edgesReconnectable={false}
          elementsSelectable={false}
          deleteKeyCode={null}
          panOnDrag={[0, 1, 2]}
          zoomOnDoubleClick={false}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.25}
          maxZoom={1.8}
          defaultEdgeOptions={{ style: { strokeWidth: 2, stroke: 'var(--theme-edge)' } }}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="var(--theme-grid)" />
          <MiniMap
            className="daily-backup-preview-minimap"
            style={{ width: 160, height: 100 }}
            pannable
            zoomable
            ariaLabel="백업 미리보기 미니맵"
            nodeColor={(node) => {
              const data = node.data as MindNodeData
              return data.kind === 'image' ? 'var(--theme-node-image)' : data.progress >= 100 ? 'var(--theme-node-complete)' : data.kind === 'root' ? 'var(--theme-node-root)' : 'var(--theme-node-planned)'
            }}
            maskColor="var(--theme-minimap-mask)"
            maskStrokeColor="var(--theme-minimap-stroke)"
            maskStrokeWidth={2}
          />
          <Controls position="bottom-center" showInteractive={false} />
          <Panel position="top-left" className="daily-backup-preview-notice">
            화면 이동과 확대/축소, 가지 접기/펼치기만 가능합니다.
          </Panel>
        </ReactFlow>
      </main>
    </div>
  )
}

export function DailyBackupPreviewDialog(props: Parameters<typeof DailyBackupPreviewCanvas>[0]) {
  return (
    <ReactFlowProvider>
      <DailyBackupPreviewCanvas {...props} />
    </ReactFlowProvider>
  )
}
