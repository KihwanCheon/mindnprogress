import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  mapContentsEqual,
  reconcileRemoteMapContent,
} from '../src/utils/mapDocumentSync.mjs'

const node = (id, label) => ({
  id,
  type: 'mind',
  position: { x: 0, y: 0 },
  data: { label },
})

const document = (version, nodes, edges = []) => ({ version, nodes, edges })

test('버전 메타데이터가 달라도 노드와 연결선이 같으면 동일하게 판단한다', () => {
  const first = document(1, [node('root', '루트')])
  const second = document(2, structuredClone(first.nodes))

  assert.equal(mapContentsEqual(first, second), true)
})

test('로컬 수정이 없으면 원격 카드 추가와 설명 변경을 그대로 반영하고 저장하지 않는다', () => {
  const base = document(233, [node('root', '기본 설명')])
  const local = document(233, structuredClone(base.nodes))
  const remote = document(236, [
    node('root', '갱신된 설명'),
    node('safe-area', 'Q&A 상단 Safe Area 겹침 수정'),
  ])

  const result = reconcileRemoteMapContent(base, local, remote)

  assert.deepEqual(result.nodes, remote.nodes)
  assert.equal(result.hadLocalChanges, false)
  assert.equal(result.needsSave, false)
  assert.equal(result.conflicts, 0)
})

test('로컬과 원격이 서로 다른 항목을 수정하면 병합한 내용만 다시 저장한다', () => {
  const base = document(10, [node('root', '루트'), node('local', '수정 전')])
  const local = document(10, [node('root', '루트'), node('local', '내 수정')])
  const remote = document(11, [node('root', '원격 수정'), node('local', '수정 전'), node('remote', '새 카드')])

  const result = reconcileRemoteMapContent(base, local, remote)

  assert.deepEqual(result.nodes, [
    node('root', '원격 수정'),
    node('local', '내 수정'),
    node('remote', '새 카드'),
  ])
  assert.equal(result.hadLocalChanges, true)
  assert.equal(result.needsSave, true)
  assert.equal(result.conflicts, 0)
})

test('저장 요청 중 추가된 로컬 수정도 서버 응답과 다시 병합한다', () => {
  const sent = document(20, [node('root', '보낸 내용')])
  const current = document(20, [node('root', '보낸 뒤 추가 수정')])
  const saved = document(21, [node('root', '보낸 내용'), node('server', '서버 추가')])

  const result = reconcileRemoteMapContent(sent, current, saved)

  assert.deepEqual(result.nodes, [node('root', '보낸 뒤 추가 수정'), node('server', '서버 추가')])
  assert.equal(result.needsSave, true)
})
