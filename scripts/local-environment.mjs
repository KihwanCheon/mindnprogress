import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { loadEnvFile } from 'node:process'
import { fileURLToPath } from 'node:url'

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function loadLocalEnvironment(environmentFile = path.join(projectDirectory, '.env.local')) {
  if (!existsSync(environmentFile)) return false
  loadEnvFile(environmentFile)
  return true
}

// 공개 도메인처럼 Git에 올리면 안 되는 PC별 값을 두는 저장소 밖 MindNProgress 설정 폴더.
export function userConfigDirectory() {
  const configured = String(process.env.MNP_CONFIG_DIR ?? '').trim()
  return configured ? path.resolve(configured) : path.join(homedir(), '.mnp')
}

// 설정 폴더의 설정 파일. .env.local과 같은 KEY=VALUE 형식이라 loadEnvFile로 읽는다.
export function userConfigFile() {
  return path.join(userConfigDirectory(), 'mnp.conf')
}

// 설정 폴더에 mnp.conf가 없을 때 대신 읽는 저장소의 샘플 설정.
export function sampleConfigFile() {
  return path.join(projectDirectory, 'mnp.conf.sample')
}

// loadEnvFile은 이미 있는 값을 덮어쓰지 않으므로 먼저 읽은 파일이 우선한다.
// 우선순위: OS·실행 배치 환경변수 > 저장소 .env.local > 설정 폴더의 mnp.conf(없으면 샘플 설정)
export function loadMindNProgressEnvironment({
  localEnvironmentFile = path.join(projectDirectory, '.env.local'),
  userEnvironmentFile,
  sampleEnvironmentFile = sampleConfigFile(),
} = {}) {
  const loaded = []
  if (loadLocalEnvironment(localEnvironmentFile)) loaded.push(localEnvironmentFile)
  // .env.local에서 MNP_CONFIG_DIR을 바꿀 수 있도록 설정 파일 경로는 그 뒤에 결정한다.
  const userFile = userEnvironmentFile ?? userConfigFile()
  if (loadLocalEnvironment(userFile)) loaded.push(userFile)
  else if (loadLocalEnvironment(sampleEnvironmentFile)) loaded.push(sampleEnvironmentFile)
  return loaded
}
