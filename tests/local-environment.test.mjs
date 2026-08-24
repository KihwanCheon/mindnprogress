import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { loadLocalEnvironment } from '../scripts/local-environment.mjs'

test('로컬 환경 파일이 없으면 프로세스 환경을 변경하지 않는다', () => {
  assert.equal(loadLocalEnvironment(path.join(tmpdir(), 'missing-mnp-local-environment')), false)
})

test('로컬 환경 파일은 없는 값만 채우고 기존 프로세스 값을 우선한다', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'mnp-local-environment-'))
  const environmentFile = path.join(directory, '.env.local')
  const existingKey = 'MNP_LOCAL_ENV_EXISTING_TEST'
  const addedKey = 'MNP_LOCAL_ENV_ADDED_TEST'
  const previousExisting = process.env[existingKey]
  const previousAdded = process.env[addedKey]

  try {
    process.env[existingKey] = 'process-value'
    delete process.env[addedKey]
    await writeFile(environmentFile, `${existingKey}=file-value\n${addedKey}=added-value\n`, 'utf8')

    assert.equal(loadLocalEnvironment(environmentFile), true)
    assert.equal(process.env[existingKey], 'process-value')
    assert.equal(process.env[addedKey], 'added-value')
  } finally {
    if (previousExisting === undefined) delete process.env[existingKey]
    else process.env[existingKey] = previousExisting
    if (previousAdded === undefined) delete process.env[addedKey]
    else process.env[addedKey] = previousAdded
    await rm(directory, { recursive: true, force: true })
  }
})
