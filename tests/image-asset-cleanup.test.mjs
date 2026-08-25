import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { cleanupUnreferencedImageAssets } from '../server/lib/imageAssetCleanup.mjs'

function imageNode(assetId) {
  return { id: `node-${assetId}`, data: { kind: 'image', image: { assetId } } }
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(value), 'utf8')
}

async function writeAsset(dataDirectory, mapId, assetId, modifiedAt) {
  const file = path.join(dataDirectory, '_assets', mapId, assetId)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, assetId, 'utf8')
  await utimes(file, modifiedAt, modifiedAt)
  return file
}

test('현재 문서와 변경 이력 및 일일 백업이 참조하는 이미지는 보존하고 오래된 미참조 자산만 삭제한다', async () => {
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'mindnprogress-image-cleanup-'))
  const mapId = 'map-image-cleanup'
  const currentAsset = `${'a'.repeat(32)}.png`
  const historyAsset = `${'b'.repeat(32)}.jpg`
  const dailyBackupAsset = `${'c'.repeat(32)}.gif`
  const orphanAsset = `${'d'.repeat(32)}.webp`
  const recentOrphanAsset = `${'e'.repeat(32)}.png`
  const now = Date.parse('2026-08-25T01:00:00.000Z')
  const old = new Date(now - 2 * 60 * 60 * 1_000)
  const recent = new Date(now - 30 * 60 * 1_000)

  try {
    await writeJson(path.join(dataDirectory, `${mapId}.json`), { id: mapId, nodes: [imageNode(currentAsset)], edges: [] })
    await writeJson(path.join(dataDirectory, '_history', mapId, 'history.json'), {
      mapId,
      map: { id: mapId, nodes: [imageNode(historyAsset)], edges: [] },
    })
    await writeJson(path.join(dataDirectory, '_daily-backups', mapId, '2026-08-24.json'), {
      mapId,
      map: { id: mapId, nodes: [imageNode(dailyBackupAsset)], edges: [] },
    })

    const currentFile = await writeAsset(dataDirectory, mapId, currentAsset, old)
    const historyFile = await writeAsset(dataDirectory, mapId, historyAsset, old)
    const dailyBackupFile = await writeAsset(dataDirectory, mapId, dailyBackupAsset, old)
    const orphanFile = await writeAsset(dataDirectory, mapId, orphanAsset, old)
    const recentOrphanFile = await writeAsset(dataDirectory, mapId, recentOrphanAsset, recent)

    const summary = await cleanupUnreferencedImageAssets({
      dataDirectory,
      minimumAgeMs: 60 * 60 * 1_000,
      now,
    })

    assert.deepEqual(summary, {
      mapsScanned: 1,
      assetsScanned: 5,
      referencedAssets: 3,
      recentUnreferencedAssets: 1,
      deletedAssets: 1,
      skippedMaps: [],
    })
    await Promise.all([access(currentFile), access(historyFile), access(dailyBackupFile), access(recentOrphanFile)])
    await assert.rejects(access(orphanFile), { code: 'ENOENT' })
  } finally {
    await rm(dataDirectory, { recursive: true, force: true })
  }
})

test('참조 스냅샷을 하나라도 읽지 못하면 해당 문서의 이미지를 삭제하지 않는다', async () => {
  const dataDirectory = await mkdtemp(path.join(tmpdir(), 'mindnprogress-image-cleanup-corrupt-'))
  const mapId = 'map-image-cleanup-corrupt'
  const orphanAsset = `${'f'.repeat(32)}.png`

  try {
    await writeJson(path.join(dataDirectory, `${mapId}.json`), { id: mapId, nodes: [], edges: [] })
    const corruptHistoryFile = path.join(dataDirectory, '_history', mapId, 'corrupt.json')
    await mkdir(path.dirname(corruptHistoryFile), { recursive: true })
    await writeFile(corruptHistoryFile, '{', 'utf8')
    const orphanFile = await writeAsset(dataDirectory, mapId, orphanAsset, new Date(0))

    const summary = await cleanupUnreferencedImageAssets({ dataDirectory, minimumAgeMs: 0 })

    assert.equal(summary.mapsScanned, 0)
    assert.equal(summary.deletedAssets, 0)
    assert.equal(summary.skippedMaps.length, 1)
    assert.equal(summary.skippedMaps[0].mapId, mapId)
    await access(orphanFile)
  } finally {
    await rm(dataDirectory, { recursive: true, force: true })
  }
})
