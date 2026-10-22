import test from 'node:test'
import assert from 'node:assert/strict'
import {
  collectImageReferences,
  imageCacheKey,
  loadThumbnail,
  originalImageUrl,
} from '../src/images.js'

const original = 'https://cbu01.alicdn.com/img/ibank/example.jpg?_=2020'
const sized = 'https://cbu01.alicdn.com/img/ibank/example.jpg_64x64.jpg?_=2020'
const png = 'data:image/png;base64,AQID'

test('original Alibaba images retain their filename and existing query', () => {
  assert.equal(originalImageUrl(original), original)
  assert.equal(originalImageUrl(sized), original)
  assert.equal(
    originalImageUrl(original.replace('.jpg?', '.jpg.64x64.jpg?')),
    original
  )
  assert.equal(
    originalImageUrl(original.replace('.jpg?', '.64x64.jpg?')),
    original
  )
  assert.equal(
    originalImageUrl(original.replace('.jpg?', '.jpg_300x300q90.jpg_.webp?')),
    original
  )
  const untouched = 'https://cbu01.alicdn.com/img/ibank/model_64x64.jpg'
  assert.equal(originalImageUrl(untouched), untouched)
  assert.equal(originalImageUrl(original.split('?')[0]), original.split('?')[0])
})

test('image URL normalization retains host restrictions', () => {
  for (const url of [
    original.replace('https:', 'http:'),
    original.replace('cbu01.alicdn.com', 'cbu01.alicdn.com.example.test'),
    original.replace('https://', 'https://user:password@'),
  ])
    assert.throws(() => originalImageUrl(url), /not supported/)
})

test('existing sized URL fetches and caches original instead of reusing a small cached image', async (t) => {
  const requested = [],
    reads = [],
    writes = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requested.push(url)
    assert.equal(options.credentials, 'omit')
    return new Response(new Uint8Array([1, 2, 3]), {
      headers: { 'content-type': 'image/png' },
    })
  })
  const repository = {
    async getImage(url) {
      reads.push(url)
      return url === sized ? { dataUrl: 'old-small-image' } : undefined
    },
    async putImage(image) {
      writes.push(image)
    },
  }
  assert.equal(await loadThumbnail(sized, repository), png)
  assert.deepEqual(reads, [original])
  assert.deepEqual(requested, [original])
  assert.equal(writes[0].url, original)
  assert.equal(writes[0].dataUrl, png)
})

test('different thumbnail sizes share an original cache without network requests', async (t) => {
  t.mock.method(globalThis, 'fetch', () =>
    assert.fail('must use cached original')
  )
  const reads = []
  const repository = {
    async getImage(url) {
      reads.push(url)
      return { dataUrl: png }
    },
  }
  assert.equal(await loadThumbnail(sized, repository), png)
  assert.equal(
    await loadThumbnail(sized.replace('64x64', '200x200'), repository),
    png
  )
  assert.deepEqual(reads, [original, original])
})

test('embedded raster images remain usable without a URL or cache lookup', async () => {
  assert.equal(await loadThumbnail(png, {}), png)
})

test('retained image references use original identities across every photo owner', () => {
  const local = `local-image:${'a'.repeat(64)}`
  const gallery = 'https://cbu01.alicdn.com/gallery.png'
  const sourcePhoto = 'https://cbu01.alicdn.com/source-row.png'
  const historical = 'https://cbu01.alicdn.com/history.png'
  const sharedOwner = 'https://cbu01.alicdn.com/shared-owner.png'
  const references = collectImageReferences({
    orders: [
      {
        snapshot: {
          items: [{ thumbnail: sized, photos: [gallery, local, sized] }],
          spreadsheet: { rows: [{ photos: [sourcePhoto, local] }] },
        },
      },
    ],
    history: [{ snapshot: { items: [{ thumbnail: historical }] } }],
    issuedCodes: [
      {
        ownerSnapshot: { photos: [original] },
        members: [{ ownerSnapshot: { photos: [sharedOwner] } }],
      },
    ],
  })
  assert.deepEqual(
    [...references],
    [original, gallery, local, sourcePhoto, historical, sharedOwner]
  )
  assert.equal(imageCacheKey(local), local)
  assert.equal(imageCacheKey(png), png)
  const legacy = 'https://img.alicdn.com/legacy.jpg_64x64.jpg'
  assert.equal(imageCacheKey(legacy), legacy)
  assert.deepEqual([...collectImageReferences()], [])
})
