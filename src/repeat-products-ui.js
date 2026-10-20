import { bindAttribute, bindText, message } from './i18n.js'
import { element as el, orderReference, pinDialogActions } from './ui.js'
import { packingValueComparison } from './packing-review.js'
import { preparationHelp } from './preparation-help.js'

/** One native modal reviews all source rows; no code changes happen on selection. */
export async function openRepeatProductDialog({
  source,
  repository,
  linked = false,
  media,
  onSaved,
}) {
  const dialog = el('dialog', undefined, 'packing-review repeat-product-dialog')
  const title = linked ? 'Unlink repeat purchase' : 'Link repeat purchase'
  bindAttribute(dialog, 'aria-label', title)
  const heading = el('h2', message(title))
  const explanation = el(
    'p',
    message(
      linked
        ? 'This purchase will receive a different free product code. The other linked purchases keep their codes and source records.'
        : 'Choose the original product from this store and packing month. Review every source row, variant, size and feature before sharing its codes. Purchase prices and quantities stay separate.'
    )
  )
  const content = el('div', undefined, 'repeat-product-preview')
  const error = el('p', undefined, 'repeat-product-error')
  error.setAttribute('role', 'alert')
  error.hidden = true
  const checkLabel = el('label', undefined, 'repeat-product-confirm')
  const checked = el('input')
  checked.type = 'checkbox'
  checkLabel.append(
    checked,
    el('span', message('I checked the variants, sizes and features.'))
  )
  const actions = el('form')
  actions.method = 'dialog'
  const cancel = el('button', message('Cancel'))
  cancel.value = 'cancel'
  const apply = el(
    'button',
    message(linked ? 'Unlink and assign code' : 'Use the original codes'),
    'primary'
  )
  apply.type = 'button'
  apply.disabled = true
  actions.append(cancel, apply)
  dialog.append(heading, explanation)
  let plan,
    busy = false,
    sequence = 0,
    chooser
  const showError = (failure) => {
    error.hidden = !failure
    bindText(error, failure ? message(failure.message || failure) : '')
  }
  function render() {
    media?.forget(content)
    content.replaceChildren()
    for (const change of plan?.changes || []) {
      const row = el('article', undefined, 'repeat-product-source')
      if (media && change.photo) row.append(media.photo(change.photo))
      const details = el('div')
      details.append(
        el('strong', change.name),
        orderReference(change.orderId, { sourceType: change.sourceType })
      )
      details.append(
        el(
          'small',
          message('Source row {0} · Quantity {1} · Unit price {2}', {
            0: change.photo?.sourceRow || change.entryId,
            1: change.quantity,
            2: change.price ?? '—',
          })
        )
      )
      if (change.variant || change.size)
        details.append(
          el('small', [change.variant, change.size].filter(Boolean).join(' · '))
        )
      const features = [
        ['lighting', 'Lighting'],
        ['rotation', 'Rotation'],
      ].filter(([field]) => change.features?.[field] === true)
      if (features.length) {
        const readout = el('small', undefined, 'repeat-product-features')
        features.forEach(([, label], index) => {
          if (index) readout.append(' · ')
          readout.append(el('span', message(label)))
        })
        details.append(readout)
      }
      details.append(
        packingValueComparison([
          { kind: 'code', before: change.before, after: change.after },
        ])
      )
      if (
        change.combinedQuantity !== undefined &&
        change.combinedQuantity !== null
      )
        details.append(
          el(
            'small',
            message('Combined label quantity: {0}', {
              0: change.combinedQuantity,
            })
          )
        )
      row.append(details)
      content.append(row)
    }
    checked.checked = false
    apply.disabled = true
  }
  const review = async (target) => {
    const token = ++sequence
    plan = undefined
    apply.disabled = true
    checked.checked = false
    showError()
    media?.forget(content)
    content.replaceChildren(el('p', message('Loading…')))
    try {
      const next = linked
        ? await repository.previewRepeatProductUnlink({ source })
        : await repository.previewRepeatProductLink({ source, target })
      if (token !== sequence || !dialog.open) return
      plan = next
      render()
    } catch (failure) {
      if (token !== sequence || !dialog.open) return
      content.replaceChildren()
      showError(failure)
    }
  }
  if (!linked) {
    const candidates = await repository.getRepeatProductCandidates(source)
    const label = el(
      'label',
      message('Original product and code'),
      'repeat-product-choice'
    )
    chooser = el('select')
    bindAttribute(chooser, 'aria-label', 'Original product and code')
    const empty = el('option', message('Choose an existing product'))
    empty.value = ''
    chooser.append(empty)
    candidates.forEach((candidate, index) => {
      const option = el(
        'option',
        `${candidate.baseCode} · ${candidate.title} · ${candidate.orderId} · ${candidate.quantity ?? '—'}`
      )
      option.value = String(index)
      chooser.append(option)
    })
    chooser.addEventListener('change', () => {
      if (!chooser.value) {
        sequence++
        plan = undefined
        checked.checked = false
        apply.disabled = true
        media?.forget(content)
        content.replaceChildren()
        return
      }
      void review(candidates[Number(chooser.value)])
    })
    label.append(chooser)
    dialog.append(label)
    if (!candidates.length) {
      chooser.disabled = true
      dialog.append(
        el(
          'p',
          message(
            'No matching complete product from this store and packing month is available. Prepare the original purchase and check its variants and sizes first.'
          )
        )
      )
    }
  }
  checked.addEventListener('change', () => {
    apply.disabled = busy || !plan || !checked.checked
  })
  dialog.addEventListener('cancel', (event) => {
    if (busy) event.preventDefault()
  })
  apply.addEventListener('click', async () => {
    if (busy || !plan || !checked.checked) return
    busy = true
    apply.disabled = cancel.disabled = checked.disabled = true
    if (chooser) chooser.disabled = true
    showError()
    try {
      const saved = linked
        ? await repository.unlinkRepeatProduct(plan)
        : await repository.linkRepeatProduct(plan)
      await onSaved?.(saved)
      dialog.returnValue = 'saved'
      dialog.close()
    } catch (failure) {
      showError(failure)
    } finally {
      busy = false
      cancel.disabled = checked.disabled = false
      if (chooser) chooser.disabled = false
      apply.disabled = !plan || !checked.checked
    }
  })
  dialog.append(error, content, checkLabel)
  pinDialogActions(dialog, actions)
  document.body.append(dialog)
  dialog.showModal()
  if (linked) void review()
  return new Promise((resolve) =>
    dialog.addEventListener(
      'close',
      () => {
        sequence++
        media?.forget(content)
        const saved = dialog.returnValue === 'saved'
        dialog.remove()
        resolve(saved)
      },
      { once: true }
    )
  )
}

