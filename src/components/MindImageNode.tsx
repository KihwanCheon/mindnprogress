import { NodeResizer } from '@xyflow/react'
import type { MindNodeData } from '../types/mindMap'
import './MindImageNode.css'

export function MindImageNode({ data, selected }: { data: MindNodeData; selected: boolean }) {
  const image = data.image
  if (!image) return null
  const description = data.description?.trim() ?? ''
  const tooltip = [
    description ? `내용: ${description}` : '',
    `원본 크기: ${image.naturalWidth} × ${image.naturalHeight}`,
  ].filter(Boolean).join('\n')

  return (
    <>
      <NodeResizer
        isVisible={selected && data.imageEditable === true}
        keepAspectRatio
        minWidth={48}
        minHeight={48}
        maxWidth={2_000}
        maxHeight={2_000}
        lineClassName="mind-image-resize-line"
        handleClassName="mind-image-resize-handle"
        onResizeStart={() => data.onImageResizeStart?.()}
        onResizeEnd={(_event, params) => data.onImageResizeEnd?.(params.width, params.height)}
      />
      <figure
        className={`mind-image-node ${selected ? 'selected' : ''}`}
        title={tooltip}
        onDoubleClick={(event) => {
          event.stopPropagation()
          data.onOpenImagePreview?.()
        }}
      >
        <img
          src={data.imageAssetUrl}
          alt={image.fileName}
          draggable={false}
        />
        <button
          type="button"
          className="mind-image-preview-button nodrag nopan"
          aria-label={`${image.fileName} 확대 보기`}
          title="확대 보기"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            data.onOpenImagePreview?.()
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="m15.5 15.5 5 5M10.5 7.5v6M7.5 10.5h6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </figure>
    </>
  )
}
