import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  AI_DELEGATION_INSTRUCTION_FILE_NAME,
  bundledAiDelegationInstructionPath,
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

test('템플릿 변수를 런타임 값으로 치환한다', () => {
  const rendered = renderAiDelegationInstruction(
    '{{requestTitle}} {{mapId}} {{cardId}} {{editorId}} {{attributionToken}} {{approvalInstruction}} {{workspaceInstruction}} {{instructionHeading}} {{instruction}}',
    {
      requestTitle: 'MindNProgress 작업 요청',
      mapId: 'map-test',
      cardId: 'card-test',
      editorId: 'editor-test',
      attributionToken: 'token-test',
      approvalInstruction: '승인 규칙',
      workspaceInstruction: '',
      instructionHeading: '편집자 요청',
      instruction: '하위 작업',
    },
  )
  assert.equal(rendered, 'MindNProgress 작업 요청 map-test card-test editor-test token-test 승인 규칙  편집자 요청 하위 작업')
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
