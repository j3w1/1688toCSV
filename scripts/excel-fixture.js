// Only bundled by the local Excel probe, on its disposable localhost origin.
import { startLibrary } from '../src/library.js'
import { openDatabase } from '../src/database.js'
import { renderLabel } from '../src/labels.js'
import { createDemoRecords } from '../preview/library-fixture.js'

const structured = new URL(location.href).searchParams.has('labels')
const records = createDemoRecords(document)
if (structured) {
  records.splice(1)
  const snapshot = records[0].snapshot
  snapshot.sellerName = 'Synthetic Excel preparation supplier'
  snapshot.sellerMemberLogin = 'synthetic-excel-shop'
  snapshot.sellerShopOrigin = 'https://synthetic-excel-shop.1688.com'
  for (const [index, item] of snapshot.items.entries()) {
    item.title = index < 2 ? '合成玻璃罐' : '合成收纳盒'
    item.productNumber = index < 2 ? 'TEST-JAR' : 'TEST-BOX'
    item.skuProperties = [
      {
        label: '颜色',
        value: index < 2 ? '透明' : '灰色',
        raw: index < 2 ? '颜色：透明' : '颜色：灰色',
      },
      ...(index < 2
        ? [
            {
              label: '尺寸',
              value: index === 0 ? '300ml' : '500ml',
              raw: index === 0 ? '尺寸：300ml' : '尺寸：500ml',
            },
          ]
        : []),
    ]
    item.description = [
      item.title,
      ...item.skuProperties.map((property) => property.raw),
      `货号：${item.productNumber}`,
    ].join('\n')
  }
}
const repository = await openDatabase({
  name: structured ? 'excel-probe-labels' : 'excel-probe-products',
})
await repository.restoreBackup({
  format: '1688-order-library',
  version: 1,
  exportedAt: new Date().toISOString(),
  orders: records,
  history: [],
  images: [],
})
globalThis.excelAcceptance = {
  records,
  async expectedLabel(model) {
    const preferences = await repository.getPackingPreferences()
    const result = await renderLabel({
      ...model,
      settings: preferences.settings,
      logoUrl: new URL('assets/casa-elida.png', location.href).href,
    })
    const bytes = await result.blob.arrayBuffer()
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
    return {
      widthMm: result.widthMm,
      heightMm: result.heightMm,
      width: result.width,
      height: result.height,
      sha256: [...digest]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join(''),
    }
  },
}
await startLibrary(async (message) => {
  if (message.type === 'LIBRARY_QUERY')
    return {
      ok: true,
      data: { orders: await repository.listOrders(), jobs: [] },
    }
  if (message.type === 'JOBS_QUERY') return { ok: true, data: { jobs: [] } }
  if (message.type === 'IMAGE_GET') return { ok: true, data: message.url }
  if (message.type === 'LIBRARY_HISTORY') return { ok: true, data: [] }
  return {
    ok: false,
    error: 'This local Excel probe only uses synthetic library records.',
  }
}, repository)
