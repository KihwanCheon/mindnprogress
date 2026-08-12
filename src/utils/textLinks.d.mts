export type TextLink = { href: string; label: string; start: number; end: number }

export function extractTextLinks(text: string): TextLink[]
