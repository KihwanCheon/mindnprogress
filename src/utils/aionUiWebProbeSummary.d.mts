export type AionUiWebProbeStatus = 'ok' | 'port-mismatch' | 'remote-access-disabled' | 'unreachable' | 'address-unknown' | 'error'

export type AionUiWebProbeResult = {
  status: AionUiWebProbeStatus
  configuredUrl?: string
  configuredPort?: number
  configuredReachable?: boolean
  respondingPorts?: number[]
  loopbackRespondingPorts?: number[] | null
  configuredFromEnv?: boolean
  suggestedConfigUrl?: string | null
  error?: string
}

export type AionUiWebProbeSummary = {
  tone: 'ok' | 'fail'
  text: string
  hint: string | null
}

export function aionUiWebProbeSummary(webUi: AionUiWebProbeResult | undefined, options: { isMainMachine: boolean }): AionUiWebProbeSummary | null
