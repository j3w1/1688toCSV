import test from 'node:test'
import assert from 'node:assert/strict'
import {
  packBackup,
  unpackBackup,
  createBackupBlob,
  readBackupFile,
} from '../src/backup-file.js'

const image =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
const second = 'data:image/jpeg;base64,/9j/2Q=='
function fixture() {
  return {
    format: '1688-order-library',
    version: 3,
    exportedAt: '2026-10-21T01:00:00.000Z',
    orders: [
      {
        snapshot: {
          items: [{ thumbnail: image, photos: ['local-image:abc', image] }],
        },
        notes: 'keep me',
        tags: ['received'],
      },
    ],
    history: [{ snapshot: { items: [{ thumbnail: image }] } }],
    images: [
      { url: 'local-image:abc', dataUrl: image },
      { url: 'other', dataUrl: second },
    ],
    issuedCodes: [{ ownerSnapshot: { photos: [image, second] } }],
    preparations: [{ groups: [{ baseCode: 'CE26101001' }] }],
    allocations: [],
    packingPreferences: { value: { logo: image } },
    packingScope: { months: ['2026-10'], orders: [{ entryIds: ['1'] }] },
  }
}

test('archive stores each identical image once, preserving source data and typed paths', async () => {
  const original = fixture(),
    before = structuredClone(original)
  const archive = await packBackup(original)
  assert.deepEqual(original, before)
  assert.equal(archive.assets.length, 2)
  assert.equal(archive.assets[0].paths.length, 6)
  assert.equal(archive.backup.orders[0].snapshot.items[0].thumbnail, null)
  assert.equal(
    archive.backup.orders[0].snapshot.items[0].photos[0],
    'local-image:abc'
  )
  assert.deepEqual(
    await unpackBackup(JSON.parse(JSON.stringify(archive))),
    original
  )
})

test('compressed file restores all metadata, original image strings and scoped packing fields exactly', async () => {
  const original = fixture()
  const blob = await createBackupBlob(original)
  assert.deepEqual(
    [...new Uint8Array(await blob.slice(0, 2).arrayBuffer())],
    [0x1f, 0x8b]
  )
  assert.deepEqual(await readBackupFile(blob), original)
  const plainArchive = new Blob([JSON.stringify(await packBackup(original))])
  assert.deepEqual(await readBackupFile(plainArchive), original)
})

test('legacy versions remain readable without image transformations', async () => {
  for (const version of [1, 2, 3]) {
    const backup = { ...fixture(), version }
    assert.deepEqual(
      await readBackupFile(new Blob([JSON.stringify(backup)])),
      backup
    )
  }
})

test('reference paths preserve punctuation, numeric object keys, ordinary nulls and prototype-named own keys', async () => {
  const original = JSON.parse(
    '{"a.b/~":{"0":null,"__proto__":null},"empty":null,"items":[]}'
  )
  original['a.b/~']['0'] = image
  original['a.b/~'].__proto__ = image
  original.items.push({ image })
  const restored = await readBackupFile(await createBackupBlob(original))
  assert.deepEqual(restored, original)
  assert.equal(Object.getPrototypeOf(restored), Object.prototype)
  assert.equal(Object.getPrototypeOf(restored['a.b/~']), Object.prototype)
  assert.equal(restored.empty, null)
})

test('damaged compressed data is rejected before restoring any records', async () => {
  const bytes = new Uint8Array(
    await (await createBackupBlob(fixture())).arrayBuffer()
  )
  const corrupted = bytes.slice()
  corrupted[corrupted.length - 1] ^= 0xff
  await assert.rejects(
    readBackupFile(new Blob([corrupted])),
    /compressed backup is damaged/
  )
  await assert.rejects(
    readBackupFile(new Blob([bytes.slice(0, -8)])),
    /compressed backup is damaged/
  )
})

test('invalid, duplicate, inherited and mistyped image locations reject without partially expanding the archive', async () => {
  const archive = JSON.parse(JSON.stringify(await packBackup(fixture())))
  const cases = [
    (a) => {
      a.version = 2
    },
    (a) => {
      a.assets[0].dataUrl = 'https://example.test/photo.png'
    },
    (a) => {
      a.assets[0].paths.push(a.assets[0].paths[0])
    },
    (a) => {
      a.assets[1].paths.push(a.assets[0].paths[0])
    },
    (a) => {
      a.assets[0].paths.push(['orders', '0', 'snapshot'])
    },
    (a) => {
      a.assets[0].paths.push(['orders', 99])
    },
    (a) => {
      a.assets[0].paths.push(['constructor', 'prototype', 'polluted'])
    },
    (a) => {
      a.assets[0].paths.push(['orders', 0, 'notes'])
    },
    (a) => {
      a.assets[0].paths = []
    },
  ]
  for (const alter of cases) {
    const damaged = structuredClone(archive)
    alter(damaged)
    const before = structuredClone(damaged)
    await assert.rejects(
      unpackBackup(damaged),
      /archive is incomplete or invalid/
    )
    assert.deepEqual(damaged, before)
  }
  assert.equal({}.polluted, undefined)
})

test('repeated large photos no longer multiply the compressed export size', async () => {
  const photo =
    'data:image/png;base64,' +
    Buffer.from(
      Array.from({ length: 100_000 }, (_, i) => (i * 67) % 256)
    ).toString('base64')
  const backup = {
    ...fixture(),
    images: [],
    orders: Array.from({ length: 30 }, () => ({ thumbnail: photo })),
  }
  const blob = await createBackupBlob(backup)
  assert.ok(blob.size < JSON.stringify(backup).length / 10)
  assert.deepEqual(await readBackupFile(blob), backup)
})
