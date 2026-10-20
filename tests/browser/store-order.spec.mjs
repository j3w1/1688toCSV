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
