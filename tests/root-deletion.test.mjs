import assert from 'node:assert/strict'
import test from 'node:test'
import { rootDeletionPlan } from '../src/utils/rootDeletion.mjs'

function node(id, kind) {
  return { id, data: { kind } }
}

function edge(id, source, target, relation = 'hierarchy') {
  return { id, source, target, data: { relation } }
}

test('일반 카드는 자식 수와 관계없이 기존 삭제 동작을 유지한다', () => {
  assert.deepEqual(rootDeletionPlan([
    node('branch', 'branch'),
    node('child-a', 'task'),
    node('child-b', 'task'),
  ], [
    edge('a', 'branch', 'child-a'),
    edge('b', 'branch', 'child-b'),
  ], 'branch'), {
    allowed: true,
    reason: null,
    promotedNodeId: null,
    message: '',
  })
})

test('최상위 카드의 직계 자식이 하나면 해당 카드를 승격 대상으로 정한다', () => {
  const plan = rootDeletionPlan([
    node('root', 'root'),
    node('branch', 'branch'),
  ], [edge('root-branch', 'root', 'branch')], 'root')

  assert.equal(plan.allowed, true)
  assert.equal(plan.promotedNodeId, 'branch')
})

test('지식선은 최상위 카드의 직계 자식 수에 포함하지 않는다', () => {
  const plan = rootDeletionPlan([
    node('root', 'root'),
    node('branch', 'branch'),
    node('knowledge', 'task'),
  ], [
    edge('root-branch', 'root', 'branch'),
    edge('root-knowledge', 'root', 'knowledge', 'knowledge'),
  ], 'root')

  assert.equal(plan.allowed, true)
  assert.equal(plan.promotedNodeId, 'branch')
})

test('최상위 카드의 직계 자식이 여러 개면 삭제를 거부하고 개수를 안내한다', () => {
  const plan = rootDeletionPlan([
    node('root', 'root'),
    node('branch-a', 'branch'),
    node('branch-b', 'branch'),
  ], [
    edge('a', 'root', 'branch-a'),
    edge('b', 'root', 'branch-b'),
  ], 'root')

  assert.equal(plan.allowed, false)
  assert.equal(plan.reason, 'root-has-multiple-children')
  assert.match(plan.message, /직계 자식이 2개/)
})

test('자식이 없는 최상위 카드는 빈 문서를 만들지 않도록 삭제를 거부한다', () => {
  const plan = rootDeletionPlan([node('root', 'root')], [], 'root')

  assert.equal(plan.allowed, false)
  assert.equal(plan.reason, 'root-has-no-child')
  assert.match(plan.message, /문서 메뉴에서 휴지통/)
})
