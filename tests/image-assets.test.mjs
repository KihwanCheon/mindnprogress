import assert from 'node:assert/strict'
import test from 'node:test'
import {
  detectImageAssetType,
  imageAssetMimeType,
  isValidImageAssetId,
  isValidImageNodeData,
} from '../server/lib/imageAssets.mjs'

test('허용한 이미지 형식을 파일 시그니처로 판별한다', () => {
  assert.deepEqual(
    detectImageAssetType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    { extension: 'png', mimeType: 'image/png' },
  )
  assert.deepEqual(
    detectImageAssetType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])),
    { extension: 'jpg', mimeType: 'image/jpeg' },
  )
  assert.deepEqual(
    detectImageAssetType(Buffer.from('GIF89a', 'ascii')),
    { extension: 'gif', mimeType: 'image/gif' },
  )
  assert.deepEqual(
    detectImageAssetType(Buffer.from('RIFF0000WEBP', 'ascii')),
    { extension: 'webp', mimeType: 'image/webp' },
  )
})

test('SVG와 실행 가능한 임의 파일은 이미지 자산으로 받지 않는다', () => {
  assert.equal(detectImageAssetType(Buffer.from('<svg><script /></svg>')), null)
  assert.equal(detectImageAssetType(Buffer.from('not an image')), null)
})

test('이미지 자산 ID와 MIME 형식을 제한한다', () => {
  const assetId = `${'a'.repeat(32)}.png`
  assert.equal(isValidImageAssetId(assetId), true)
  assert.equal(imageAssetMimeType(assetId), 'image/png')
  assert.equal(isValidImageAssetId('../image.png'), false)
  assert.equal(isValidImageAssetId(`${'a'.repeat(32)}.svg`), false)
})

test('문서에 저장되는 이미지 노드 메타데이터를 검증한다', () => {
  const data = {
    assetId: `${'b'.repeat(32)}.webp`,
    fileName: '화면.webp',
    mimeType: 'image/webp',
    naturalWidth: 1920,
    naturalHeight: 1080,
    displayWidth: 480,
    displayHeight: 270,
  }
  assert.equal(isValidImageNodeData(data), true)
  assert.equal(isValidImageNodeData({ ...data, mimeType: 'image/png' }), false)
  assert.equal(isValidImageNodeData({ ...data, displayWidth: 0 }), false)
})
