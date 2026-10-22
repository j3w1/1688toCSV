import test from 'node:test'
import assert from 'node:assert/strict'
import {
  recognizedPhotoSize,
  hasPhotoSizeTag,
  addPhotoSizeTag,
} from '../src/photo-size-tag.js'
import { createSizeClassifier } from '../src/size-vocabulary.js'
import { validatePhotoEdits } from '../src/store-order.js'
import { photoVariantTagLayout } from '../src/product-photo.js'

test('photo size text uses shared source recognition for spreadsheets, original SKU properties and gallery rows', () => {
  for (const [item, expected] of [
    [
      {
        sourceGroup: '8',
        productNumber: 'ZA255',
        description: 'ZA255 · 大盘 · 26.5cm',
      },
      '26.5cm',
    ],
    [
      {
        group: '8',
        productNumber: 'ZA255',
        description: 'ZA255 · 大盘 · 26.5cm',
      },
      '26.5cm',
    ],
    [
      {
        title: '合成碗',
        skuProperties: [{ label: '尺寸', value: '10 inches' }],
      },
      '10 inches',
    ],
    [{ title: '合成碗', description: '合成碗\n尺寸: 8.5"' }, '8.5"'],
    [{ sourceSize: '20.5cm', sizeSuffix: 'L' }, '20.5cm'],
    [
      {
        title: '20cm 花瓶',
        productNumber: 'A3',
        sizeSuffix: 'XL',
        barcode: 'CE26100001XL',
      },
      '',
    ],
    [{ skuProperties: [{ label: '货号', value: 'MODEL-26.5cm' }] }, ''],
    [{ sourceGroup: '1', description: '款号: MODEL-26.5cm · 黑色' }, ''],
    [{ sourceGroup: '1', description: '原始无尺寸描述' }, ''],
  ]) {
    const original = structuredClone(item)
    assert.equal(recognizedPhotoSize(item), expected)
    assert.deepEqual(item, original)
  }
  assert.equal(
    recognizedPhotoSize(
      { skuProperties: [{ label: '款式', value: '特制高款' }] },
      createSizeClassifier([{ match: '特制高款', suffix: 'XL' }])
    ),
    '特制高款'
  )
})

test('one-click size annotations preserve saved edits and place the label bottom-right with its point 75% across', () => {
  const original = {
    fit: 'cover',
    scale: 1.3,
    x: 0.1,
    background: '#112233',
    tags: [
      { id: 'existing', code: 'A', x: 0.2, y: 0.4, labelX: 0.1, labelY: 0.1 },
    ],
    tagScale: 3.25,
    pointerScale: 1.5,
    invertPointer: true,
  }
  const before = structuredClone(original)
  const edit = addPhotoSizeTag(original, '26.5cm', { id: 'size' })
  assert.deepEqual(original, before)
  for (const field of [
    'fit',
    'scale',
    'x',
    'background',
    'tagScale',
    'pointerScale',
    'invertPointer',
  ])
    assert.equal(edit[field], original[field])
  assert.deepEqual(edit.tags[0], original.tags[0])
  const tag = edit.tags[1]
  assert.equal(tag.code, '26.5cm')
  assert.equal(tag.x, 0.75)
  assert.equal(tag.y, 0.5)
  const { badge } = photoVariantTagLayout(tag, 640, undefined, edit.tagScale)
  const inset = 640 * 0.01 * edit.tagScale
  assert.equal(badge.x + badge.width, 640 - inset)
  assert.equal(badge.y + badge.height, 640 - inset)
  assert.ok(tag.labelX > 0.5 && tag.labelY > 0.5)
  assert.deepEqual(validatePhotoEdits({ 0: edit }, 1), { 0: edit })
  const fresh = addPhotoSizeTag(undefined, '10 inches', { id: 'new-size' })
  assert.equal(fresh.tagScale, 2)
  assert.equal(fresh.pointerScale, 1)
  assert.equal(
    addPhotoSizeTag({ tags: original.tags }, '26.5cm', { id: 'legacy-size' })
      .tagScale,
    1
  )
})

test('one-click size annotation prevents duplicates and never mutates failed or oversized drafts', () => {
  const edit = addPhotoSizeTag(undefined, '26.5cm', { id: 'size' })
  const original = structuredClone(edit)
  assert.equal(hasPhotoSizeTag(edit, '26.5cm'), true)
  assert.equal(hasPhotoSizeTag(edit, '26.5CM'), true)
  assert.equal(addPhotoSizeTag(edit, '26.5cm'), null)
  assert.deepEqual(edit, original)
  const full = {
    tags: Array.from({ length: 50 }, (_, index) => ({
      ...edit.tags[0],
      id: String(index),
      code: `tag${index}`,
    })),
  }
  assert.throws(() => addPhotoSizeTag(full, '26.5cm'), /at most 50/)
  assert.equal(full.tags.length, 50)
  assert.throws(() => addPhotoSizeTag(edit, ''), /No size was recognized/)
})
