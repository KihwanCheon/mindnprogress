import path from 'node:path'
import { imageAssetMimeType, isValidImageAssetId } from '../server/lib/imageAssets.mjs'

const MAP_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/

export function imageCardLocalAccess(dataDirectory, mapId, card) {
  if (!MAP_ID_PATTERN.test(String(mapId ?? '')) || card?.data?.kind !== 'image') return null
  const image = card.data.image
  if (!image || !isValidImageAssetId(image.assetId)) return null
  const mimeType = imageAssetMimeType(image.assetId)
  if (!mimeType || image.mimeType !== mimeType) return null

  const assetDirectory = path.resolve(dataDirectory, '_assets', mapId)
  const localPath = path.resolve(assetDirectory, image.assetId)
  if (path.dirname(localPath) !== assetDirectory) return null

  return {
    mode: 'local-file',
    localPath,
    fileName: image.fileName,
    mimeType,
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
  }
}
