import { test, expect } from './extension-fixture.mjs'

const photo =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2WZ4kAAAAASUVORK5CYII='
const input = {
  filename: '4321.xlsx',
  sheetName: 'Order',
  purchaseDate: '2026-10-01',
  total: '100.00',
  store: {
    key: 'market:4321',
    name: 'Synthetic store',
    number: '4321',
    kind: 'market',
  },
  rows: [
    {
      row: 5,
      group: '1',
      title: 'Synthetic cup',
      description: 'Synthetic cup',
      boxes: '2',
      perbox: '5',
      quantity: '10',
      price: '10.00',
      amount: '100.00',
      photos: [photo],
    },
  ],
}

async function openRepository(extension) {
  const page = await extension.context.newPage()
  await page.goto(`${extension.origin}/unsupported`)
  await page.evaluate(async () => {
    const { openDatabase } = await import('/src/database.js')
    window.openOrderDatabase = openDatabase
    window.databaseName = `synthetic-store-${crypto.randomUUID()}`
    window.repository = await openDatabase({ name: window.databaseName })
  })
  return page
}

test('spreadsheet imports are new atomic orders with shared store identity and original assets', async ({
  extension,
}) => {
  const page = await openRepository(extension)
  const result = await page.evaluate(async (input) => {
    const first = await repository.importStoreOrder(input)
    const second = await repository.importStoreOrder(input)
    await repository.renameStore(
      first.snapshot.orderId,
      'Renamed synthetic store'
    )
    await repository.setCartonDetails(first.snapshot.orderId, '1', {
      kg: '20.5',
      cbm: '0.21',
      len: '70',
      wid: '50',
      ht: '30',
    })
    await repository.setProductPhoto(first.snapshot.orderId, '1', {
      thumbnail: input.rows[0].photos[0],
      edit: { fit: 'cover', scale: 1.2, x: 0.1, y: 0, background: '#ffffff' },
    })
    const exported = await repository.exportBackup()
    const restored = await openOrderDatabase({
      name: `${databaseName}-restored`,
    })
    await restored.restoreBackup(exported)
    const orders = await restored.listOrders()
    const image = await restored.getImage(first.snapshot.items[0].photos[0])
    restored.close()
    return {
      firstId: first.snapshot.orderId,
      secondId: second.snapshot.orderId,
      images: exported.images.length,
      orders,
      image,
    }
  }, input)
  expect(result.firstId).not.toBe(result.secondId)
  expect(result.orders).toHaveLength(2)
  expect(result.images).toBe(1)
  expect(
    result.orders.every(
      (order) =>
        order.snapshot.sourceType === 'spreadsheet' &&
        order.snapshot.sourceUrl === '' &&
        order.snapshot.sellerName === 'Renamed synthetic store'
    )
  ).toBe(true)
  const first = result.orders.find(
    (order) => order.snapshot.orderId === result.firstId
  )
  expect(first.cartonDetails['1']).toEqual({
    kg: '20.5',
    cbm: '0.21',
    len: '70',
    wid: '50',
    ht: '30',
  })
  expect(first.snapshot.items[0].photoEdits['0'].fit).toBe('cover')
  expect(result.image.dataUrl).toBe(photo)
})

test('failed spreadsheet imports leave orders and originals untouched', async ({
  extension,
}) => {
  const page = await openRepository(extension)
  const result = await page.evaluate(async (input) => {
    const invalid = structuredClone(input)
    invalid.rows.push({ ...invalid.rows[0], row: 6, photos: [] })
    let rejected = false
    try {
      await repository.importStoreOrder(invalid)
    } catch {
      rejected = true
    }
    const backup = await repository.exportBackup()
    return {
      rejected,
      orders: backup.orders.length,
      images: backup.images.length,
    }
  }, input)
  expect(result).toEqual({ rejected: true, orders: 0, images: 0 })
})

