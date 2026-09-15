import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const projectDirectory = path.resolve(import.meta.dirname, '..')

async function waitForServer(baseUrl, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`)
      if (response.ok) return
    } catch {
      // 격리 서버 시작 대기
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('AI 대화 탐색 API 검증 서버가 제한 시간 안에 시작되지 않았습니다.')
}

async function stopProcess(child) {
  if (child.exitCode !== null) return
  child.kill()
  await new Promise((resolve) => {
    child.once('exit', resolve)
    setTimeout(resolve, 2_000)
  })
}

async function readUntil(reader, pattern, timeoutMs = 3_000) {
  const decoder = new TextDecoder()
  let received = ''
  const deadline = Date.now() + timeoutMs
  while (!pattern.test(received)) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new Error(`이벤트 수신 제한 시간을 초과했습니다: ${received}`)
    const result = await Promise.race([
      reader.read(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('이벤트 수신 제한 시간을 초과했습니다.')), remaining)),
    ])
    if (result.done) break
    received += decoder.decode(result.value, { stream: true })
  }
  return received
}

async function readFor(reader, durationMs) {
  const decoder = new TextDecoder()
  let received = ''
  await Promise.race([
    (async () => {
      const result = await reader.read()
      if (!result.done) received += decoder.decode(result.value, { stream: true })
    })(),
    new Promise((resolve) => setTimeout(resolve, durationMs)),
  ])
  return received
}

test('AionUi 대화 조회와 화면 선택은 연결된 카드 및 같은 계정·디바이스의 MnP 화면에만 적용된다', { timeout: 30_000 }, async () => {
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'mindnprogress-ai-conversation-navigation-'))
  const mapId = 'map-conversation-navigation'
  const cardId = 'card-navigation'
  const conversationId = 'conversation-navigation'
  const legacyConversationId = 'conversation-legacy'
  const cardOwnerConversationId = 'conversation-card-owner'
  const attributionConversationId = 'conversation-attribution-owner'
  const viewerConversationId = 'conversation-viewer-owner'
  const inactiveConversationId = 'conversation-inactive-owner'
  const linkedAt = '2026-09-15T00:00:00.000Z'
  const linkedCard = (id, label, linkedConversationId, startedBy = null) => ({
    id,
    type: 'mind',
    position: { x: 0, y: 0 },
    data: {
      label,
      kind: id === cardId ? 'root' : 'task',
      progress: 0,
      status: 'planned',
      aiConversationId: linkedConversationId,
      aiConversations: [{
        conversationId: linkedConversationId,
        linkedAt,
        ...(startedBy ? { startedBy: { id: startedBy, label: startedBy } } : {}),
      }],
    },
  })
  await writeFile(path.join(dataDirectory, `${mapId}.json`), JSON.stringify({
    id: mapId,
    title: '대화 탐색 문서',
    nodes: [
      linkedCard(cardId, '대화 탐색 카드', conversationId, 'user-admin'),
      linkedCard('card-legacy', '레거시 카드', legacyConversationId),
      linkedCard('card-owner-link', '카드 소유자 기록', cardOwnerConversationId, 'user-admin'),
      linkedCard('card-owner-attribution', '귀속 소유자 기록', attributionConversationId),
      linkedCard('card-viewer', '열람자 소유 카드', viewerConversationId, 'user-public-viewer'),
      linkedCard('card-inactive', '비활성 소유 카드', inactiveConversationId, 'user-inactive'),
    ],
    edges: [],
    version: 1,
    updatedAt: linkedAt,
  }))
  await writeFile(path.join(dataDirectory, '_ai-conversation-origins.json'), JSON.stringify([
    { conversationId, mapId, cardId, startedBy: 'user-admin', linkedAt },
    { conversationId: legacyConversationId, mapId, cardId: 'card-legacy', linkedAt },
    { conversationId: cardOwnerConversationId, mapId, cardId: 'card-owner-link', linkedAt },
    { conversationId: attributionConversationId, mapId, cardId: 'card-owner-attribution', linkedAt },
    { conversationId: viewerConversationId, mapId, cardId: 'card-viewer', startedBy: 'user-public-viewer', linkedAt },
    { conversationId: inactiveConversationId, mapId, cardId: 'card-inactive', startedBy: 'user-inactive', linkedAt },
  ]))
  await writeFile(path.join(dataDirectory, '_ai-conversation-attributions.json'), JSON.stringify([{
    mapId,
    cardId: 'card-owner-attribution',
    conversationId: attributionConversationId,
    authorName: '테스트 AI',
    startedBy: 'user-admin',
    linkedAt,
  }]))
  await writeFile(path.join(dataDirectory, '_users.json'), JSON.stringify([{
    id: 'user-inactive',
    name: '비활성 편집자',
    email: 'inactive@mind.local',
    role: 'editor',
    active: false,
    salt: '00',
    passwordHash: '00'.repeat(64),
  }]))

  const port = 45_000 + Math.floor(Math.random() * 5_000)
  const baseUrl = `http://127.0.0.1:${port}`
  const server = spawn(process.execPath, ['server/index.mjs'], {
    cwd: projectDirectory,
    windowsHide: true,
    env: {
      ...process.env,
      MNP_DATA_DIR: dataDirectory,
      MNP_API_HOST: '127.0.0.1',
      MNP_API_PORT: String(port),
      MNP_WEB_PORT: String(port),
      MNP_EVENT_HEARTBEAT_INTERVAL_MS: '60000',
    },
    stdio: 'ignore',
  })
  const localController = new AbortController()
  const remoteController = new AbortController()
  const otherAccountController = new AbortController()

  try {
    await waitForServer(baseUrl)
    const token = (await readFile(path.join(dataDirectory, '_integration-token'), 'utf8')).trim()
    const headers = { Authorization: `Bearer ${token}` }
    const accountHeaders = { ...headers, 'X-MNP-AI-Editor-Id': 'user-admin' }
    const remoteHeaders = {
      ...headers,
      'X-MNP-Selection-Device-Address': '10.77.15.55',
    }
    const endpointFor = (id) => `${baseUrl}/api/integrations/aionui/conversations/${id}/mindnprogress`
    const endpoint = endpointFor(conversationId)

    const unauthorized = await fetch(endpoint)
    assert.equal(unauthorized.status, 401)

    const missingResponse = await fetch(`${baseUrl}/api/integrations/aionui/conversations/not-linked/mindnprogress`, { headers: accountHeaders })
    assert.equal(missingResponse.status, 200)
    assert.deepEqual(await missingResponse.json(), {
      conversationId: 'not-linked',
      exists: false,
      target: null,
      selectionAvailable: false,
      matchingViewCount: 0,
      localSelectionAvailable: false,
      localViewCount: 0,
      message: 'MindNProgress 카드에 연결된 대화를 찾을 수 없습니다.',
    })

    let lookup = await (await fetch(endpoint, { headers })).json()
    assert.deepEqual(lookup, {
      conversationId,
      exists: true,
      target: {
        mapId,
        documentTitle: '대화 탐색 문서',
        cardId,
        cardTitle: '대화 탐색 카드',
        archived: false,
      },
      selectionAvailable: false,
      matchingViewCount: 0,
      localSelectionAvailable: false,
      localViewCount: 0,
      message: 'MindNProgress에 연결된 대화입니다.',
    })

    const matchingHeaderLookup = await fetch(endpoint, { headers: accountHeaders })
    assert.equal(matchingHeaderLookup.status, 200)

    const mismatchingHeaderLookup = await fetch(endpoint, {
      headers: { ...headers, 'X-MNP-AI-Editor-Id': 'user-public-viewer' },
    })
    assert.equal(mismatchingHeaderLookup.status, 403)
    assert.equal((await mismatchingHeaderLookup.json()).code, 'MNP_SELECTION_ACCOUNT_MISMATCH')

    const missingAccount = await fetch(`${endpointFor(legacyConversationId)}/select`, { method: 'POST', headers })
    assert.equal(missingAccount.status, 400)
    assert.equal((await missingAccount.json()).code, 'MNP_SELECTION_ACCOUNT_REQUIRED')

    const trustedLegacyAccount = await fetch(`${endpointFor(legacyConversationId)}/select`, {
      method: 'POST',
      headers: accountHeaders,
    })
    assert.equal(trustedLegacyAccount.status, 409)
    assert.equal((await trustedLegacyAccount.json()).code, 'MNP_MATCHING_VIEW_NOT_CONNECTED')

    for (const unavailableConversationId of [viewerConversationId, inactiveConversationId]) {
      const unavailableAccount = await fetch(`${endpointFor(unavailableConversationId)}/select`, { method: 'POST', headers })
      assert.equal(unavailableAccount.status, 403)
      assert.equal((await unavailableAccount.json()).code, 'MNP_SELECTION_ACCOUNT_UNAVAILABLE')
    }

    const invalidDevice = await fetch(`${endpoint}/select`, {
      method: 'POST',
      headers: { ...headers, 'X-MNP-Selection-Device-Address': 'not-an-ip-address' },
    })
    assert.equal(invalidDevice.status, 400)
    assert.equal((await invalidDevice.json()).code, 'MNP_SELECTION_DEVICE_ADDRESS_INVALID')

    const noMatchingView = await fetch(`${endpoint}/select`, { method: 'POST', headers })
    assert.equal(noMatchingView.status, 409)
    assert.equal((await noMatchingView.json()).code, 'MNP_MATCHING_VIEW_NOT_CONNECTED')

    const localStream = await fetch(`${baseUrl}/api/events?clientId=local-navigation`, {
      headers: accountHeaders,
      signal: localController.signal,
    })
    const remoteStream = await fetch(`${baseUrl}/api/events?clientId=remote-navigation`, {
      headers: { ...accountHeaders, 'X-Forwarded-For': '10.77.15.55' },
      signal: remoteController.signal,
    })
    const otherAccountStream = await fetch(`${baseUrl}/api/events?clientId=other-account-navigation`, {
      headers: { ...headers, 'X-Forwarded-For': '10.77.15.55' },
      signal: otherAccountController.signal,
    })
    assert.equal(localStream.status, 200)
    assert.equal(remoteStream.status, 200)
    assert.equal(otherAccountStream.status, 200)
    const localReader = localStream.body.getReader()
    const remoteReader = remoteStream.body.getReader()
    const otherAccountReader = otherAccountStream.body.getReader()
    await readUntil(localReader, /"type":"connected"/)
    await readUntil(remoteReader, /"type":"connected"/)
    await readUntil(otherAccountReader, /"type":"connected"/)

    lookup = await (await fetch(endpoint, { headers })).json()
    assert.equal(lookup.selectionAvailable, true)
    assert.equal(lookup.matchingViewCount, 1)
    assert.equal(lookup.localSelectionAvailable, true)
    assert.equal(lookup.localViewCount, 1)

    for (const serverOwnedConversationId of [cardOwnerConversationId, attributionConversationId]) {
      const fallbackLookup = await (await fetch(endpointFor(serverOwnedConversationId), { headers })).json()
      assert.equal(fallbackLookup.selectionAvailable, true)
      assert.equal(fallbackLookup.matchingViewCount, 1)
    }

    const remoteLookup = await (await fetch(endpoint, { headers: remoteHeaders })).json()
    assert.equal(remoteLookup.selectionAvailable, true)
    assert.equal(remoteLookup.matchingViewCount, 1)

    const remoteSelectionResponse = await fetch(`${endpoint}/select`, {
      method: 'POST',
      headers: remoteHeaders,
    })
    assert.equal(remoteSelectionResponse.status, 200)
    const remoteSelection = await remoteSelectionResponse.json()
    assert.equal(remoteSelection.selected, true)
    assert.equal(remoteSelection.deliveredClientCount, 1)
    assert.deepEqual(remoteSelection.target, lookup.target)
    assert.doesNotMatch(JSON.stringify(remoteSelection), /user-admin|10\.77\.15\.55|selectionDeviceKey|recordedStartedBy/)

    const remoteEvents = await readUntil(remoteReader, new RegExp(remoteSelection.requestedAt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.match(remoteEvents, /"type":"ai-conversation-selection-requested"/)
    assert.match(remoteEvents, new RegExp(`"mapId":"${mapId}"`))
    assert.match(remoteEvents, new RegExp(`"cardId":"${cardId}"`))

    const localSelectionResponse = await fetch(`${endpoint}/select`, { method: 'POST', headers: accountHeaders })
    assert.equal(localSelectionResponse.status, 200)
    const localSelection = await localSelectionResponse.json()
    assert.equal(localSelection.deliveredClientCount, 1)

    const localEvents = await readUntil(localReader, new RegExp(localSelection.requestedAt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.match(localEvents, new RegExp(`"mapId":"${mapId}"`))
    assert.match(localEvents, new RegExp(`"cardId":"${cardId}"`))
    assert.doesNotMatch(localEvents, new RegExp(remoteSelection.requestedAt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

    const mismatchingSelection = await fetch(`${endpoint}/select`, {
      method: 'POST',
      headers: { ...headers, 'X-MNP-AI-Editor-Id': 'user-public-viewer' },
    })
    assert.equal(mismatchingSelection.status, 403)
    const mismatchingSelectionBody = await mismatchingSelection.json()
    assert.equal(mismatchingSelectionBody.code, 'MNP_SELECTION_ACCOUNT_MISMATCH')
    assert.doesNotMatch(JSON.stringify(mismatchingSelectionBody), /user-admin|user-public-viewer/)

    const unexpectedRemoteEvents = await readFor(remoteReader, 250)
    assert.doesNotMatch(unexpectedRemoteEvents, /"type":"ai-conversation-selection-requested"/)
    const otherAccountEvents = await readFor(otherAccountReader, 250)
    assert.doesNotMatch(otherAccountEvents, /"type":"ai-conversation-selection-requested"/)
    const unexpectedLocalEvents = await readFor(localReader, 250)
    assert.doesNotMatch(unexpectedLocalEvents, /"type":"ai-conversation-selection-requested"/)

    await localReader.cancel()
    await remoteReader.cancel()
    await otherAccountReader.cancel()
  } finally {
    localController.abort()
    remoteController.abort()
    otherAccountController.abort()
    await stopProcess(server)
    await rm(dataDirectory, { recursive: true, force: true })
  }
})
