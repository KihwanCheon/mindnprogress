import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  cleanupUnreferencedImageAssets,
  DEFAULT_IMAGE_ASSET_MINIMUM_AGE_MS,
} from '../server/lib/imageAssetCleanup.mjs'

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argumentsList = process.argv.slice(2)

function argumentValue(name) {
  const index = argumentsList.indexOf(name)
  return index >= 0 ? argumentsList[index + 1] : undefined
}

const dataDirectory = path.resolve(argumentValue('--data-dir') || process.env.MNP_DATA_DIR || path.join(projectDirectory, 'server', 'data'))
const configuredMinimumAgeHours = Number(argumentValue('--minimum-age-hours') ?? process.env.MNP_IMAGE_GC_MIN_AGE_HOURS)
const minimumAgeMs = Number.isFinite(configuredMinimumAgeHours) && configuredMinimumAgeHours >= 0
  ? configuredMinimumAgeHours * 60 * 60 * 1_000
  : DEFAULT_IMAGE_ASSET_MINIMUM_AGE_MS

const summary = await cleanupUnreferencedImageAssets({
  dataDirectory,
  minimumAgeMs,
  dryRun: argumentsList.includes('--dry-run'),
})

console.log(`[MindNProgress] 이미지 자산 검사: 문서 ${summary.mapsScanned}개, 파일 ${summary.assetsScanned}개`)
console.log(`[MindNProgress] 참조 중 ${summary.referencedAssets}개, 유예 중 ${summary.recentUnreferencedAssets}개, 삭제 ${summary.deletedAssets}개`)
for (const skipped of summary.skippedMaps) {
  console.warn(`[MindNProgress] ${skipped.mapId} 이미지 자산은 참조 확인 실패로 삭제하지 않았습니다: ${skipped.reason}`)
}
