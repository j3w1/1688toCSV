// Only bundled by the local Excel probe, on its disposable localhost origin.
import { startLibrary } from '../src/library.js'
import { openDatabase } from '../src/database.js'
import { renderLabel } from '../src/labels.js'
import { planExcelImage, renderExcelImage } from '../src/excel-image.js'
import { selectedExcelImageColumns } from '../src/excel-image-options.js'
import { getLanguage } from '../src/i18n.js'
import { variantMaterial } from '../src/packing-model.js'
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
  async expectedExcelImage(indices) {
    const preparation = (await repository.listPreparations())[0]
    const rows = indices.map((index) => {
      const item = records[0].snapshot.items[index]
      const group = preparation.groups.find((group) =>
        group.variants.some((variant) =>
          variant.entryIds.includes(item.entryId)
        )
      )
      const variant = group.variants.find((variant) =>
        variant.entryIds.includes(item.entryId)
      )
      return {
        ...item,
        orderId: records[0].snapshot.orderId,
        groupId: group.id,
        baseCode: group.baseCode,
        barcode: group.baseCode + variant.variantSuffix + variant.sizeSuffix,
        spanishName: variant.spanishName || group.spanishName,
        chineseCategory: group.category,
        material: variantMaterial(variant, item.entryId).value,
        variantDescription: variant.variant,
        sourceSize: variant.size,
      }
    })
    await document.fonts.ready
    const plans = planExcelImage(rows, {
      columns: selectedExcelImageColumns(),
      language: getLanguage(),
    })
    if (plans.length !== 1)
      throw new Error('Synthetic Excel fixture should fit one image.')
    const preferences = await repository.getPackingPreferences()
    const result = await renderExcelImage(plans[0], {
      loadImage: async (url) => url,
      renderCartonMark: async (source, { signal }) => {
        const mark = await renderLabel({
          kind: 'mark',
          code: source.baseCode,
          category: source.chineseCategory,
          settings: preferences.settings,
          logoUrl: new URL('assets/casa-elida.png', location.href).href,
          signal,
        })
        return mark.blob
      },
    })
    const bitmap = await createImageBitmap(result.blob)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    try {
      const context = canvas.getContext('2d')
      context.drawImage(bitmap, 0, 0)
      const digest = async (bytes) =>
        [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
          .map((byte) => byte.toString(16).padStart(2, '0'))
          .join('')
      return {
        width: bitmap.width,
        height: bitmap.height,
        sha256: await digest(await result.blob.arrayBuffer()),
        pixelSha256: await digest(
          context.getImageData(0, 0, bitmap.width, bitmap.height).data
        ),
      }
    } finally {
      bitmap.close()
      canvas.width = canvas.height = 0
    }
  },
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
