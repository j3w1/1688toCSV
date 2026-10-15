import { planExcelImage, renderExcelImage } from './excel-image.js'
import { element } from './ui.js'

function choosePlan(plans, count) {
  if (plans.length === 1) return Promise.resolve(plans[0])
  const dialog = element('dialog', undefined, 'scope-dialog')
  dialog.setAttribute('aria-label', 'Choose Excel image batch')
  const number = element('input')
  number.type = 'number'
  number.min = '1'
  number.max = String(plans.length)
  number.value = '1'
  number.setAttribute('aria-label', 'Image batch number')
  const range = element('p')
  const update = () => {
    const plan = plans[Number(number.value) - 1]
    range.textContent = plan
      ? `Batch ${number.value} of ${plans.length} · rows ${plan.start + 1}–${plan.end} of ${count}`
      : 'Choose a valid batch number.'
  }
  number.oninput = update
  update()
  const cancel = element('button', 'Cancel')
  const proceed = element('button', 'Copy this batch', 'primary')
  dialog.append(
    element('h2', 'Copy the table in numbered images'),
    element(
      'p',
      `${count} rows need ${plans.length} images at full quality. Choose one batch, then repeat for the others.`
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

export async function copyExcelImage(rows, { loadImage, onProgress, signal }) {
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
    const plans = planExcelImage(frozen)
    const plan = await choosePlan(plans, frozen.length)
    if (!plan) return false
    signal?.throwIfAborted()
    const { blob } = await renderExcelImage(plan, {
      loadImage,
      signal,
      onProgress: ({ completed, total }) =>
        onProgress?.(`Creating image ${completed}/${total}…`),
    })
    signal?.throwIfAborted()
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return true
  } catch (error) {
    if (signal?.aborted) return false
    throw error
  }
}
