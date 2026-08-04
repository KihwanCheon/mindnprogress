import { Fragment, type ReactNode } from 'react'
import { extractTextLinks } from '../utils/textLinks'
import { DoorayTaskLinkLabel } from './DoorayTaskLinkLabel'

export function LinkifiedText({ text }: { text: string }) {
  const links = extractTextLinks(text)
  if (links.length === 0) return <>{text}</>

  const parts: ReactNode[] = []
  let lastIndex = 0
  links.forEach((link, index) => {
    if (link.start > lastIndex) parts.push(text.slice(lastIndex, link.start))
    parts.push(
      <a
        key={`${link.start}-${link.label}`}
        className="text-link nodrag nopan"
        href={link.href}
        title={link.href}
        target="_blank"
        rel="noopener noreferrer"
        draggable={false}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <DoorayTaskLinkLabel href={link.href} fallback={link.label} />
      </a>,
    )
    lastIndex = link.end
    if (index === links.length - 1 && lastIndex < text.length) parts.push(text.slice(lastIndex))
  })

  return <>{parts.map((part, index) => <Fragment key={index}>{part}</Fragment>)}</>
}
