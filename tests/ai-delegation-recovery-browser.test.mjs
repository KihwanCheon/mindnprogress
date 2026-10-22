import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { AiDelegationRecovery } from '/src/components/AiDelegationRecovery.tsx';
import { AiDelegationStatusBadge } from '/src/components/AiConversationRuntimeBadge.tsx';
import { aiDelegationStatusByCard } from '/src/utils/aiDelegationStatus.mjs';
const root = createRoot(document.getElementById('root'));
const originalFetch = window.fetch.bind(window);
window.audit = { calls: [], confirm: true, fail: false, focus: null, selection: null, preview: null };
window.requestFailures = [];
window.extraDelegations = [];
window.confirm = message => {window.audit.lastConfirmation=message;return window.audit.confirm};
const item = { id:'limited',mapId:'child-map',parentMapId:'parent-map',parentCardId:'parent',targetCardId:'child',targetCardLabel:'하위 작업',state:'waiting-usage-limit',createdAt:'2026-09-11',updatedAt:'current',recovery:{recoveryAvailable:true},childError:'사용량 초과' };
const replacement = {...item,id:'replacement',state:'completed',createdAt:'2026-09-12',updatedAt:'replacement-current',workCompleted:true,recovery:null,childError:null};
window.allDelegations = () => [item,replacement,...window.extraDelegations,{...item,id:'unrelated',targetCardId:'someone-else',parentCardId:'someone-else',targetCardLabel:'다른 카드 작업'}];
window.fetch = async (url, init = {}) => {
  if (!String(url).startsWith('/api/')) return originalFetch(url, init);
  window.audit.calls.push({url,method:init.method || 'GET',body:init.body ? JSON.parse(init.body) : null});
  if (init.method === 'POST') {
    if (window.audit.fail) return new Response(JSON.stringify({error:'서버 상태가 변경되었습니다.'}),{status:409});
    if(String(url).includes('/ai-delegation-request-failures/') && String(url).endsWith('/close')) {
      const failure=window.requestFailures.find(f=>String(url).includes('/'+f.id+'/'));
      const body=JSON.parse(init.body);
      failure.requestClosure={reason:body.reason,note:body.note,actorId:'editor',at:'2026-10-15T06:00:00Z'};
      failure.retryVerification={state:'closed',method:null,replacement:null,message:'사용자가 미접수 요청을 종료했습니다.'};
      return new Response(JSON.stringify({requestFailure:failure,message:failure.retryVerification.message,executionRequested:false,cardChanged:false}));
    }
    if(String(url).includes('/ai-delegation-request-failures/') && String(url).endsWith('/recheck')) {
      const failure=window.requestFailures.find(f=>String(url).includes('/'+f.id+'/'));
      failure.resolvedByDelegationId='replacement';
      failure.retryVerification={state:'confirmed',method:'same-instruction',message:'정상 재접수가 확인됐습니다.',replacement:{...replacement}};
      return new Response(JSON.stringify({requestFailure:failure,message:failure.retryVerification.message,executionRequested:false,cardChanged:false}));
    }
    if (window.audit.integrationQueue && String(url).endsWith('/recover')) {
      item.integrationRecoveryRequest={requestId:JSON.parse(init.body).recoveryRequestId,status:'checking',reasonCode:'CHECKING',message:'보존된 완료 결과를 검증 중입니다. 같은 요청을 반복하지 마세요.'};
      item.recovery={recoveryAvailable:false,recommendedAction:'refresh-status'};
      if(window.audit.loseIntegrationResponse) throw new DOMException('timed out','TimeoutError');
      return new Response(JSON.stringify({delegation:item}),{status:202});
    }
    return new Response(JSON.stringify({delegation:item}));
  }
  if (url.endsWith('/ai-delegations')) return new Response(JSON.stringify({delegations:window.allDelegations(),requestFailures:window.requestFailures}));
  return new Response(JSON.stringify({map:{version:url.includes('parent-map') ? 7 : 9}}));
};
let sequence = 0;
const selectCard = (mapId,cardId) => { window.audit.selection = {mapId,cardId} };
const previewCards = (cards) => { window.audit.preview = cards };
window.renderChildRecovery = (props={}) => root.render(React.createElement(AiDelegationRecovery,{key:++sequence,mapId:'child-map',cardId:'child',onSelectCard:selectCard,onPreviewCards:previewCards,...props}));
window.renderRecovery = (props={}) => root.render(React.createElement(React.Fragment,null,
  React.createElement(AiDelegationStatusBadge,{status:aiDelegationStatusByCard([...window.allDelegations(),...window.requestFailures],'parent-map').parent}),
  React.createElement(AiDelegationRecovery,{key:++sequence,mapId:'parent-map',cardId:'parent',onSelectCard:selectCard,onPreviewCards:previewCards,...props})));
