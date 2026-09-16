import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '..')
const read = (relativePath) => readFile(path.join(root, relativePath), 'utf8')

test('Windows MnP 실행기는 AionUi 포트를 고정하지 않고 공개 인터페이스만 기본 지정한다', async () => {
  const script = await read('scripts/start-server.ps1')

  assert.doesNotMatch(script, /MNP_AIONUI_URL\s*=/)
  assert.match(script, /if \(-not \$env:MNP_PUBLIC_INTERFACE\)/)
  assert.match(script, /\$env:MNP_PUBLIC_INTERFACE\s*=\s*'이더넷'/)
  assert.match(script, /npm run dev/)
})

test('AionUi 실행기는 로컬 AionCore를 우선하고 현재 디렉터리 실행 제한을 제거한다', async () => {
  const script = await read('scripts/start-aionui.ps1')

  assert.match(script, /\$env:AIONUI_BACKEND_BIN\s*=\s*\$backendBin/)
  assert.match(script, /Remove-Item Env:\\NoDefaultCurrentDirectoryInExePath/)
  assert.match(script, /bun run dev/)
})

test('AionCore 재빌드는 실행 중인 백엔드를 차단하고 같은 환경 제한을 제거한다', async () => {
  const script = await read('scripts/rebuild-aioncore.ps1')

  assert.match(script, /Test-AionUiRunning/)
  assert.match(script, /Remove-Item Env:\\NoDefaultCurrentDirectoryInExePath/)
  assert.match(script, /build --release --locked --bin aioncore/)
})

test('최상위 배치는 존재를 확인한 전용 PowerShell 스크립트만 호출한다', async () => {
  const entries = new Map([
    ['MindNProgress_Start.bat', 'scripts\\start-server.ps1'],
    ['MindNProgress_Stop.bat', 'scripts\\stop-server.ps1'],
    ['AionUi_Start.bat', 'scripts\\start-aionui.ps1'],
    ['AionUi_Stop.bat', 'scripts\\stop-aionui.ps1'],
    ['AionCore_Rebuild.bat', 'scripts\\rebuild-aioncore.ps1'],
  ])

  for (const [file, target] of entries) {
    const script = await read(file)
    assert.ok(script.includes(target), `${file}이 ${target}을 호출해야 합니다.`)
    assert.match(script, /if not exist "%SCRIPT%"/)
    assert.match(script, /-NoLogo -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"/)
  }
})
