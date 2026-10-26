import { useEffect, useRef, useState } from 'react'
import { DoorayResponseSettings } from './DoorayResponseSettings'
import type { useDoorayResponses } from './useDoorayResponses'
import './DoorayResponseInbox.css'

export function DoorayResponseRequestDialog({ item, response, onClose }: {
  item: { key: string; subject: string }
  response: ReturnType<typeof useDoorayResponses>
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const busy = useRef(false)
  const [attempted, setAttempted] = useState(false)
  useEffect(() => {
    const dialog = dialogRef.current!
    dialog.showModal()
    return () => dialog.close()
  }, [])
  const dismiss = () => { if (!busy.current) onClose() }
  return <dialog ref={dialogRef} className="dooray-response-request-dialog" aria-labelledby="dooray-response-request-title"
    onCancel={(event) => { event.preventDefault(); dismiss() }}
    onClick={(event) => { if (event.target === event.currentTarget) dismiss() }}>
    <div onClick={(event) => event.stopPropagation()}>
      <header>
        <h2 id="dooray-response-request-title">AI 대응 제안 설정</h2>
        <p>{item.subject}</p>
      </header>
      <DoorayResponseSettings response={response} onClose={onClose} onConfirm={async (settings) => {
        if (busy.current) return false
        busy.current = true
        setAttempted(true)
        try {
          if (!await response.saveSettings(settings)) return false
          return await response.request(item.key)
        } finally { busy.current = false }
      }} />
      {attempted && response.error && <p className="dooray-response-error" role="alert">{response.error}</p>}
    </div>
  </dialog>
}
