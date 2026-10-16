import { message as uiMessage, getLanguage } from './i18n.js'
import { planExcelImage, renderExcelImage } from './excel-image.js'
import {
  selectedExcelImageColumns,
  createExcelImageOptions,
  readExcelImagePreference,
} from './excel-image-options.js'
import { openImageCopyDialog } from './image-copy-dialog.js'

export async function copyExcelImage(
  rows,
  {
    loadImage,
    renderCartonMark,
    signal,
    columns,
    language = getLanguage(),
    errorOptions,
  }
) {
  // Freeze only copied values, not the entire library record attached to each row.
  const frozen = rows.map((row) =>
    Object.fromEntries(
      [
        'orderId',
        'sellerName',
        'sellerMemberLogin',
        'entryId',
        'groupId',
        'thumbnail',
        'description',
        'title',
        'productNumber',
        'variantDescription',
        'sourceSize',
        'manualReordered',
        'baseCode',
        'barcode',
        'chineseCategory',
        'spanishName',
        'material',
        'price',
        'quantity',
      ].map((key) => [key, row[key] ?? ''])
    )
  )
  frozen.forEach((row, index) => {
    row.skuProperties = (
      Array.isArray(rows[index].skuProperties) ? rows[index].skuProperties : []
    ).map(({ label, value }) => ({
      label: String(label ?? ''),
      value: String(value ?? ''),
    }))
  })
  if (!frozen.length) return false
  return openImageCopyDialog({
    title: 'Copy Excel image',
    count: frozen.length,
    signal,
    interactivePreview: true,
    errorOptions,
    createOptions: columns ? undefined : createExcelImageOptions,
    plan: async (signal) => {
      await document.fonts.ready
      signal.throwIfAborted()
      const preference = readExcelImagePreference()
      return planExcelImage(frozen, {
        columns: columns || selectedExcelImageColumns(preference),
        showOrderDetails: preference.showOrderDetails,
        language,
      })
    },
    prepare: async (plan, { signal, onProgress }) => {
      const result = await renderExcelImage(plan, {
        loadImage,
        renderCartonMark,
        signal,
        onProgress: ({ completed, total }) =>
          onProgress(
            uiMessage('Creating image {completed}/{total}…', {
              completed,
              total,
            })
          ),
      })
      return { images: [{ blob: result.blob }], payload: result.blob }
    },
    write: (blob) =>
      navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]),
  })
}