test('adjusting an additional gallery photo preserves the product primary thumbnail', async ({
  extension,
}) => {
  const page = await openRepository(extension)
  const result = await page.evaluate(async (input) => {
    const data = structuredClone(input)
    const canvas = document.createElement('canvas')
    canvas.width = 2
    canvas.height = 1
    const context = canvas.getContext('2d')
    context.fillStyle = '#943d37'
    context.fillRect(0, 0, 2, 1)
    data.rows[0].photos.push(canvas.toDataURL('image/png'))
    const order = await repository.importStoreOrder(data)
    const originalThumbnail = order.snapshot.items[0].thumbnail
    let staleRejected = false
    try {
      await repository.setProductPhoto(order.snapshot.orderId, '1', {
        photoIndex: 0,
        originalPhoto: 'local-image:stale',
        thumbnail: 'data:image/png;base64,AQID',
        edit: { fit: 'cover' },
      })
    } catch (error) {
      staleRejected = error.message.includes('source photo changed')
    }
    const changed = await repository.setProductPhoto(
      order.snapshot.orderId,
      '1',
      {
        photoIndex: 1,
        thumbnail: 'data:image/png;base64,AQID',
        edit: { fit: 'cover', scale: 1, x: 0, y: 0, background: '#ffffff' },
      }
    )
    return { originalThumbnail, item: changed.snapshot.items[0], staleRejected }
  }, input)
  expect(result.item.thumbnail).toBe(result.originalThumbnail)
  expect(result.item.photoEdits['1'].fit).toBe('cover')
  expect(result.item.photos).toHaveLength(2)
  expect(result.staleRejected).toBe(true)
})