/** A chain glyph stays compact beside the assigned product code. */
export function mountRepeatProductControl(
  host,
  { source, linked, repository, media, beforeOpen, onSaved, onError }
) {
  const button = el('button', undefined, 'repeat-product-button icon-button')
  button.type = 'button'
  button.dataset.linked = String(Boolean(linked))
  const label = linked ? 'Linked repeat purchase' : 'Link repeat purchase'
  bindAttribute(button, 'aria-label', label)
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.7')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute(
    'd',
    'M10 13a5 5 0 0 0 7 0l4-4a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-4 4a5 5 0 0 0 7 7l2-2'
  )
  svg.append(path)
  button.append(svg)
  preparationHelp(
    button,
    message(
      linked
        ? 'This product shares reviewed codes with another purchase. Click to review and unlink it.'
        : 'Link this complete product to a matching purchase from the same store and packing month. Review first; source orders and costs stay separate.'
    )
  )
  button.addEventListener('click', async (event) => {
    event.stopPropagation()
    if (button.disabled) return
    button.disabled = true
    try {
      await beforeOpen?.()
      await openRepeatProductDialog({
        source,
        linked,
        repository,
        media,
        onSaved,
      })
    } catch (failure) {
      onError?.(failure)
    } finally {
      button.disabled = false
    }
  })
  host.append(button)
  return button
}
