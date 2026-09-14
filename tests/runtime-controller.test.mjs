import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'

test('Windows 공통 명령의 대상·잠금·타임아웃·전환 승인 보호 장치', { skip: process.platform !== 'win32', timeout: 20_000 }, async () => {
  const { stdout } = await promisify(execFile)(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(import.meta.dirname, 'runtime-controller-checks.ps1')], { windowsHide: true })
  assert.match(stdout, /safety checks passed/)
})
