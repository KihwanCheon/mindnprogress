import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { mergeHistoryCleanupBackup, readHistoryCleanupBackup } from '../server/lib/historyCleanupBackup.mjs'

const { values } = parseArgs({ options: {
  'data-dir': { type: 'string' }, backup: { type: 'string' }, 'output-dir': { type: 'string' },
} })
if (!values['data-dir'] || !values.backup || !values['output-dir']) {
  throw new Error('--data-dir, --backup, --output-dir 경로를 모두 지정하세요. 운영 파일은 변경하지 않습니다.')
}
const data = path.resolve(values['data-dir'])
const output = path.resolve(values['output-dir'])
const relative = path.relative(data, output)
if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
  throw new Error('출력은 운영 데이터 디렉터리 밖의 새 디렉터리를 지정하세요.')
}
const load = async (name, fallback) => {
  try { return JSON.parse(await readFile(path.join(data, name), 'utf8')) } catch (error) {
    if (error.code === 'ENOENT' && fallback !== undefined) return fallback
    throw error
  }
}
const backup = await readHistoryCleanupBackup(path.resolve(values.backup))
const current = { delegations: await load('_ai-delegations.json'),
  local: await load('_workspace-pool.json', { leases: {} }),
  remote: await load('_remote-workspace-pools.json', { leases: {} }) }
const merged = mergeHistoryCleanupBackup(backup, current)
await mkdir(output) // 기존 출력이나 운영 파일을 덮어쓰지 않는다.
for (const [name, value] of [['_ai-delegations.json', merged.delegations],
  ['_workspace-pool.json', merged.local], ['_remote-workspace-pools.json', merged.remote]]) {
  await writeFile(path.join(output, name), JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' })
}
if (Object.keys(backup.localResultFiles ?? {}).length) {
  const resultRoot = path.join(output, 'job-results')
  await mkdir(resultRoot)
  for (const [id, text] of Object.entries(backup.localResultFiles)) {
    const file = path.resolve(resultRoot, `${id}.json`)
    if (path.dirname(file) !== resultRoot) throw new Error('작업 결과 복원 경로가 올바르지 않습니다.')
    await writeFile(file, text, { encoding: 'utf8', flag: 'wx' })
  }
}
console.log('복원 후보를 만들었습니다. 현재 기록을 우선 보존했으며 운영 파일은 변경하지 않았습니다.')
console.log(output)
console.log('서버를 정상 종료한 상태에서 다시 생성·검토하고 적용하세요. 복원 점검 중에는 MNP_COMPLETED_AI_CLEANUP_DISABLED=1을 사용하세요.')
