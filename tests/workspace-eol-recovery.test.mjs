import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeTrackedEolRecovery } from '../server/lib/workspaceEolRecovery.mjs'

test('줄바꿈 복구 승인은 정확한 HEAD·파일·원문 해시만 허용한다', () => {
  const file = { path: 'Documentation/검증.json', expectedSha256: 'a'.repeat(64) }
  const plan = { expectedHead: 'b'.repeat(40), files: [file] }
  assert.deepEqual(normalizeTrackedEolRecovery(plan), plan)
  for (const invalid of [null, {}, { ...plan, extra: true }, { ...plan, files: [] },
    { ...plan, expectedHead: 'HEAD' }, { ...plan, files: [file, file] },
    ...['/outside', '../outside', 'a/../../b', 'C:/outside', '.git/index', 'a/.Git/index', 'a\\b', 'a./b', 'a\nb'].map(value => ({ ...plan, files: [{ ...file, path: value }] })),
    { ...plan, files: [{ ...file, expectedSha256: 'unknown' }] }]) {
    assert.throws(() => normalizeTrackedEolRecovery(invalid), error => error.reasonCode === 'INTEGRATION_RECOVERY_UNSAFE')
  }
})
