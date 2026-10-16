import {
  message as uiMessage,
  bindText,
  bindAttribute,
  getLanguage,
} from './i18n.js'
import { planExcelImage, renderExcelImage } from './excel-image.js'
import { selectedExcelImageColumns } from './excel-image-options.js'
import { element } from './ui.js'

function choosePlan(plans, count) {
  if (plans.length === 1) return Promise.resolve(plans[0])
  const dialog = element('dialog', undefined, 'scope-dialog')
  bindAttribute(dialog, 'aria-label', uiMessage('Choose Excel image batch'))
  const number = element('input')
  number.type = 'number'
  number.min = '1'
  number.max = String(plans.length)
  number.value = '1'
  bindAttribute(number, 'aria-label', uiMessage('Image batch number'))
  const range = element('p')
  const update = () => {
    const plan = plans[Number(number.value) - 1]
    bindText(
      range,
      plan
        ? uiMessage('Batch {0} of {1} · rows {2}–{3} of {4}', {
            0: number.value,
            1: plans.length,
            2: plan.start + 1,
            3: plan.end,
            4: count,
          })
        : uiMessage('Choose a valid batch number.')
    )
  }
  number.oninput = update
  update()
  const cancel = element('button', uiMessage('Cancel'))
  const proceed = element('button', uiMessage('Copy this batch'), 'primary')
  dialog.append(
    element('h2', uiMessage('Copy the table in numbered images')),
    element(
      'p',
      uiMessage(
        '{0} rows need {1} images at full quality. Choose one batch, then repeat for the others.',
        { 0: count, 1: plans.length }
      )
    ),
    number,
    range,
    cancel,
    proceed
  )
  document.body.append(dialog)
  return new Promise((resolve) => {
    let selected = null
    cancel.onclick = () => dialog.close()
    proceed.onclick = () => {
      if (!number.reportValidity()) return
      selected = plans[Number(number.value) - 1]
      if (selected) dialog.close()
    }
    dialog.onclose = () => {
      dialog.remove()
      resolve(selected)
    }
    dialog.showModal()
    cancel.focus()
  })
}

export async function copyExcelImage(
  rows,
  {
    loadImage,
    renderCartonMark,
    onProgress,
    signal,
    columns = selectedExcelImageColumns(),
    language = getLanguage(),
  }
) {
  // Freeze only copied values, not the entire library record attached to each row.
  const frozen = rows.map((row) =>
    Object.fromEntries(
      [
        'orderId',
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
  try {
    signal?.throwIfAborted()
    await document.fonts.ready
    const plans = planExcelImage(frozen, { columns, language })
    const plan = await choosePlan(plans, frozen.length)
    if (!plan) return false
    signal?.throwIfAborted()
    const { blob } = await renderExcelImage(plan, {
      loadImage,
      renderCartonMark,
      signal,
      onProgress: ({ completed, total }) =>
        onProgress?.(
          uiMessage('Creating image {completed}/{total}…', { completed, total })
        ),
    })
    signal?.throwIfAborted()
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return true
  } catch (error) {
    if (signal?.aborted) return false
    throw error
  }
}
