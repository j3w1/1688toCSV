import { bindAttribute, bindText, getLocale, message } from './i18n.js'
import { element as el, orderReference, pinDialogActions } from './ui.js'
import { packingValueComparison } from './packing-review.js'
import { preparationHelp } from './preparation-help.js'
import { productFeatures } from './product-features.js'
import { setCodeText } from './code-display.js'

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
        : 'Match every variant in this purchase to the original product. The original may include additional sizes; prices and quantities stay separate.'
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
      const features = productFeatures(change.features)
      if (features.length) {
        const readout = el('small', undefined, 'repeat-product-features')
        features.forEach((feature, index) => {
          if (index) readout.append(' · ')
          readout.append(
            el(
              'span',
              change.features[feature.key] === true
                ? message(feature.name)
                : feature.name
            )
          )
          if (/[1-9]/.test(feature.unitCost)) {
            readout.append(
              ` (¥${feature.unitCost} `,
              el('span', message('per piece')),
              '; ',
              el(
                'span',
                message(feature.included ? 'Already recorded' : 'Added cost')
              ),
              ')'
            )
          }
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
    chooser = el('fieldset', undefined, 'repeat-product-choice')
    chooser.append(el('legend', message('Original product and code')))
    const label = el('label', message('Search original products'))
    const search = el('input')
    search.type = 'search'
    search.name = 'repeat-product-search'
    search.id = `repeat-search-${crypto.randomUUID()}`
    search.autocomplete = 'off'
    search.spellcheck = false
    search.setAttribute('autocorrect', 'off')
    search.setAttribute('autocapitalize', 'off')
    label.htmlFor = search.id
    const list = el('div', undefined, 'repeat-product-candidates')
    const empty = el('p', undefined, 'repeat-product-empty')
    empty.setAttribute('role', 'status')
    const name = `repeat-original-${crypto.randomUUID()}`
    const choices = []
    candidates.forEach((candidate, index) => {
      const choice = el('label', undefined, 'repeat-product-candidate')
      choice.dataset.candidate = String(index)
      const input = el('input')
      input.type = 'radio'
      input.name = name
      input.value = String(index)
      const details = el('span', undefined, 'repeat-product-candidate-details')
      details.append(el('strong', candidate.title))
      details.append(
        bindText(el('small'), () => {
          const day = candidate.purchasedAt?.slice(0, 10)
          const date = day
            ? new Date(`${day}T12:00:00Z`).toLocaleDateString(getLocale(), {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
                timeZone: 'UTC',
              })
            : String(message('Date unavailable'))
          return `${candidate.sellerName} · ${candidate.orderId} · ${date}`
        })
      )
      const variants = candidate.variants
      for (const variant of variants) {
        const row = el('span', undefined, 'repeat-product-candidate-variant')
        const photo = variant.items?.[0]
        if (photo && media)
          row.append(media.photo(photo, { interactive: false }))
        else if (photo?.thumbnail) {
          const image = el('img')
          image.src = photo.thumbnail
          image.alt = ''
          image.loading = 'lazy'
          row.append(image)
        }
        const info = el('span')
        const code = el('code', undefined, 'ce-code')
        setCodeText(code, variant.barcode)
        info.append(
          code,
          el(
            'small',
            message('Size {0} · Quantity {1}', {
              0:
                [variant.variant, variant.size].filter(Boolean).join(' · ') ||
                '—',
              1: variant.quantity ?? '—',
            })
          )
        )
        row.append(info)
        details.append(row)
      }
      choice.append(input, details)
      input.addEventListener('change', () => {
        if (input.checked) void review(candidate)
      })
      list.append(choice)
      choices.push({ choice, candidate, variants })
    })
    const filter = () => {
      const query = search.value.normalize('NFKC').trim().toLocaleLowerCase()
      let visible = 0
      for (const { choice, candidate, variants } of choices) {
        const text = [
          candidate.title,
          candidate.sellerName,
          candidate.orderId,
          candidate.purchasedAt,
          ...variants.flatMap((variant) => [
            variant.barcode,
            variant.variant,
            variant.size,
          ]),
        ]
          .filter(Boolean)
          .join(' ')
          .normalize('NFKC')
          .toLocaleLowerCase()
        choice.hidden = Boolean(query && !text.includes(query))
        if (!choice.hidden) visible++
      }
      empty.hidden = visible > 0
      bindText(
        empty,
        message(
          candidates.length
            ? 'No original products match this search. Clear it to see compatible variants.'
            : 'No original product has matching variants from this store and packing month. Prepare the original purchase and check its sizes and features first.'
        )
      )
    }
    search.addEventListener('input', filter)
    chooser.append(label, search, list, empty)
    dialog.append(chooser)
    filter()
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
        if (chooser) media?.forget(chooser)
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