test('photo variant callouts render and survive gallery edits, backup and restore without changing originals', async ({
  extension,
}) => {
  const page = await openRepository(extension)
  const result = await page.evaluate(async (input) => {
    const { photoVariantTagLayout, squareProductPhoto } =
      await import('/src/product-photo.js')
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 2
    const context = canvas.getContext('2d')
    context.fillStyle = '#d0453a'
    context.fillRect(0, 0, 2, 2)
    const secondaryPhoto = canvas.toDataURL('image/png')
    const data = structuredClone(input)
    data.rows[0].photos.push(secondaryPhoto)
    const imported = await repository.importStoreOrder(data)
    const orderId = imported.snapshot.orderId
    const originals = imported.snapshot.items[0].photos
    const tags = [
      { id: 'a', code: 'AS', x: 0.2, y: 0.7, labelX: 0.8, labelY: 0.2 },
    ]
    const annotated = await squareProductPhoto(input.rows[0].photos[0], {
      tags,
      tagScale: 1.8,
      pointerScale: 2.5,
    })
    const first = await repository.setProductPhoto(orderId, '1', {
      originalPhoto: originals[0],
      thumbnail: annotated,
      edit: { fit: 'contain', tags, tagScale: 1.8, pointerScale: 2.5 },
    })
    const second = await repository.setProductPhoto(orderId, '1', {
      photoIndex: 1,
      originalPhoto: originals[1],
      edit: {
        fit: 'cover',
        tags: [{ ...tags[0], id: 'b', code: 'B' }],
        tagScale: 6,
        pointerScale: 4,
        invertPointer: true,
      },
    })
    const beforeInvalid = await repository.getOrder(orderId)
    let rejected = false
    try {
      await repository.setProductPhoto(orderId, '1', {
        edit: { tags: [{ ...tags[0], labelX: 2 }] },
      })
    } catch (error) {
      rejected = error.message.includes('coordinates')
    }
    const afterInvalid = await repository.getOrder(orderId)
    let scaleRejected = false
    try {
      await repository.setProductPhoto(orderId, '1', {
        edit: { tags, tagScale: 6.01 },
      })
    } catch (error) {
      scaleRejected = error.message.includes('Photo tag size')
    }
    const afterInvalidScale = await repository.getOrder(orderId)
    let pointerRejected = false
    try {
      await repository.setProductPhoto(orderId, '1', {
        edit: { tags, pointerScale: 4.01 },
      })
    } catch (error) {
      pointerRejected = error.message.includes('Photo pointer size')
    }
    const afterInvalidPointer = await repository.getOrder(orderId)
    let inversionRejected = false
    try {
      await repository.setProductPhoto(orderId, '1', {
        edit: { invertPointer: 'true' },
      })
    } catch (error) {
      inversionRejected = error.message.includes(
        'Photo pointer color inversion'
      )
    }
    const afterInvalidInversion = await repository.getOrder(orderId)
    const exported = await repository.exportBackup()
    const restored = await openOrderDatabase({
      name: `${databaseName}-tags-restored`,
    })
    await restored.restoreBackup(exported)
    const restoredOrder = await restored.getOrder(orderId)
    const restoredOriginals = await Promise.all(
      originals.map((photo) => restored.getImage(photo))
    )
    await repository.setProductPhoto(orderId, '1', {
      thumbnail: input.rows[0].photos[0],
      edit: { fit: 'contain', tags: [] },
    })
    const cleared = await repository.getOrder(orderId)
    // Inspect the actual generated PNG at the callout anchor and leader.
    const image = new Image()
    image.src = annotated
    await image.decode()
    canvas.width = canvas.height = 640
    context.drawImage(image, 0, 0)
    const layout = photoVariantTagLayout(tags[0], 640, context, 1.8, 2.5)
    const core = [...context.getImageData(128, 448, 1, 1).data]
    const rimX = Math.round(
      layout.anchor.x + (layout.dot.radius + layout.dot.innerRadius) / 2
    )
    const rim = [...context.getImageData(rimX, 448, 1, 1).data]
    const midX = Math.round((layout.leader.x1 + layout.leader.x2) / 2)
    const midY = Math.round((layout.leader.y1 + layout.leader.y2) / 2)
    const leader = [...context.getImageData(midX - 1, midY - 1, 3, 3).data]
    restored.close()
    return {
      originals,
      first,
      second,
      restoredOrder,
      restoredOriginals,
      sourcePhotos: data.rows[0].photos,
      rejected,
      beforeInvalid,
      afterInvalid,
      scaleRejected,
      afterInvalidScale,
      pointerRejected,
      afterInvalidPointer,
      inversionRejected,
      afterInvalidInversion,
      cleared,
      core,
      rim,
      leader,
    }
  }, input)
  const expectedTag = {
    id: 'a',
    code: 'AS',
    x: 0.2,
    y: 0.7,
    labelX: 0.8,
    labelY: 0.2,
  }
  expect(result.first.snapshot.items[0].photoEdits['0'].tags).toEqual([
    expectedTag,
  ])
  expect(result.first.snapshot.items[0].photoEdits['0'].tagScale).toBe(1.8)
  expect(result.second.snapshot.items[0].photoEdits['1'].tagScale).toBe(6)
  expect(result.first.snapshot.items[0].photoEdits['0'].pointerScale).toBe(2.5)
  expect(result.second.snapshot.items[0].photoEdits['1'].pointerScale).toBe(4)
  expect(result.second.snapshot.items[0].photoEdits['1'].invertPointer).toBe(
    true
  )
  expect(result.second.snapshot.items[0].thumbnail).toBe(
    result.first.snapshot.items[0].thumbnail
  )
  expect(result.restoredOrder.snapshot.items[0].photoEdits).toEqual(
    result.second.snapshot.items[0].photoEdits
  )
  expect(result.restoredOrder.snapshot.items[0].photos).toEqual(
    result.originals
  )
  expect(result.restoredOriginals.map((asset) => asset.dataUrl)).toEqual(
    result.sourcePhotos
  )
  expect(result.rejected).toBe(true)
  expect(result.afterInvalid).toEqual(result.beforeInvalid)
  expect(result.scaleRejected).toBe(true)
  expect(result.afterInvalidScale).toEqual(result.beforeInvalid)
  expect(result.pointerRejected).toBe(true)
  expect(result.afterInvalidPointer).toEqual(result.beforeInvalid)
  expect(result.inversionRejected).toBe(true)
  expect(result.afterInvalidInversion).toEqual(result.beforeInvalid)
  expect(result.cleared.snapshot.items[0].photoEdits['0'].tags).toEqual([])
  expect(result.cleared.snapshot.items[0].photoEdits['0']).not.toHaveProperty(
    'tagScale'
  )
  expect(result.cleared.snapshot.items[0].photoEdits['0']).not.toHaveProperty(
    'pointerScale'
  )
  expect(result.cleared.snapshot.items[0].photoEdits['1'].tags[0].code).toBe(
    'B'
  )
  expect(result.core).toEqual([255, 255, 255, 255])
  expect(result.rim).toEqual([0, 0, 0, 255])
  expect(
    Array.from({ length: 9 }, (_, index) =>
      result.leader.slice(index * 4, index * 4 + 3)
    ).some((pixel) => pixel.every((channel) => channel === 0))
  ).toBe(true)
})

