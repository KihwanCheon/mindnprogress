import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import './ImagePreviewDialog.css'

type ImagePreviewDialogProps = {
  src: string
  fileName: string
  naturalWidth: number
  naturalHeight: number
  onClose: () => void
}

const MIN_SCALE = 0.02
const MAX_SCALE = 8
const ZOOM_STEP = 1.25

function clampScale(scale: number) {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale))
}

export function ImagePreviewDialog({
  src,
  fileName,
  naturalWidth,
  naturalHeight,
  onClose,
}: ImagePreviewDialogProps) {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const panRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    offsetX: number
    offsetY: number
  } | null>(null)
  const [fitScale, setFitScale] = useState(1)
  const [scale, setScale] = useState(1)
  const [fitMode, setFitMode] = useState(true)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('keydown', closeOnEscape)
      previousFocusRef.current?.focus()
    }
  }, [onClose])

  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return

    const updateFitScale = () => {
      const horizontalSpace = Math.max(1, stage.clientWidth - 48)
      const verticalSpace = Math.max(1, stage.clientHeight - 48)
      const nextFitScale = clampScale(Math.min(
        horizontalSpace / naturalWidth,
        verticalSpace / naturalHeight,
      ))
      setFitScale(nextFitScale)
      if (fitMode) {
        setScale(nextFitScale)
        setOffset({ x: 0, y: 0 })
      }
    }

    updateFitScale()
    const observer = new ResizeObserver(updateFitScale)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [fitMode, naturalHeight, naturalWidth])

  const zoomTo = (nextScale: number) => {
    setFitMode(false)
    setScale(clampScale(nextScale))
  }

  const zoomBy = (factor: number) => {
    zoomTo(scale * factor)
  }

  const fitImage = () => {
    setFitMode(true)
    setScale(fitScale)
    setOffset({ x: 0, y: 0 })
  }

  const showActualSize = () => {
    setFitMode(false)
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    const nextScale = clampScale(scale * (event.deltaY < 0 ? 1.12 : 1 / 1.12))
    if (nextScale === scale) return

    const bounds = event.currentTarget.getBoundingClientRect()
    const pointerX = event.clientX - bounds.left - bounds.width / 2
    const pointerY = event.clientY - bounds.top - bounds.height / 2
    const ratio = nextScale / scale
    setOffset((current) => ({
      x: pointerX - (pointerX - current.x) * ratio,
      y: pointerY - (pointerY - current.y) * ratio,
    }))
    setFitMode(false)
    setScale(nextScale)
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    panRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: offset.x,
      offsetY: offset.y,
    }
    setDragging(true)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panRef.current
    if (!pan || pan.pointerId !== event.pointerId) return
    setOffset({
      x: pan.offsetX + event.clientX - pan.startX,
      y: pan.offsetY + event.clientY - pan.startY,
    })
  }

  const endPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (panRef.current?.pointerId !== event.pointerId) return
    panRef.current = null
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <div
      className="image-preview-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className="image-preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`${fileName} 확대 보기`}
      >
        <header className="image-preview-header">
          <div className="image-preview-title">
            <strong title={fileName}>{fileName}</strong>
            <span>원본 {naturalWidth.toLocaleString()} × {naturalHeight.toLocaleString()}</span>
          </div>
          <div className="image-preview-actions">
            <button type="button" aria-label="축소" title="축소" onClick={() => zoomBy(1 / ZOOM_STEP)}>−</button>
            <span className="image-preview-scale" aria-live="polite">{Math.round(scale * 100)}%</span>
            <button type="button" aria-label="확대" title="확대" onClick={() => zoomBy(ZOOM_STEP)}>+</button>
            <button type="button" className={fitMode ? 'active' : ''} onClick={fitImage}>화면 맞춤</button>
            <button type="button" onClick={showActualSize}>100%</button>
            <a href={src} target="_blank" rel="noreferrer">원본 열기</a>
            <button type="button" className="image-preview-close" aria-label="닫기" title="닫기" onClick={onClose} autoFocus>×</button>
          </div>
        </header>
        <div
          ref={stageRef}
          className={`image-preview-stage ${dragging ? 'dragging' : ''}`}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endPan}
          onPointerCancel={endPan}
          onDoubleClick={fitImage}
        >
          <div
            className="image-preview-position"
            style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
          >
            <img
              src={src}
              alt={fileName}
              draggable={false}
              style={{
                width: naturalWidth,
                height: naturalHeight,
                transform: `translate(-50%, -50%) scale(${scale})`,
              }}
            />
          </div>
          <div className="image-preview-help">휠로 확대·축소 · 드래그로 이동 · 더블클릭으로 화면 맞춤</div>
        </div>
      </section>
    </div>
  )
}