window.failedRecovery = () => {item.state='failed';item.workspaceResult=null;item.workspaceError=null;item.recovery={recoveryAvailable:true};item.childError='모델 용량 초과';window.renderRecovery()};
window.quarantinedIntegration = () => {item.state='failed';item.childStatus='completed';item.workCompleted=false;item.reportPending=false;item.reportStatus=null;item.childError=null;item.parentError=null;item.workspaceError='로컬 변경으로 cherry-pick 실패';item.workspaceResult={status:'quarantined',childStatus:'completed'};item.recovery={recoveryAvailable:false,failureCategory:'non-retryable',recommendedAction:'inspect-failure'};item.closure={closeAvailable:false,reason:'workspace-changes-preserved'};window.renderRecovery()};
window.resolvedQuarantine = state => {delete item.integrationRecoveryRequest;item.state=state;item.recovery=null;window.renderRecovery()};
window.retryIntegration = () => {item.recovery={recoveryAvailable:true,failureCategory:'workspace-local-changes',recommendedAction:'retry-integration'};window.renderRecovery()};
window.newIntegrationRequest = () => {delete item.integrationRecoveryRequest;item.recovery={recoveryAvailable:true,failureCategory:'workspace-local-changes',recommendedAction:'retry-integration'};window.renderRecovery()};
window.reportingIntegration = state => {delete item.integrationRecoveryRequest;Object.assign(item,{state,parentDispatchState:'waiting-resume',reportPending:true,reportStatus:state==='waking-parent'?'delivering':'waiting',recovery:{recoveryAvailable:true,failureCategory:'integration-git-lock',recommendedAction:'retry-integration'}});window.renderRecovery()};
window.blockIntegrationRequest = () => {item.integrationRecoveryRequest.status='failed';item.integrationRecoveryRequest.message='통합 재시도를 시작하지 못했습니다: 사용자 변경 원본을 보존해야 합니다.';item.recovery={recoveryAvailable:true,recommendedAction:'retry-integration'};window.renderRecovery()};
window.competingIntegration = () => {item.recovery={recoveryAvailable:false,recommendedAction:'retry-integration',blockedReasonCode:'AI_DELEGATION_ALREADY_ACTIVE',message:'같은 카드·대화의 다른 위임이 진행 중입니다.'};item.closure={closeAvailable:true,workspaceReleaseRequired:true,reason:'preserve-integration-result'};window.renderRecovery()};
window.reportOnly = () => {item.state='parent-wake-failed';item.childError=null;item.parentError='보고 사용량 초과';item.workCompleted=true;item.reportPending=true;item.recovery={recoveryAvailable:false,reportRetryAvailable:true};item.closure={closeAvailable:true,reason:'completed-child-report-abandonment'};window.renderRecovery()};
window.waitingReport = () => {item.state='waiting-parent';item.childError=null;item.parentError=null;item.workCompleted=true;item.reportPending=true;item.reportStatus='waiting';item.reportWaitReason='parent-busy';item.recovery=null;item.closure=null;window.renderRecovery()};
window.deliveringReport = () => {item.state='waking-parent';item.reportStatus='delivering';window.renderRecovery()};
window.receivedReport = () => {item.state='completed';item.reportPending=false;item.reportStatus='received';item.recovery=null;item.closure=null;window.renderRecovery()};
window.failedRequest = () => {window.requestFailures=[{id:'request-error',kind:'request-failure',state:'request-failed',mapId:'child-map',parentMapId:'parent-map',parentCardId:'parent',targetCardId:'child',targetCardLabel:'하위 작업',executionState:'not-started',reasonCode:'REMOTE_WORKSPACE_RUNNER_STALE',message:'원격 풀 보고 만료',createdAt:'2026-10-12',updatedAt:'2026-10-12'}];window.renderRecovery()};
window.retryableRequest = () => {
  window.requestFailures=[{id:'retryable-request',kind:'request-failure',state:'request-failed',mapId:'child-map',parentMapId:'parent-map',parentCardId:'parent',targetCardId:'child',targetCardLabel:'하위 작업',phase:'preflight',executionState:'not-started',targetHomeMachineId:'main',reasonCode:'AI_DELEGATION_VERSION_CONFLICT',message:'문서 버전 충돌',createdAt:'2026-09-11T12:00:00Z',updatedAt:'failure-current'}];
  replacement.targetHomeMachineId='main';replacement.state='running';replacement.instructionPreview='같은 업무의 재접수 지시';window.renderRecovery();
};
window.incompleteTask = () => {window.requestFailures=[];item.taskCompletion={state:'incomplete',status:'planned',progress:0,message:'AI 실행은 종료됐지만 카드 업무는 아직 미완료입니다.'};replacement.taskCompletion=item.taskCompletion;window.renderRecovery()};
window.manyCompletedTasks = () => {
  Object.assign(item,{childError:null,parentError:null,workspaceError:null,workspaceResult:null,instructionPreview:'개발 준비와 독립 검수 단계'});
  window.extraDelegations=[
    ...Array.from({length:53},(_,index)=>({...item,id:'history-'+index,createdAt:new Date(Date.UTC(2026,9,1,0,index)).toISOString()})),
    ...Array.from({length:2},(_,index)=>({...item,id:'other-history-'+index,targetCardId:'other-child',targetCardLabel:'다른 하위 업무'})),
  ];
  window.renderRecovery();
};
window.continuingTask = () => {window.extraDelegations.push({...item,id:'follow-up',state:'waiting-workspace',createdAt:'2026-10-12',taskCompletion:undefined});window.renderRecovery()};
window.fixtureReady = true;
`

test('상위 카드 복구 화면은 하위 카드를 제외하고 AI 없이 재개·보고 재시도를 구분한다', { skip: process.env.MNP_BROWSER_TEST !== '1', timeout: 180000 }, async () => {
  const { createServer } = await import('vite')
  const react = (await import('@vitejs/plugin-react')).default
  const directory = await mkdtemp(path.join(tmpdir(), 'mnp-recovery-browser-'))
  const removeDirectory = async () => {
    if (path.dirname(path.resolve(directory)) !== path.resolve(tmpdir()) || !path.basename(directory).startsWith('mnp-recovery-browser-')) throw Error('테스트 임시 경로 검증 실패')
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 })
  }
  const server = await createServer({ configFile: false, root: path.resolve(import.meta.dirname, '..'), cacheDir: path.join(directory, 'vite-cache'), logLevel: 'error',
    // 격리 UI 검사에서 운영 앱과 검증 빌드의 HTML을 전체 탐색하지 않는다.
    optimizeDeps: { noDiscovery: true, include: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client'] },
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null }, plugins: [react(), {
      name: 'recovery-fixture', resolveId: id => id === '/recovery-fixture.js' ? '\0recovery-fixture' : null,
      load: id => id === '\0recovery-fixture' ? fixture : null,
      configureServer(vite) { vite.middlewares.use('/recovery-check', async (_req, res) => {
        res.setHeader('Content-Type', 'text/html')
        res.end(await vite.transformIndexHtml('/recovery-check', '<!doctype html><html><body><div id="root"></div><script type="module" src="/recovery-fixture.js"></script></body></html>'))
      }) },
    }],
  })
  let browser, socket, send
  const pending = new Map()
  const waitFor = async fn => {
    for (let i = 0; i < 100; i++) { try { const value = await fn(); if (value) return value } catch {} await new Promise(resolve => setTimeout(resolve, 100)) }
    throw Error('복구 화면 검증 대기 시간 초과')
  }
  try {
    await server.listen()
    const fixtureUrl = `http://127.0.0.1:${server.httpServer.address().port}/recovery-check`
    const fixtureResponse = await fetch(fixtureUrl, { signal: AbortSignal.timeout(30000) })
    assert.equal(fixtureResponse.status, 200, '브라우저 실행 전에 격리 검사 페이지가 준비되어야 한다')
    await fixtureResponse.text()
    await server.transformRequest('/recovery-fixture.js')
    browser = spawn(process.env.MNP_TEST_BROWSER_EXE ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
      '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-extensions', '--disable-background-networking',
      '--remote-debugging-port=0', `--user-data-dir=${directory}`, '--window-size=1000,800', 'about:blank',
    ], { stdio: 'ignore', windowsHide: true })
    const port = await waitFor(async () => (await readFile(path.join(directory, 'DevToolsActivePort'), 'utf8')).split('\n')[0])
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()
    socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
    let sequence = 0
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data), item = pending.get(message.id)
      if (!item) return
      pending.delete(message.id); clearTimeout(item.timer)
      if (message.error) item.reject(Error(message.error.message)); else item.resolve(message.result)
    }
    send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error(method)) }, method === 'Page.navigate' ? 30000 : 10000)
      pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }))
    })
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
      if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails))
      return result.result.value
    }
    const click = label => evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(label)}).click()`)
    const ready = () => waitFor(() => evaluate('Boolean(document.querySelector("button")) && !document.querySelector("button").disabled'))
    await send('Page.navigate', { url: fixtureUrl })
    await waitFor(() => evaluate('window.fixtureReady'))
    await evaluate('window.renderChildRecovery()')
    await waitFor(() => evaluate('window.audit.calls.some(c=>c.url==="/api/maps/child-map/ai-delegations")'))
    assert.equal(await evaluate('Boolean(document.querySelector(".ai-delegation-recovery"))'), false)
    await evaluate('window.renderRecovery({focusRequestId:7,onFocusHandled:id=>window.audit.focus=id})'); await ready()
    await waitFor(() => evaluate('window.audit.focus===7'))
    assert.equal(await evaluate('document.activeElement?.classList.contains("ai-delegation-recovery")'), true)
    assert.equal(await evaluate('document.body.textContent.includes("다른 카드 작업")'), false)
    assert.equal(await evaluate('window.audit.calls.filter(c=>c.method==="POST").length'), 0)
    assert.match(await evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="상태 다시 확인").title'), /새 AI 실행은 요청하지 않습니다/)
    assert.match(await evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="기존 작업 재개").title'), /해당 AI가 다시 실행됩니다/)
    assert.equal(await evaluate(`(() => {
      const heading = document.querySelector('.ai-delegation-recovery-item-heading b');
      const bounds = heading.getBoundingClientRect();
      return document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)?.classList.contains('ai-delegation-recovery-item-select');
    })()`), true)
    await evaluate(`document.querySelector('.ai-delegation-recovery-item').dispatchEvent(new MouseEvent('mouseover',{bubbles:true}))`)
    assert.deepEqual(await evaluate('window.audit.preview'), {
      parent: { mapId: 'parent-map', cardId: 'parent' },
      target: { mapId: 'child-map', cardId: 'child' },
    })
    await evaluate(`document.querySelector('.ai-delegation-recovery-item').dispatchEvent(new MouseEvent('mouseout',{bubbles:true,relatedTarget:document.body}))`)
    assert.equal(await evaluate('window.audit.preview'), null)
    await evaluate('document.querySelector(".ai-delegation-recovery-item-select").click()')
    assert.deepEqual(await evaluate('window.audit.selection'), { mapId: 'child-map', cardId: 'child' })
    await evaluate('window.audit.selection=null')
    await click('상태 다시 확인')
    assert.equal(await evaluate('window.audit.selection'), null)
    await waitFor(() => evaluate('Boolean(document.querySelector(".ai-delegation-recovery > [role=status]"))')); await ready()
    let posts = await evaluate('window.audit.calls.filter(c=>c.method==="POST")')
    assert.equal(posts[0].url, '/api/maps/parent-map/ai-delegations/limited/refresh')
    assert.equal(posts[0].body.sourceRevision, 7)
    assert.equal(posts[0].body.targetRevision, 9)
    await evaluate('window.audit.confirm=false'); await click('기존 작업 재개')
    assert.equal(await evaluate('window.audit.calls.filter(c=>c.method==="POST").length'), 1)
    await evaluate('window.audit.confirm=true'); await click('기존 작업 재개')
    await waitFor(() => evaluate('document.querySelector(".ai-delegation-recovery > [role=status]")?.textContent.includes("재개를 접수")')); await ready()
    posts = await evaluate('window.audit.calls.filter(c=>c.method==="POST")')
    assert.ok(posts[1].url.endsWith('/recover'))
    assert.equal(posts[1].body.expectedUpdatedAt, 'current')
    assert.equal(posts[1].body.confirmApprovedScope, true)
    await evaluate('window.audit.fail=true'); await click('기존 작업 재개')
    await waitFor(() => evaluate('document.querySelector("[role=alert]")?.textContent.includes("서버 상태")')); await ready()
    await evaluate('window.audit.fail=false; window.reportOnly()')
    await waitFor(() => evaluate('Array.from(document.querySelectorAll("button")).some(b=>b.textContent==="결과 전달 재시도")')); await ready()
    assert.equal(await evaluate('Array.from(document.querySelectorAll("button")).some(b=>b.textContent==="기존 작업 재개")'), false)
    assert.match(await evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="결과 전달 재시도").title'), /하위 작업은 다시 실행하지 않고/)
    assert.match(await evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="후속 성공으로 종료").title'), /완료 처리하지 않고/)
    assert.match(await evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="보고하지 않고 종료").title'), /바로 종료되지 않으며/)
    await click('결과 전달 재시도')
    await waitFor(() => evaluate('document.querySelector(".ai-delegation-recovery > [role=status]")?.textContent.includes("재전달을 접수")'))
    assert.ok((await evaluate('window.audit.calls.filter(c=>c.method==="POST").at(-1).url')).endsWith('/retry-report'))
    await click('후속 성공으로 종료')
    await waitFor(() => evaluate('document.querySelector(".ai-delegation-recovery > [role=status]")?.textContent.includes("후속 성공 위임")'))
    let last = await evaluate('window.audit.calls.filter(c=>c.method==="POST").at(-1)')
    assert.ok(last.url.endsWith('/supersede'))
    assert.equal(last.body.replacementDelegationId, 'replacement')
    assert.equal(last.body.confirmSupersededByCompletedDelegation, true)
    await click('보고하지 않고 종료')
    assert.match(await evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="취소").title'), /위임 상태와 저장된 결과는 변경되지 않습니다/)
    assert.match(await evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="보고하지 않고 종료").title'), /완료로 기록하지 않고/)
    await evaluate(`(() => { const textarea=document.querySelector('.ai-delegation-close-form textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(textarea,'되돌린 결과이므로 상위 보고 없이 종료합니다.');textarea.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'종료'})); })()`)
    await waitFor(() => evaluate('!Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="보고하지 않고 종료").disabled'))
    await click('보고하지 않고 종료')
    await waitFor(() => evaluate('document.querySelector(".ai-delegation-recovery > [role=status]")?.textContent.includes("사용자 종료 상태")'))
    last = await evaluate('window.audit.calls.filter(c=>c.method==="POST").at(-1)')
    assert.ok(last.url.endsWith('/close'))
    assert.equal(last.body.confirmClosedWithoutCompletion, true)
    assert.equal(last.body.confirmResultReportDiscarded, true)
    const beforeQuarantinePosts = await evaluate('window.audit.calls.filter(c=>c.method==="POST").length')
    await evaluate('window.quarantinedIntegration()'); await ready()
    assert.equal(await evaluate('document.querySelector(".ai-delegation-status-badge")?.textContent'), 'AI 위임 복구 필요')
    assert.match(await evaluate('document.querySelector(".ai-delegation-recovery-heading")?.textContent'), /복구 필요 1건/)
    assert.match(await evaluate('document.body.textContent'), /통합 복구 필요/)
    assert.match(await evaluate('document.body.textContent'), /격리되어 수동 확인과 복구가 필요/)
    assert.match(await evaluate('document.querySelector(".ai-delegation-recovery-error-detail")?.textContent'), /로컬 변경으로 cherry-pick 실패/)
    assert.equal(await evaluate('Array.from(document.querySelectorAll("button")).some(b=>["기존 작업 재개","결과 전달 재시도","후속 성공으로 종료","보고하지 않고 종료"].includes(b.textContent))'), false)
    assert.equal(await evaluate('window.audit.calls.filter(c=>c.method==="POST").length'), beforeQuarantinePosts)
    await evaluate('window.retryIntegration()'); await ready()
    assert.match(await evaluate('document.body.textContent'), /통합 차단 원인을 해소한 뒤 통합 재시도/)
    assert.equal(await evaluate('Array.from(document.querySelectorAll("button")).some(b=>b.textContent==="기존 작업 재개")'), false)
    assert.match(await evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="통합 재시도").title'), /하위 AI 작업은 다시 실행하지 않습니다/)
    await evaluate('window.audit.confirm=false'); await click('통합 재시도')
    assert.equal(await evaluate('window.audit.calls.filter(c=>c.method==="POST").length'), beforeQuarantinePosts)
    await evaluate('window.audit.confirm=true'); await click('통합 재시도')
    await waitFor(() => evaluate('document.querySelector(".ai-delegation-recovery > [role=status]")?.textContent.includes("통합 재시도 요청을 접수")')); await ready()
    const integrationPost = await evaluate('window.audit.calls.filter(c=>c.method==="POST").at(-1)')
    assert.ok(integrationPost.url.endsWith('/recover'))
    assert.match(integrationPost.body.instruction, /완료 커밋 통합 재시도/)
    assert.equal(integrationPost.body.confirmApprovedScope, true)
    assert.equal(typeof integrationPost.body.recoveryRequestId, 'string')
    const beforeReportingRecoveryPosts = await evaluate('window.audit.calls.filter(c=>c.method==="POST").length')
    for (const state of ['waiting-parent', 'parent-wake-failed', 'waking-parent']) {
      await evaluate(`window.reportingIntegration(${JSON.stringify(state)})`); await ready()
      assert.match(await evaluate('document.querySelector(".ai-delegation-recovery-item-heading > span")?.textContent'), /통합 복구 필요/)
      assert.match(await evaluate('document.body.textContent'), /상위 보고 완료를 기다리지 않고 이 화면에서 통합 재시도/)
      assert.equal(await evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="통합 재시도").disabled'), false)
      assert.equal(await evaluate('Array.from(document.querySelectorAll("button")).some(b=>b.textContent==="기존 작업 재개" || b.textContent==="결과 전달 재시도")'), false)
    }
    await evaluate('window.audit.integrationQueue=true')
    await evaluate('(() => { const button=Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="통합 재시도");button.click();button.click() })()'); await ready()
    await waitFor(() => evaluate('document.querySelector(".ai-delegation-action-feedback")?.textContent.includes("검증 중")'))
    assert.match(await evaluate('window.audit.lastConfirmation'), /상위 보고 완료를 기다리지 않으며/)
    assert.equal(await evaluate('window.audit.calls.filter(c=>c.method==="POST").length'), beforeReportingRecoveryPosts + 1, '연속 클릭은 같은 통합 복구 요청을 중복 접수하지 않는다')
    assert.match(await evaluate('document.querySelector(".ai-delegation-recovery-item-heading > span")?.textContent'), /통합 재시도 검증 중/)
    assert.equal(await evaluate('Array.from(document.querySelectorAll("button")).some(b=>b.textContent==="통합 재시도")'), false)
    const queuedPosts = await evaluate('window.audit.calls.filter(c=>c.method==="POST").length')
    await click('상태 다시 확인'); await ready()
    assert.equal(await evaluate('window.audit.calls.filter(c=>c.method==="POST").length'), queuedPosts)
    await evaluate('window.blockIntegrationRequest()'); await ready()
    assert.match(await evaluate('document.querySelector(".ai-delegation-recovery-item [role=alert]")?.textContent'), /사용자 변경 원본/)
    assert.match(await evaluate('document.querySelector(".ai-delegation-recovery-item [role=alert]").closest(".ai-delegation-recovery-item").textContent'), /하위 작업/)
    assert.match(await evaluate('document.body.textContent'), /이전 복구 시도.*현재 Git 상태를 실시간 확인한 결과는 아닙니다/)
    await evaluate('window.competingIntegration()'); await ready()
    assert.match(await evaluate('document.body.textContent'), /현재 차단 사유: 같은 카드/)
    assert.equal(await evaluate('Array.from(document.querySelectorAll("button")).some(b=>b.textContent==="통합 재시도")'), false)
    await click('결과 보존 후 반환')
    await evaluate(`(() => { const textarea=document.querySelector('.ai-delegation-close-form textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(textarea,'기존 통합 결과를 보존하고 반환합니다.');textarea.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'반환'})); })()`)
    await waitFor(() => evaluate('!Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="보고하지 않고 종료").disabled'))
    await click('보고하지 않고 종료'); await ready()
    await waitFor(() => evaluate('window.audit.calls.filter(c=>c.method==="POST").at(-1)?.body.confirmPreserveWorkspaceResult===true'))
    assert.ok((await evaluate('window.audit.calls.filter(c=>c.method==="POST").at(-1).url')).endsWith('/close'))
    await evaluate('window.allDelegations()[0].closure=null')
    await evaluate('window.audit.loseIntegrationResponse=true;window.newIntegrationRequest()'); await ready()
    await click('통합 재시도'); await ready()
    await waitFor(() => evaluate('document.querySelector(".ai-delegation-action-feedback")?.textContent.includes("검증 중")'))
    assert.equal(await evaluate('window.audit.calls.filter(c=>c.method==="POST").length'), queuedPosts + 2, '명시적 반환 1회 이후에도 응답 유실 뒤 자동 POST를 반복하지 않는다')
    await evaluate('window.audit.integrationQueue=false;window.audit.loseIntegrationResponse=false')
    for (const state of ['completed', 'superseded', 'closed']) {
      await evaluate(`window.resolvedQuarantine(${JSON.stringify(state)})`)
      await waitFor(() => evaluate('!document.querySelector(".ai-delegation-recovery") && !document.querySelector(".ai-delegation-status-badge")'))
    }
    await evaluate('window.failedRecovery()'); await ready()
    assert.equal(await evaluate('Array.from(document.querySelectorAll("button")).some(b=>b.textContent==="기존 작업 재개")'), true)
    await evaluate('window.waitingReport()'); await ready()
    assert.match(await evaluate('document.body.textContent'), /총괄에 결과 전달 대기/)
    assert.match(await evaluate('document.body.textContent'), /상위 AI가 작업 중/)
    assert.equal(await evaluate('Array.from(document.querySelectorAll("button")).some(b=>b.textContent==="기존 작업 재개" || b.textContent==="결과 전달 재시도")'), false)
    await evaluate('window.deliveringReport()'); await ready()
    assert.match(await evaluate('document.body.textContent'), /총괄에 결과 전달 중/)
    await evaluate('window.receivedReport()')
    await waitFor(() => evaluate('!document.querySelector(".ai-delegation-recovery")'))
    const beforeRequestFailurePosts = await evaluate('window.audit.calls.filter(c=>c.method==="POST").length')
    await evaluate('window.failedRequest()'); await ready()
    assert.match(await evaluate('document.body.textContent'), /위임 접수 실패 · 실행하지 않음/)
    assert.match(await evaluate('document.body.textContent'), /REMOTE_WORKSPACE_RUNNER_STALE/)
    assert.equal(await evaluate('document.querySelector(".ai-delegation-status-badge")?.textContent'), 'AI 위임 접수 실패')
    assert.equal(await evaluate('Array.from(document.querySelectorAll("button")).some(b=>b.textContent==="정상 재접수로 해제")'), false)
    assert.equal(await evaluate('window.audit.calls.filter(c=>c.method==="POST").length'), beforeRequestFailurePosts)
    await evaluate('window.retryableRequest()')
    await ready()
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
    assert.match(await evaluate('document.body.textContent'), /재접수 확인/)
    assert.equal(await evaluate('document.querySelectorAll(".ai-delegation-replacement select").length'), 0)
    assert.equal(await evaluate('document.body.innerText.includes("retryable-request")'), false, '실패 ID는 접힌 기술 정보에만 표시한다')
    assert.equal(await evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), true, '모바일 폭에서도 가로 넘침 없이 요청을 확인한다')
    await evaluate('window.audit.confirm=false')
    await click('재접수 확인')
    await waitFor(() => evaluate('window.audit.calls.some(c=>c.url.endsWith("/retryable-request/recheck"))'))
    await ready()
    const resolutionPost = await evaluate('window.audit.calls.filter(c=>c.method==="POST").at(-1)')
    assert.equal(resolutionPost.url, '/api/maps/parent-map/ai-delegation-request-failures/retryable-request/recheck')
    assert.equal(resolutionPost.body.replacementDelegationId, undefined)
    assert.equal(resolutionPost.body.confirmSameWork, undefined)
    assert.equal(resolutionPost.body.expectedUpdatedAt, 'failure-current')
    assert.equal(await evaluate('window.requestFailures.length'), 1)
    assert.equal(await evaluate('window.requestFailures[0].resolvedByDelegationId'), 'replacement')
    assert.equal(await evaluate('window.allDelegations().find(item=>item.id==="replacement").state'), 'running')
    assert.equal(await evaluate('document.body.textContent.includes("retryable-request")'), false)
    assert.match(await evaluate('document.querySelector(".ai-delegation-request-history > summary")?.textContent'), /처리된 요청 이력 1건/)
    await evaluate('document.querySelector(".ai-delegation-request-history > summary").click()')
    await waitFor(() => evaluate('document.querySelectorAll(".ai-delegation-request-history .ai-delegation-history-item").length===1'))
    assert.match(await evaluate('document.querySelector(".ai-delegation-request-history").textContent'), /재접수 확인 · 경고 해제/)
    assert.match(await evaluate('document.querySelector(".ai-delegation-request-history").textContent'), /같은 업무의 재접수 지시/)
    assert.equal(await evaluate('window.audit.calls.filter(c=>c.method==="POST").length'), beforeRequestFailurePosts + 1)
    await evaluate('document.querySelector(".ai-delegation-request-history > summary").click();window.audit.confirm=true')
    await send('Emulation.clearDeviceMetricsOverride')
    await evaluate('window.allDelegations().find(item=>item.id==="replacement").state="completed"')
    const afterResolutionPosts = beforeRequestFailurePosts + 1
    await evaluate('window.incompleteTask()'); await ready()
    assert.match(await evaluate('document.body.textContent'), /카드 업무 미완료 · 확인 필요/)
    assert.match(await evaluate('document.querySelector(".ai-delegation-recovery-heading")?.textContent'), /업무 확인 1개 카드/)
    assert.equal(await evaluate('document.querySelector(".ai-delegation-status-badge")?.textContent'), 'AI 업무 확인 필요')
    assert.equal(await evaluate('Array.from(document.querySelectorAll("button")).some(b=>b.textContent==="기존 작업 재개")'), false)
    assert.equal(await evaluate('window.audit.calls.filter(c=>c.method==="POST").length'), afterResolutionPosts)
    assert.equal(await evaluate('document.querySelectorAll(".ai-delegation-recovery-actions button").length'), 0)
    await evaluate('window.manyCompletedTasks()'); await ready()
    assert.match(await evaluate('document.querySelector(".ai-delegation-recovery-heading")?.textContent'), /업무 확인 2개 카드/)
    assert.equal(await evaluate('document.querySelectorAll(".ai-delegation-recovery > .ai-delegation-recovery-item").length'), 2)
    assert.match(await evaluate('document.querySelector(".ai-delegation-status-badge")?.title'), /카드 업무 확인 필요 2개 카드/)
    assert.equal(await evaluate('document.querySelector(".ai-delegation-completed-history")?.open'), false)
    assert.match(await evaluate('document.querySelector(".ai-delegation-completed-history > summary")?.textContent'), /완료된 실행 이력 57건/)
    assert.equal(await evaluate('document.querySelectorAll(".ai-delegation-history-item").length'), 0, '접힌 이력은 행 렌더링도 하지 않는다')
    await evaluate('document.querySelector(".ai-delegation-completed-history > summary").click()')
    await waitFor(() => evaluate('document.querySelectorAll(".ai-delegation-history-item").length===57'))
    assert.equal(await evaluate('Array.from(document.querySelectorAll(".ai-delegation-history-item .ai-delegation-recovery-item-heading > span")).some(node=>node.textContent.includes("카드 업무 미완료"))'), false)
    assert.equal(await evaluate('document.querySelectorAll(".ai-delegation-history-item .ai-delegation-recovery-actions button").length'), 0)
    await evaluate('window.audit.selection=null;document.querySelector(".ai-delegation-history-item .ai-delegation-recovery-item-select").click()')
    assert.deepEqual(await evaluate('window.audit.selection'), { mapId: 'child-map', cardId: 'child' })
    await evaluate(`document.querySelector('.ai-delegation-history-item').dispatchEvent(new MouseEvent('mouseover',{bubbles:true}))`)
    assert.deepEqual(await evaluate('window.audit.preview'), {
      parent: { mapId: 'parent-map', cardId: 'parent' }, target: { mapId: 'child-map', cardId: 'child' },
    })
    await evaluate('document.querySelector(".ai-delegation-completed-history > summary").click()')
    await waitFor(() => evaluate('document.querySelectorAll(".ai-delegation-history-item").length===0 && window.audit.preview===null'))
    await evaluate('window.continuingTask()'); await ready()
    assert.match(await evaluate('document.querySelector(".ai-delegation-recovery-heading")?.textContent'), /진행 중 1건 · 업무 확인 1개 카드/)
    assert.equal(await evaluate('document.querySelectorAll(".ai-delegation-recovery > .ai-delegation-recovery-item").length'), 2)
    assert.equal(await evaluate('document.querySelector(".ai-delegation-status-badge")?.textContent'), 'AI 위임 중')
    assert.match(await evaluate('document.querySelector(".ai-delegation-status-badge")?.title'), /카드 업무 확인 필요 1개 카드/)
    assert.equal(await evaluate('document.querySelectorAll(".ai-delegation-recovery-actions button").length'), 1, '실제 진행 항목의 상태 확인만 제공한다')
    assert.equal(await evaluate('window.audit.calls.filter(c=>c.method==="POST").length'), afterResolutionPosts)
    await evaluate('window.allDelegations=()=>[];window.retryableRequest();window.requestFailures[0].accepted=false;window.renderRecovery()')
    await ready()
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
    await click('취소·진행 불필요로 종료')
    await waitFor(() => evaluate('Boolean(document.querySelector(".ai-delegation-request-close-form"))'))
    assert.equal(await evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="미접수 요청 종료 확정").disabled'), true)
    await click('입력 취소')
    await waitFor(() => evaluate('!document.querySelector(".ai-delegation-request-close-form")'))
    assert.equal(await evaluate('window.audit.calls.filter(c=>c.method==="POST").length'), afterResolutionPosts)
    await click('취소·진행 불필요로 종료')
    await waitFor(() => evaluate('Boolean(document.querySelector(".ai-delegation-request-close-form textarea"))'))
    await evaluate(`(() => { const textarea=document.querySelector('.ai-delegation-request-close-form textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(textarea,'분기 대화에서 요청한 촬영이 더 이상 필요하지 않습니다.');textarea.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'종료'})); })()`)
    await waitFor(() => evaluate('!Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="미접수 요청 종료 확정").disabled'))
    assert.equal(await evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), true)
    await evaluate('window.audit.fail=true')
    await click('미접수 요청 종료 확정')
    await waitFor(() => evaluate('Boolean(document.querySelector("[role=alert]"))'))
    assert.equal(await evaluate('Boolean(window.requestFailures[0].requestClosure)'), false)
    assert.match(await evaluate('document.querySelector(".ai-delegation-request-close-form textarea").value'), /더 이상 필요하지/)
    await evaluate('window.audit.fail=false;window.audit.selection=null')
    await ready()
    await click('미접수 요청 종료 확정')
    await waitFor(() => evaluate('Boolean(document.querySelector(".ai-delegation-request-history")) && !document.querySelector(".ai-delegation-request-close-form")'))
    const closePost = await evaluate('window.audit.calls.filter(c=>c.method==="POST").at(-1)')
    assert.equal(closePost.url, '/api/maps/parent-map/ai-delegation-request-failures/retryable-request/close')
    assert.equal(closePost.body.expectedUpdatedAt, 'failure-current')
    assert.equal(closePost.body.reason, 'no-longer-needed')
    assert.equal(closePost.body.confirmNotExecuted, true)
    assert.equal(closePost.body.replacementDelegationId, undefined)
    assert.equal(await evaluate('window.audit.selection'), null)
    assert.equal(await evaluate('window.requestFailures[0].state'), 'request-failed')
    await evaluate('window.renderRecovery()')
    await waitFor(() => evaluate('!document.querySelector(".ai-delegation-status-badge") && Boolean(document.querySelector(".ai-delegation-request-history"))'))
    await evaluate('document.querySelector(".ai-delegation-request-history > summary").click()')
    await waitFor(() => evaluate('document.body.textContent.includes("사용자 종료 · 미실행")'))
    assert.match(await evaluate('document.body.textContent'), /분기 대화에서 요청한 촬영/)
    assert.match(await evaluate('document.body.textContent'), /문서 버전 충돌/)
    assert.equal(await evaluate('document.body.textContent.includes("재접수 확인 · 경고 해제")'), false)
    await evaluate('delete window.requestFailures[0].requestClosure;window.requestFailures[0].phase="dispatch";window.requestFailures[0].executionState="unknown";window.renderRecovery()')
    await ready()
    assert.equal(await evaluate('Array.from(document.querySelectorAll("button")).some(b=>b.textContent==="취소·진행 불필요로 종료")'), false)
    await send('Emulation.clearDeviceMetricsOverride')
  } finally {
    if (send && socket?.readyState === WebSocket.OPEN) await send('Browser.close').catch(() => {})
    for (const item of pending.values()) clearTimeout(item.timer)
    socket?.close()
    if (browser?.pid && browser.exitCode === null) { const exited = new Promise(resolve => browser.once('exit', resolve)); browser.kill(); await exited }
    await server.close()
    await removeDirectory()
  }
})
