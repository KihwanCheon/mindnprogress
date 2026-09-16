import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { parseEnv } from 'node:util'
import {
  loadLocalEnvironment,
  loadMindNProgressEnvironment,
  sampleConfigFile,
  userConfigDirectory,
  userConfigFile,
} from '../scripts/local-environment.mjs'

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

test('설정 폴더와 설정 파일은 MNP_CONFIG_DIR을 우선하고 없으면 홈의 .mnp/mnp.conf를 쓴다', () => {
  const previous = process.env.MNP_CONFIG_DIR
  try {
    delete process.env.MNP_CONFIG_DIR
    assert.equal(userConfigDirectory(), path.join(homedir(), '.mnp'))
    assert.equal(userConfigFile(), path.join(homedir(), '.mnp', 'mnp.conf'))
    process.env.MNP_CONFIG_DIR = path.join(tmpdir(), 'mnp-custom-config')
    assert.equal(userConfigDirectory(), path.join(tmpdir(), 'mnp-custom-config'))
    assert.equal(userConfigFile(), path.join(tmpdir(), 'mnp-custom-config', 'mnp.conf'))
  } finally {
    if (previous === undefined) delete process.env.MNP_CONFIG_DIR
    else process.env.MNP_CONFIG_DIR = previous
  }
})

test('프로세스 값, 저장소 .env.local, 설정 폴더 mnp.conf 순으로 우선한다', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'mnp-layered-environment-'))
  const localFile = path.join(directory, '.env.local')
  const userFile = path.join(directory, 'mnp.conf')
  const keys = {
    process: 'MNP_LAYERED_PROCESS_TEST',
    local: 'MNP_LAYERED_LOCAL_TEST',
    user: 'MNP_LAYERED_USER_TEST',
  }
  const previous = Object.fromEntries(Object.values(keys).map((key) => [key, process.env[key]]))

  try {
    for (const key of Object.values(keys)) delete process.env[key]
    process.env[keys.process] = 'process-value'
    await writeFile(localFile, `${keys.process}=local-value\n${keys.local}=local-value\n`, 'utf8')
    await writeFile(userFile, `${keys.process}=user-value\n${keys.local}=user-value\n${keys.user}=user-value\n`, 'utf8')

    const loaded = loadMindNProgressEnvironment({ localEnvironmentFile: localFile, userEnvironmentFile: userFile })

    assert.deepEqual(loaded, [localFile, userFile])
    assert.equal(process.env[keys.process], 'process-value')
    assert.equal(process.env[keys.local], 'local-value')
    assert.equal(process.env[keys.user], 'user-value')
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(directory, { recursive: true, force: true })
  }
})

test('없는 설정 파일은 건너뛰고 읽은 파일만 반환한다', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'mnp-partial-environment-'))
  const userFile = path.join(directory, 'mnp.conf')
  const key = 'MNP_PARTIAL_USER_TEST'
  const previousValue = process.env[key]

  try {
    delete process.env[key]
    await writeFile(userFile, `${key}=user-value\n`, 'utf8')

    const loaded = loadMindNProgressEnvironment({
      localEnvironmentFile: path.join(directory, 'missing.env.local'),
      userEnvironmentFile: userFile,
    })

    assert.deepEqual(loaded, [userFile])
    assert.equal(process.env[key], 'user-value')
  } finally {
    if (previousValue === undefined) delete process.env[key]
    else process.env[key] = previousValue
    await rm(directory, { recursive: true, force: true })
  }
})

test('설정 폴더에 mnp.conf가 없으면 저장소 샘플 설정을 대신 읽는다', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'mnp-sample-fallback-'))
  const sampleFile = path.join(directory, 'mnp.conf.sample')
  const key = 'MNP_SAMPLE_FALLBACK_TEST'
  const previousValue = process.env[key]

  try {
    delete process.env[key]
    await writeFile(sampleFile, `${key}=sample-value\n`, 'utf8')

    const loaded = loadMindNProgressEnvironment({
      localEnvironmentFile: path.join(directory, 'missing.env.local'),
      userEnvironmentFile: path.join(directory, 'missing', 'mnp.conf'),
      sampleEnvironmentFile: sampleFile,
    })

    assert.deepEqual(loaded, [sampleFile])
    assert.equal(process.env[key], 'sample-value')
  } finally {
    if (previousValue === undefined) delete process.env[key]
    else process.env[key] = previousValue
    await rm(directory, { recursive: true, force: true })
  }
})

test('설정 폴더에 mnp.conf가 있으면 샘플 설정을 읽지 않는다', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'mnp-sample-skipped-'))
  const userFile = path.join(directory, 'mnp.conf')
  const sampleFile = path.join(directory, 'mnp.conf.sample')
  const userKey = 'MNP_SAMPLE_SKIPPED_USER_TEST'
  const sampleKey = 'MNP_SAMPLE_SKIPPED_SAMPLE_TEST'
  const previous = { [userKey]: process.env[userKey], [sampleKey]: process.env[sampleKey] }

  try {
    delete process.env[userKey]
    delete process.env[sampleKey]
    await writeFile(userFile, `${userKey}=user-value\n`, 'utf8')
    await writeFile(sampleFile, `${sampleKey}=sample-value\n`, 'utf8')

    const loaded = loadMindNProgressEnvironment({
      localEnvironmentFile: path.join(directory, 'missing.env.local'),
      userEnvironmentFile: userFile,
      sampleEnvironmentFile: sampleFile,
    })

    assert.deepEqual(loaded, [userFile])
    assert.equal(process.env[userKey], 'user-value')
    assert.equal(process.env[sampleKey], undefined)
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(directory, { recursive: true, force: true })
  }
})

test('저장소 샘플 설정은 공개 주소와 비로그인 공개 뷰어를 켜지 않는다', async () => {
  // 샘플은 ~/.mnp/mnp.conf가 없을 때 실제 설정으로 읽히므로 예시 도메인이나 공개 뷰어가 켜지면 안 된다.
  const sample = parseEnv(await readFile(sampleConfigFile(), 'utf8'))

  assert.equal(sample.MNP_PUBLIC_URL, undefined)
  assert.equal(sample.MNP_AIONUI_WEB_URL, undefined)
  assert.equal(sample.MNP_DEV_ALLOWED_HOSTS, undefined)
  assert.notEqual(String(sample.MNP_PUBLIC_VIEWER_ENABLED ?? '').toLowerCase(), 'true')
})
