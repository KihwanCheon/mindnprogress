import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  AI_DELEGATION_INSTRUCTION_FILE_NAME,
  bundledAiDelegationInstructionPath,
  buildTaskContextBlock,
  loadAiDelegationInstructionTemplate,
  renderAiConversationPrompt,
  renderAiDelegationInstruction,
  resolveMnpConfigDirectory,
} from '../server/lib/aiDelegationInstructions.mjs'

test('기본 설정 디렉터리는 ~/.mnp이고 MNP_CONFIG_DIR로 대체할 수 있다', () => {
  assert.equal(resolveMnpConfigDirectory({ homeDirectory: '/tmp/test-home', env: {} }), path.resolve('/tmp/test-home', '.mnp'))
  assert.equal(
    resolveMnpConfigDirectory({ homeDirectory: '/tmp/test-home', env: { MNP_CONFIG_DIR: '/tmp/custom-mnp' } }),
    path.resolve('/tmp/custom-mnp'),
  )
})

test('사용자 설정 지시문이 있으면 저장소 기본 템플릿보다 우선한다', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'mnp-instruction-config-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const customDirectory = path.join(directory, '.mnp')
  await mkdir(customDirectory, { recursive: true })
  const customPath = path.join(customDirectory, AI_DELEGATION_INSTRUCTION_FILE_NAME)
  await writeFile(customPath, '사용자 전용 {{mapId}} 지시문', 'utf8')

  const loaded = loadAiDelegationInstructionTemplate({ env: { MNP_CONFIG_DIR: customDirectory }, homeDirectory: directory })
  assert.equal(loaded.source, customPath)
  assert.equal(loaded.usingCustomConfig, true)
  assert.equal(loaded.template, '사용자 전용 {{mapId}} 지시문')
})

test('사용자 설정이 없으면 저장소 기본 템플릿을 사용한다', () => {
  const loaded = loadAiDelegationInstructionTemplate({ env: { MNP_CONFIG_DIR: '/tmp/mnp-config-that-does-not-exist' }, homeDirectory: '/tmp/test-home' })
  assert.equal(loaded.source, bundledAiDelegationInstructionPath)
  assert.equal(loaded.usingCustomConfig, false)
  assert.match(loaded.template, /별도 worktree와 짧은 기능 브랜치를 생성해 병렬 작업/)
  assert.doesNotMatch(loaded.template, /kwOpenApi-worktrees|<작업메인클론>/)
})

test('기본 템플릿은 작업공간 참조·TidyFirst·다양한 개발도구·AionUi 협업을 지시한다', () => {
  const loaded = loadAiDelegationInstructionTemplate({ env: { MNP_CONFIG_DIR: '/tmp/mnp-config-that-does-not-exist' }, homeDirectory: '/tmp/test-home' })
  assert.match(loaded.template, /AGENTS\.md/)
  assert.match(loaded.template, /CLAUDE\.md/)
  assert.match(loaded.template, /TidyFirst/)
  assert.match(loaded.template, /mise.*mvn.*fnm/)
  assert.match(loaded.template, /AionUi/)
  assert.match(loaded.template, /스킬/)
})

test('기본 템플릿 길이는 감량 전 기준(4236자)보다 짧다', () => {
  const loaded = loadAiDelegationInstructionTemplate({ env: { MNP_CONFIG_DIR: '/tmp/mnp-config-that-does-not-exist' }, homeDirectory: '/tmp/test-home' })
  assert.ok(loaded.template.length < 4236, `템플릿 길이 ${loaded.template.length}자가 감량 전 기준(4236자) 이상입니다.`)
})

test('기본 템플릿은 taskContext 자리를 두고 커밋 서명 대신 footer를 남기라고 지시한다', () => {
  const loaded = loadAiDelegationInstructionTemplate({ env: { MNP_CONFIG_DIR: '/tmp/mnp-config-that-does-not-exist' }, homeDirectory: '/tmp/test-home' })
  assert.match(loaded.template, /\{\{taskContext\}\}/)
  assert.match(loaded.template, /서명.*(넣지|없이|대신)/)
})