test('deleting orders removes unshared local originals while keeping shared and historical assets', async ({
  extension,
}) => {
  const page = await openRepository(extension)
  const result = await page.evaluate(async (input) => {
    const { localImageAsset } = await import('/src/images.js')
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 2
    const context = canvas.getContext('2d')
    function image(color) {
      context.fillStyle = color
      context.fillRect(0, 0, 2, 2)
      return canvas.toDataURL('image/png')
    }
    const firstInput = structuredClone(input)
    firstInput.rows[0].photos.push(image('#c93535'))
    const first = await repository.importStoreOrder(firstInput)
    const second = await repository.importStoreOrder(input)
    const [sharedPhoto, uniquePhoto] = first.snapshot.items[0].photos
    const replacement = await localImageAsset(image('#3355c9'))
    await repository.putImage(replacement)
    const unrelated = await localImageAsset(image('#35c955'))
    await repository.putImage(unrelated)
    const newer = structuredClone(second.snapshot)
    newer.observedAt = new Date(
      Date.parse(newer.observedAt) + 1000
    ).toISOString()
    newer.items[0].photos = [replacement.url]
    newer.items[0].thumbnail = replacement.dataUrl
    await repository.saveSnapshot(newer)
    const history = await repository.getHistory(second.snapshot.orderId)
    await repository.setProductPhoto(first.snapshot.orderId, '1', {
      edit: {
        tags: [
          { id: 'a', code: 'A', x: 0.1, y: 0.2, labelX: 0.7, labelY: 0.8 },
        ],
      },
    })
    await repository.removeOrders([first.snapshot.orderId])
    const afterFirst = await repository.exportBackup()
    await repository.removeOrders([second.snapshot.orderId])
    const afterSecond = await repository.exportBackup()
    return {
      history,
      sharedPhoto,
      uniquePhoto,
      replacement: replacement.url,
      unrelated: unrelated.url,
      afterFirst,
      afterSecond,
    }
  }, input)
  expect(result.history).toHaveLength(1)
  expect(result.history[0].snapshot.items[0].photos).toContain(
    result.sharedPhoto
  )
  expect(result.afterFirst.orders).toHaveLength(1)
  const afterFirst = result.afterFirst.images.map((asset) => asset.url)
  expect(afterFirst).not.toContain(result.uniquePhoto)
  expect(afterFirst).toContain(result.sharedPhoto)
  expect(afterFirst).toContain(result.replacement)
  expect(afterFirst).toContain(result.unrelated)
  expect(result.afterSecond.orders).toHaveLength(0)
  expect(result.afterSecond.history).toHaveLength(0)
  expect(result.afterSecond.images.map((asset) => asset.url)).toEqual([
    result.unrelated,
  ])
})
