import assert from 'node:assert/strict'
import test from 'node:test'
import { splitImageFileName, uniqueImageFileName } from '../src/utils/imageFileNames.mjs'

test('붙여넣은 이미지 이름 뒤에 사용하지 않은 순번을 붙인다', () => {
  const used = ['image', 'image (1).png', 'IMAGE (2).PNG']
  assert.equal(uniqueImageFileName('image.png', 'image/png', used), 'image (3).png')
})

test('같은 붙여넣기 묶음에서 예약한 이름도 중복으로 처리한다', () => {
  const used = new Set(['image.png'])
  const first = uniqueImageFileName('image.png', 'image/png', used)
  used.add(first)
  const second = uniqueImageFileName('image.png', 'image/png', used)
  assert.equal(first, 'image (1).png')
  assert.equal(second, 'image (2).png')
})

test('파일 형식에 맞는 확장자를 유지하고 최대 길이를 넘지 않는다', () => {
  const original = `${'가'.repeat(240)}.jpg`
  const first = uniqueImageFileName(original, 'image/jpeg', [])
  const duplicate = uniqueImageFileName(original, 'image/jpeg', [first])
  assert.equal(splitImageFileName(first, 'image/jpeg').extension, '.jpg')
  assert.equal(splitImageFileName(duplicate, 'image/jpeg').extension, '.jpg')
  assert.match(duplicate, / \(1\)\.jpg$/)
  assert.ok(first.length <= 240)
  assert.ok(duplicate.length <= 240)
})
