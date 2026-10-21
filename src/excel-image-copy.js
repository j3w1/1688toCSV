import { message as uiMessage, getLanguage } from './i18n.js'
import { planExcelImage, renderExcelImage } from './excel-image.js'
import {
  createExcelImageBadges,
  currentExcelImageMode,
} from './excel-image-badges.js'
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
    badges = createExcelImageBadges({}, currentExcelImageMode()),
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
        'orderDate',
        'orderStatus',
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
    for (const key of ['orderTags', 'productTags'])
      row[key] = (Array.isArray(rows[index][key]) ? rows[index][key] : []).map(
        (tag) => String(tag ?? '')
      )
    row.skuProperties = (
      Array.isArray(rows[index].skuProperties) ? rows[index].skuProperties : []
    ).map(({ label, value }) => ({
      label: String(label ?? ''),
      value: String(value ?? ''),
    }))
  })
  if (!frozen.length) return false
  let outputLanguage = language
  return openImageCopyDialog({
    title: 'Copy Excel image',
    count: frozen.length,
    signal,
    interactivePreview: true,
    languageToggle: true,
    language,
    onLanguageChange: (value) => {
      outputLanguage = value
    },
    errorOptions,
    createOptions: columns
      ? undefined
      : (onChange) => createExcelImageOptions(onChange, { rows: frozen }),
    plan: async (signal) => {
      await document.fonts.ready
      signal.throwIfAborted()
      const preference = readExcelImagePreference()
      return planExcelImage(frozen, {
        columns: columns || selectedExcelImageColumns(preference),
        showOrderDetails: preference.showOrderDetails,
        style: preference.style,
        details: preference.details,
        badges,
        language: outputLanguage,
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
