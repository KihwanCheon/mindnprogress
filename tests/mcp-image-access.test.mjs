import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { imageCardLocalAccess } from '../mcp/imageAccess.mjs'

const dataDirectory = path.resolve('server', 'data')
const mapId = 'map-image-access'
const imageCard = {
  id: 'image-card',
  data: {
    kind: 'image',
    image: {
      assetId: '0123456789abcdef0123456789abcdef.png',
      fileName: 'image.png',
      mimeType: 'image/png',
      naturalWidth: 1920,
      naturalHeight: 1080,
    },
  },
}

test('이미지 카드의 검증된 로컬 원본 경로를 계산한다', () => {
  assert.deepEqual(imageCardLocalAccess(dataDirectory, mapId, imageCard), {
    mode: 'local-file',
    localPath: path.resolve(dataDirectory, '_assets', mapId, imageCard.data.image.assetId),
    fileName: 'image.png',
    mimeType: 'image/png',
    naturalWidth: 1920,
    naturalHeight: 1080,
  })
})

test('일반 카드와 올바르지 않은 이미지 메타데이터에는 경로를 제공하지 않는다', () => {
  assert.equal(imageCardLocalAccess(dataDirectory, mapId, { data: { kind: 'task' } }), null)
  assert.equal(imageCardLocalAccess(dataDirectory, '../outside', imageCard), null)
  assert.equal(imageCardLocalAccess(dataDirectory, mapId, {
    ...imageCard,
    data: { ...imageCard.data, image: { ...imageCard.data.image, assetId: '../outside.png' } },
  }), null)
  assert.equal(imageCardLocalAccess(dataDirectory, mapId, {
    ...imageCard,
    data: { ...imageCard.data, image: { ...imageCard.data.image, mimeType: 'image/jpeg' } },
  }), null)
})
