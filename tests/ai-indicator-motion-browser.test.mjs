import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { AiConversationRuntimeBadge, AiConversationActivityIndicator } from '/src/components/AiConversationRuntimeBadge.tsx';
import { applyAiIndicatorMotion, initialAiIndicatorMotion } from '/src/aiIndicatorMotion.ts';
applyAiIndicatorMotion(initialAiIndicatorMotion());
window.setIndicatorMotion = motion => applyAiIndicatorMotion(motion, true);
createRoot(document.getElementById('root')).render(React.createElement(React.Fragment, null,
  React.createElement(AiConversationRuntimeBadge, {runtime:{state:'running'}}),
  React.createElement(AiConversationActivityIndicator, {activeCount:1})));
`

test('동작 줄이기 환경에서도 명시적 선택 시 AI 점 표시만 움직이고 브라우저 설정을 유지한다', {
  skip: process.env.MNP_BROWSER_TEST !== '1', timeout: 120_000,
}, async t => {
  const { createServer } = await import('vite')
  const react = (await import('@vitejs/plugin-react')).default
  const directory = await mkdtemp(path.join(tmpdir(), 'mnp-indicator-motion-'))
  const server = await createServer({ configFile: false, root: path.resolve(import.meta.dirname, '..'), logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false }, plugins: [react(), {
      name: 'indicator-motion-fixture', resolveId: id => id === '/indicator-motion-fixture.js' ? '\0indicator-motion-fixture' : null,
      load: id => id === '\0indicator-motion-fixture' ? fixture : null,
      configureServer(vite) { vite.middlewares.use('/indicator-motion-check', async (_req, res) => {
        res.setHeader('Content-Type', 'text/html')
        res.end(await vite.transformIndexHtml('/indicator-motion-check', '<!doctype html><html><body><div id="root"></div><script type="module" src="/indicator-motion-fixture.js"></script></body></html>'))
      }) },
    }],
  })
  let browser, socket, send
  const pending = new Map()
  const waitFor = async fn => {
    for (let i = 0; i < 100; i++) {
      try { const result = await fn(); if (result) return result } catch {}
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw Error('AI 작업 표시 브라우저 검증 대기 시간 초과')
  }
  try {
    t.diagnostic('Vite 서버 시작')
    await server.listen()
    t.diagnostic('Chrome 시작')
    browser = spawn(process.env.MNP_TEST_BROWSER_EXE ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
      '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-extensions', '--disable-background-networking',
      '--remote-debugging-port=0', `--user-data-dir=${directory}`, 'about:blank',
    ], { stdio: 'ignore', windowsHide: true })
    let spawnError
    browser.on('error', error => { spawnError = error })
    const port = await waitFor(async () => { if (spawnError) throw spawnError; return (await readFile(path.join(directory, 'DevToolsActivePort'), 'utf8')).split('\n')[0] })
    t.diagnostic(`Chrome 디버그 포트 ${port}`)
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()
    socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
    t.diagnostic('Chrome 디버그 소켓 연결')
    let sequence = 0
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data), item = pending.get(message.id)
      if (!item) return
      pending.delete(message.id); clearTimeout(item.timer)
      if (message.error) item.reject(Error(message.error.message)); else item.resolve(message.result)
    }
    send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error(method)) }, 10000)
      pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }))
    })
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true })
      if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails))
      return result.result.value
    }
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    const url = `http://127.0.0.1:${server.httpServer.address().port}/indicator-motion-check`
    await send('Page.navigate', { url })
    t.diagnostic('검증 페이지 이동')
    await waitFor(() => evaluate('document.querySelectorAll(".ai-conversation-runtime-typing > span").length===6'))
    const animation = () => evaluate('({reduce:matchMedia("(prefers-reduced-motion: reduce)").matches,dots:[...document.querySelectorAll(".ai-conversation-runtime-typing > span")].map(el=>({name:getComputedStyle(el).animationName,delay:getComputedStyle(el).animationDelay})),border:getComputedStyle(document.querySelector(".ai-conversation-runtime-badge")).animationName})')
    let state = await animation()
    assert.equal(state.reduce, true)
    assert.ok(state.dots.every(dot => dot.name === 'none'))
    assert.equal(state.border, 'none')

    await evaluate('window.setIndicatorMotion("always")')
    state = await animation()
    assert.ok(state.dots.every(dot => dot.name === 'ai-conversation-runtime-typing'))
    assert.deepEqual(state.dots.slice(0, 3).map(dot => dot.delay), ['0s', '0.14s', '0.28s'])
    assert.equal(state.border, 'none', '다른 애니메이션의 접근성 설정은 유지한다')
    assert.equal(await evaluate('localStorage.getItem("mindnprogress-ai-indicator-motion")'), 'always')

    await send('Page.reload')
    await waitFor(() => evaluate('document.querySelectorAll(".ai-conversation-runtime-typing > span").length===6'))
    assert.ok((await animation()).dots.every(dot => dot.name === 'ai-conversation-runtime-typing'))
    await evaluate('window.setIndicatorMotion("system")')
    assert.ok((await animation()).dots.every(dot => dot.name === 'none'))
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
    assert.ok((await animation()).dots.every(dot => dot.name === 'ai-conversation-runtime-typing'))
  } finally {
    if (send && socket?.readyState === WebSocket.OPEN) await send('Browser.close').catch(() => {})
    for (const item of pending.values()) clearTimeout(item.timer)
    socket?.close()
    if (browser?.pid && browser.exitCode === null) { const exited = new Promise(resolve => browser.once('exit', resolve)); browser.kill(); await exited }
    await server.close()
    const resolved = path.resolve(directory)
    if (path.dirname(resolved) === path.resolve(tmpdir()) && path.basename(resolved).startsWith('mnp-indicator-motion-')) {
      await rm(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 })
    }
  }
})
