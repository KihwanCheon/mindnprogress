import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'

test('설정 조회와 사전·최종 포트 확인은 콘솔 생성 없는 공통 실행 경로를 사용한다', async () => {
  const script = await readFile(new URL('../scripts/mnp-runtime.ps1', import.meta.url), 'utf8')
  assert.match(script, /\$startInfo\.CreateNoWindow = \$true/)
  assert.match(script, /\$startInfo\.UseShellExecute = \$false/)
  assert.match(script, /\$settings = Invoke-MnpHiddenCommand \$node/)
  assert.match(script, /\$netstat = Invoke-MnpHiddenCommand .*netstat\.exe/)
  assert.doesNotMatch(script, /& \$node|& \(Join-Path \$env:SystemRoot 'System32\\netstat\.exe'\)/)
  assert.doesNotMatch(script, /Get-NetTCPConnection/)
})

test('Windows 실제 포트 조회와 사전 검사에서 빈 포트·조회 실패·다른 소유자를 구분한다', { skip: process.platform !== 'win32', timeout: 20_000 }, async () => {
  const { stdout } = await promisify(execFile)(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(import.meta.dirname, 'runtime-port-query-checks.ps1')], { windowsHide: true })
  assert.match(stdout, /Runtime port query checks passed/)
})

test('Windows 공통 명령의 대상·잠금·타임아웃·전환 승인 보호 장치', { skip: process.platform !== 'win32', timeout: 20_000 }, async () => {
  const { stdout } = await promisify(execFile)(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(import.meta.dirname, 'runtime-controller-checks.ps1')], { windowsHide: true })
  assert.match(stdout, /safety checks passed/)
})
