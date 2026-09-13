export function loadLocalEnvironment(environmentFile?: string): boolean

export function userConfigDirectory(): string

export function userConfigFile(): string

export function sampleConfigFile(): string

export function loadMindNProgressEnvironment(options?: {
  localEnvironmentFile?: string
  userEnvironmentFile?: string
  sampleEnvironmentFile?: string
}): string[]
