import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'

test('예약 작업 GUI 실행기의 시작 순간 창 노출·대기·종료 코드 회귀 검사', { skip: process.platform !== 'win32', timeout: 90_000 }, async () => {
  const { stdout } = await promisify(execFile)(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(import.meta.dirname, 'runtime-task-host-checks.ps1'), '-NodePath', process.execPath],
    { windowsHide: true, timeout: 85_000 })
  assert.match(stdout, /10 launches; 0 SHOW events/)
})
