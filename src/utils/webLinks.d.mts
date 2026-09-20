export type ParsedWebLinkUrl = {
  url: string
  hostname: string
  displayHostname: string
  title: string
  path: string
}

export function parseWebLinkUrl(value: unknown): ParsedWebLinkUrl | null
export function normalizedWebLinkUrl(value: unknown): string | null
export function isSameWebLinkUrl(left: unknown, right: unknown): boolean