test('buildTaskContextBlock: Dooray 제목·모드·추론깊이가 모두 있으면 세 줄을 순서대로 만든다', () => {
  const block = buildTaskContextBlock({
    cardTitle: 'mnp 지시문 정비',
    cardId: 'node-abc123',
    doorayLink: { title: '지시문 정비 요청', url: 'https://example.dooray.com/task/1/2' },
    agentLabel: 'Claude Code',
    modelLabel: 'Sonnet 5',
    modeLabel: 'code',
    thoughtLevelLabel: 'high',
    roleLabel: '카드 담당',
  })
  assert.equal(block, [
    '- Dooray: 지시문 정비 요청(https://example.dooray.com/task/1/2)',
    '- mnp: mnp 지시문 정비(node-abc123)',
    '- AI: 모델: Claude Code(Sonnet 5), 모드: code, 추론깊이: high, 역할: 카드 담당',
  ].join('\n'))
})

test('buildTaskContextBlock: 카드에 taskUrl(출처)이 없으면 Dooray 줄을 만들지 않는다', () => {
  const block = buildTaskContextBlock({
    cardTitle: '카드 제목',
    cardId: 'node-x',
    doorayLink: null,
    agentLabel: 'Codex CLI',
    modelLabel: 'GPT-5.6 Sol',
    roleLabel: '하위 카드 위임 실행',
  })
  assert.equal(block, [
    '- mnp: 카드 제목(node-x)',
    '- AI: 모델: Codex CLI(GPT-5.6 Sol), 역할: 하위 카드 위임 실행',
  ].join('\n'))
  assert.doesNotMatch(block, /Dooray/)
})

test('buildTaskContextBlock: Dooray URL은 있으나 캐시된 제목이 없으면 URL만 남긴다', () => {
  const block = buildTaskContextBlock({
    cardTitle: '카드 제목',
    cardId: 'node-y',
    doorayLink: { title: null, url: 'https://example.dooray.com/task/1/9' },
    agentLabel: 'Claude Code',
    modelLabel: 'Sonnet 5',
    roleLabel: '카드 담당',
  })
  assert.match(block, /^- Dooray: https:\/\/example\.dooray\.com\/task\/1\/9$/m)
})

test('템플릿 변수를 런타임 값으로 치환한다', () => {
  const rendered = renderAiDelegationInstruction(
    '{{requestTitle}} {{mapId}} {{cardId}} {{editorId}} {{attributionToken}} {{approvalInstruction}} {{taskContext}} {{workspaceInstruction}} {{instructionHeading}} {{instruction}}',
    {
      requestTitle: 'MindNProgress 작업 요청',
      mapId: 'map-test',
      cardId: 'card-test',
      editorId: 'editor-test',
      attributionToken: 'token-test',
      approvalInstruction: '승인 규칙',
      taskContext: '- mnp: 카드(card-test)',
      workspaceInstruction: '',
      instructionHeading: '편집자 요청',
      instruction: '하위 작업',
    },
  )
  assert.equal(rendered, 'MindNProgress 작업 요청 map-test card-test editor-test token-test 승인 규칙 - mnp: 카드(card-test)  편집자 요청 하위 작업')
  assert.throws(() => renderAiDelegationInstruction('{{unknown}}', {}), /알 수 없는 위임 지시문 변수/)
})

test('기본 템플릿을 일반 MNP 대화용 제목과 편집자 요청으로 렌더링한다', () => {
  const loaded = loadAiDelegationInstructionTemplate({ env: { MNP_CONFIG_DIR: '/tmp/mnp-config-that-does-not-exist' }, homeDirectory: '/tmp/test-home' })
  const rendered = renderAiConversationPrompt(loaded.template, {
    mapId: 'map-test',
    cardId: 'card-test',
    editorId: 'editor-test',
    attributionToken: 'token-test',
    approvalInstruction: '승인 규칙',
    instruction: '카드 검토 요청',
  })

  assert.match(rendered, /^# MindNProgress 작업 요청/)
  assert.match(rendered, /# 편집자 요청/)
  assert.ok(rendered.endsWith('카드 검토 요청'))
  assert.doesNotMatch(rendered, /\{\{[A-Za-z]/)
})
