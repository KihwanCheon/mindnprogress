import type { IncomingMessage } from 'node:http'
import type { networkInterfaces } from 'node:os'

export function collectLocalAddresses(
  interfaces?: ReturnType<typeof networkInterfaces>,
): Set<string>

export function localLoopbackRedirectLocation(
  request: IncomingMessage,
  options?: {
    addresses?: Set<string>
    loopbackHostname?: string
  },
): string | null
