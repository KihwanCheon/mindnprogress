import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'

const entrypoint = new URL('../scripts/runtime/entrypoints/MindNProgress_Start.vbs', import.meta.url)

test('시작 아이콘은 콘솔을 숨기고 재시작 완료 대기·브라우저 열기·실패 안내를 유지한다', async () => {
  const script = await readFile(entrypoint, 'utf8')
  assert.match(script, /WshShell\.Run\(Command, 0, True\)/)
  assert.match(script, /-NonInteractive -WindowStyle Hidden/)
  assert.match(script, /-Action restart -AllowLegacyStop -OpenBrowser/)
  assert.match(script, /If Result <> 0 Then\s+MsgBox/)
  assert.match(script, /WScript\.Quit Result/)
})

test('Windows VBS에서 실행한 격리 PowerShell의 콘솔은 보이지 않는다', { skip: process.platform !== 'win32', timeout: 20_000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'mnp-hidden-restart-'))
  const scripts = path.join(directory, 'MindNProgress', 'scripts')
  try {
    await mkdir(scripts, { recursive: true })
    const launcher = path.join(directory, 'MindNProgress_Start.vbs')
    await writeFile(launcher, await readFile(entrypoint))
    // 실제 제어 명령 대신 창 표시와 인수만 기록한다. 서버·예약 작업·브라우저는 조작하지 않는다.
    await writeFile(path.join(scripts, 'mnp-runtime.ps1'), String.raw`param([string]$Action, [switch]$AllowLegacyStop, [switch]$OpenBrowser)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class MnpConsoleProbe {
    [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool IsWindowVisible(IntPtr window);
}
'@
$result = @{ visible = [MnpConsoleProbe]::IsWindowVisible([MnpConsoleProbe]::GetConsoleWindow()); action = $Action; legacy = [bool]$AllowLegacyStop; browser = [bool]$OpenBrowser }
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'probe.json'), ($result | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
exit 0
`)
    await promisify(execFile)(path.join(process.env.SystemRoot, 'System32', 'wscript.exe'), ['//B', '//NoLogo', launcher], {
      windowsHide: true, timeout: 15_000,
    })
    const result = JSON.parse(await readFile(path.join(scripts, 'probe.json'), 'utf8'))
    assert.deepEqual(result, { visible: false, action: 'restart', legacy: true, browser: true })
  } finally {
    assert.equal(path.dirname(directory), tmpdir())
    assert.ok(path.basename(directory).startsWith('mnp-hidden-restart-'))
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
})
