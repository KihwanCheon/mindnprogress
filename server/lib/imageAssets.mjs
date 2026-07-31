const IMAGE_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

const IMAGE_ASSET_ID_PATTERN = /^[a-f0-9]{32}\.(?:png|jpg|gif|webp)$/

export function detectImageAssetType(buffer) {
  if (!Buffer.isBuffer(buffer)) return null
  if (buffer.length >= 8
    && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { extension: 'png', mimeType: IMAGE_TYPES.png }
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { extension: 'jpg', mimeType: IMAGE_TYPES.jpg }
  }
  if (buffer.length >= 6) {
    const signature = buffer.subarray(0, 6).toString('ascii')
    if (signature === 'GIF87a' || signature === 'GIF89a') {
      return { extension: 'gif', mimeType: IMAGE_TYPES.gif }
    }
  }
  if (buffer.length >= 12
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { extension: 'webp', mimeType: IMAGE_TYPES.webp }
  }
  return null
}

export function isValidImageAssetId(assetId) {
  return typeof assetId === 'string' && IMAGE_ASSET_ID_PATTERN.test(assetId)
}

export function imageAssetMimeType(assetId) {
  if (!isValidImageAssetId(assetId)) return null
  return IMAGE_TYPES[assetId.slice(assetId.lastIndexOf('.') + 1)] ?? null
}

export function isValidImageNodeData(data) {
  if (!data || typeof data !== 'object' || !isValidImageAssetId(data.assetId)) return false
  if (typeof data.fileName !== 'string' || data.fileName.length < 1 || data.fileName.length > 240) return false
  if (data.mimeType !== imageAssetMimeType(data.assetId)) return false
  return ['naturalWidth', 'naturalHeight', 'displayWidth', 'displayHeight'].every((key) => {
    const value = Number(data[key])
    return Number.isFinite(value) && value > 0 && value <= 20_000
  })
}
