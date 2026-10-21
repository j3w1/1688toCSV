import { element as el } from './ui.js'
import { bindAttribute, bindText, message } from './i18n.js'
import { decorateIcon } from './icons.js'
import { centsToMoney, moneyToCents } from './money.js'
import { attachSearchSuggestions } from './search-assistance.js'
import {
  eligiblePaymentItems,
  eligiblePaymentSource,
  paymentCostAdjustments,
  paymentLinkReviews,
  paymentLinksTotal,
  paymentSourceClock,
  paymentSourceEvidence,
  validatePaymentGraph,
  validatePaymentLinks,
} from './payment-links.js'

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)

function comparison(before, after) {
  const value = el('span', undefined, 'payment-link-comparison')
  value.append(
    el('span', `¥${before}`),
    el('span', '→'),
    el('strong', `¥${after}`, before === after ? '' : 'payment-link-changed')
  )
  return value
}

/** Compact launcher plus an explicit native review dialog; drafts never autosave. */
export function mountPaymentLinks(host, { record, records, onSave }) {
  records ||= [record]
  let saved = validatePaymentLinks(record.paymentLinks || []),
    rows = [],
    dialog,
    saving = false
  let checked,
    save,
    add,
    status,
    error,
    preview,
    list,
    fields,
    sourceClocks,
    reviewClock
  const control = el('section', undefined, 'payment-links')
  const heading = el('div', undefined, 'payment-links-heading')
  const launch = el('button', message('Linked payments'), 'payment-links-open')
  launch.type = 'button'
  decorateIcon(launch, 'external')
  const summary = el('span', undefined, 'payment-links-total')
  const warning = el('span', undefined, 'payment-links-warning')
  heading.append(launch, summary, warning)
  control.append(heading)
  host.append(control)

  const allRecords = (target = record) =>
    records.some(
      (value) =>
        value.snapshot.accountId === target.snapshot.accountId &&
        value.snapshot.orderId === target.snapshot.orderId
    )
      ? records.map((value) =>
          value.snapshot.accountId === target.snapshot.accountId &&
          value.snapshot.orderId === target.snapshot.orderId
            ? target
            : value
        )
      : [...records, target]
  const sourceFor = (id) =>
    id === record.snapshot.orderId
      ? record
      : records.find(
          (value) =>
            value.snapshot.accountId === record.snapshot.accountId &&
            value.snapshot.orderId === id
        )
  const showError = (value = '') => {
    if (!error) return
    error.hidden = !value
    bindText(error, value ? message(value) : '')
  }
  const refreshSummary = () => {
    const total = paymentLinksTotal(record)
    bindText(
      summary,
      total === '0.00' ? message('No linked payments') : `¥${total}`
    )
    try {
      const reviews = paymentLinkReviews(record, allRecords())
      warning.hidden = !reviews.length
      bindText(
        warning,
        reviews.length ? message('Source payment needs review') : ''
      )
    } catch (failure) {
      warning.hidden = false
      bindText(warning, message(failure.message))
    }
  }
  const read = () => {
    const draft = rows.map((row) => {
      const source = row.selectedSource()
      if (!source) throw new Error('Choose an existing payment source order')
      let amount
      try {
        amount = centsToMoney(moneyToCents(row.amount.value.trim()))
        if (moneyToCents(amount) <= 0n) throw new Error()
      } catch {
        row.amount.setAttribute('aria-invalid', 'true')
        throw new Error('Payment link amounts must use exact cents')
      }
      row.amount.removeAttribute('aria-invalid')
      const sourceEntryId = row.fee.value || undefined
      if (
        !eligiblePaymentSource(record, source) &&
        !(
          row.originalSource.sourceOrderId === source.snapshot.orderId &&
          row.originalSource.sourceEntryId === sourceEntryId
        )
      )
        throw new Error(
          'Choose a payment source from the same known store and account'
        )
      if (
        source.snapshot.orderId === record.snapshot.orderId &&
        sourceEntryId === undefined
      )
        throw new Error('An order cannot link its whole payment to itself')
      return {
        id: row.id,
        sourceOrderId: source.snapshot.orderId,
        ...(sourceEntryId === undefined ? {} : { sourceEntryId }),
        amount,
        reason: row.reason.value.trim(),
        ...(row.scope.value === 'selected'
          ? {
              targetEntryIds: row.targets
                .filter(({ input }) => input.checked)
                .map(({ id }) => id),
            }
          : {}),
        reviewedAt: row.reviewedAt,
        sourceEvidence: paymentSourceEvidence(source, sourceEntryId),
      }
    })
    const target = { ...record, paymentLinks: draft }
    const eligible = eligiblePaymentItems(target, allRecords(target)).map(
      (item) => item.entryId
    )
    return validatePaymentLinks(
      draft.map((link, index) => {
        link.targetEntryIds ??= eligible
        const row = rows[index],
          previous = saved.find((value) => value.id === link.id)
        if (
          previous &&
          !row.reviewSource &&
          same(
            {
              ...link,
              reviewedAt: previous.reviewedAt,
              sourceEvidence: previous.sourceEvidence,
            },
            { ...previous, packingExclusions: undefined }
          )
        )
          return structuredClone(previous)
        return link
      })
    )
  }
  const dirty = () => {
    if (!dialog?.open) return false
    try {
      return !same(read(), saved)
    } catch {
      return true
    }
  }
  const productPreview = (item, before, after) => {
    const product = el('div', undefined, 'payment-link-product')
    if (item.thumbnail) {
      const image = el('img')
      image.src = item.thumbnail
      image.alt = ''
      image.loading = 'lazy'
      product.append(image)
    }
    const info = el('div', undefined, 'payment-link-product-info')
    info.append(
      el('span', item.title || item.description, 'payment-link-product-name')
    )
    const unit = el('div', undefined, 'payment-link-product-cost')
    unit.append(
      el('span', message('Unit price')),
      comparison(before.effectiveUnitPrice, after.effectiveUnitPrice)
    )
    const amount = el('div', undefined, 'payment-link-product-cost')
    amount.append(
      el('span', message('Row amount')),
      comparison(before.effectiveAmount, after.effectiveAmount)
    )
    info.append(unit, amount)
    product.append(info)
    return product
  }
  const renderPreview = () => {
    if (!dialog) return
    save.disabled = saving || !checked.checked || !dirty()
    try {
      const links = read(),
        target = { ...record, paymentLinks: links },
        all = allRecords(target)
      validatePaymentGraph(all)
      const before = paymentCostAdjustments(record, allRecords()),
        after = paymentCostAdjustments(target, all)
      const total = el('div', undefined, 'payment-link-order-total')
      total.append(
        el('span', message('Attributed linked cost')),
        comparison(paymentLinksTotal(record), paymentLinksTotal(target))
      )
      const products = el('div', undefined, 'payment-link-products')
      for (const item of record.snapshot.items) {
        const from = before.get(item.entryId),
          to = after.get(item.entryId)
        if (
          from.effectiveAmount !== to.effectiveAmount ||
          from.effectiveUnitPrice !== to.effectiveUnitPrice
        )
          products.append(productPreview(item, from, to))
      }
      const payable = el(
        'p',
        message(
          'Source payables stay unchanged. This redistributes recorded cost and does not add another payment.'
        ),
        'payment-links-help'
      )
      preview.replaceChildren(total, payable, products)
      if (!products.childNodes.length)
        products.append(
          el(
            'p',
            message('No goods cost changes in this draft.'),
            'payment-links-help'
          )
        )
      if (
        links.some(
          (link) =>
            sourceFor(link.sourceOrderId)?.snapshot.orderId !==
            record.snapshot.orderId
        )
      )
        preview.append(
          el(
            'p',
            message(
              'Linked payment source rows will be skipped in packing. Removing a link restores only skips authored by that link when no later edit replaced them.'
            ),
            'payment-links-help'
          )
        )
    } catch (failure) {
      preview.replaceChildren(
        el('p', message(failure.message), 'payment-links-help')
      )
      save.disabled = true
    }
  }
  const changed = () => {
    checked.checked = false
    showError()
    bindText(status, '')
    renderPreview()
  }
  const label = (text, input) => {
    const field = el('label', undefined, 'payment-link-field')
    field.append(el('span', message(text)), input)
    return field
  }
  const appendLink = (link = {}) => {
    const card = el('fieldset', undefined, 'payment-link-card')
    card.append(el('legend', message('Existing payment source'), 'sr-only'))
    const source = el('input'),
      fee = el('select'),
      reason = el('input'),
      amount = el('input'),
      scope = el('select')
    source.name = 'payment-source-order'
    source.type = 'text'
    source.required = true
    source.autocomplete = 'off'
    source.spellcheck = false
    source.setAttribute('autocorrect', 'off')
    source.setAttribute('autocapitalize', 'off')
    bindAttribute(source, 'placeholder', message('Search this store’s orders'))
    fee.name = 'payment-source-row'
    reason.type = 'text'
    reason.name = 'payment-reason'
    reason.value = link.reason || ''
    reason.required = true
    amount.type = 'text'
    amount.inputMode = 'decimal'
    amount.name = 'payment-amount'
    amount.required = true
    amount.value = link.amount || ''
    scope.name = 'payment-target-scope'
    const selectOption = (select, value, text) => {
      const option = el('option', text)
      option.value = value
      select.append(option)
      return option
    }
    const sourceChoices = allRecords().filter((value) =>
      eligiblePaymentSource(record, value)
    )
    const previousSource = sourceFor(link.sourceOrderId)
    const historical = Boolean(
      previousSource && !eligiblePaymentSource(record, previousSource)
    )
    if (historical) sourceChoices.push(previousSource)
    const sourceLabel = (value) =>
      `${value.snapshot.sellerName || value.snapshot.storeName || ''} · ${value.snapshot.orderId} · ¥${value.snapshot.totals.payable}`
    const sourceLabels = new Map(
      sourceChoices.map((value) => [sourceLabel(value), value.snapshot.orderId])
    )
    const selectedSource = () => {
      const id = sourceLabels.get(source.value) || source.value
      return sourceChoices.some((value) => value.snapshot.orderId === id)
        ? sourceFor(id)
        : undefined
    }
    source.value = previousSource ? sourceLabel(previousSource) : ''
    selectOption(scope, 'all', message('All eligible goods'))
    selectOption(scope, 'selected', message('Selected goods'))
    scope.value = link.targetEntryIds ? 'selected' : 'all'
    const targetsHost = el('div', undefined, 'payment-link-targets')
    const targets = record.snapshot.items
      .filter(
        (item) => !(record.packingExcludedEntryIds || []).includes(item.entryId)
      )
      .map((item) => {
        const input = el('input')
        input.type = 'checkbox'
        input.checked = link.targetEntryIds?.includes(item.entryId) || false
        const choice = el('label')
        choice.append(
          input,
          el('span', item.title || item.description || item.entryId)
        )
        targetsHost.append(choice)
        return { id: item.entryId, input, choice }
      })
    const evidence = el(
      'p',
      undefined,
      'payment-links-help payment-link-evidence'
    )
    const row = {
      id: link.id || crypto.randomUUID(),
      source,
      selectedSource,
      originalSource: link,
      fee,
      reason,
      amount,
      scope,
      targets,
      card,
      reviewSource: false,
      reviewedAt: new Date().toISOString(),
    }
    const refreshSource = ({ reset = false, selected = fee.value } = {}) => {
      const current = selectedSource()
      if (reset) selected = undefined
      fee.replaceChildren()
      if (!current) {
        selectOption(fee, '', message('Choose source order'))
        fee.disabled = true
        bindText(evidence, '')
        return
      }
      fee.disabled = false
      if (current.snapshot.orderId !== record.snapshot.orderId)
        selectOption(
          fee,
          '',
          message('Whole existing payment, including shipping')
        )
      for (const item of current.snapshot.items)
        selectOption(
          fee,
          item.entryId,
          `${item.title || item.description || item.entryId} · ¥${paymentSourceEvidence(current, item.entryId).amount}`
        )
      fee.value =
        selected &&
        current.snapshot.items.some((item) => item.entryId === selected)
          ? selected
          : current.snapshot.orderId === record.snapshot.orderId
            ? current.snapshot.items.find((item) =>
                record.packingExcludedEntryIds?.includes(item.entryId)
              )?.entryId ||
              current.snapshot.items[0]?.entryId ||
              ''
            : ''
      const values = paymentSourceEvidence(current, fee.value || undefined)
      if (reset) amount.value = values.amount
      bindText(
        evidence,
        message(
          'Recorded source amount ¥{0} · source payable ¥{1} · source shipping ¥{2}',
          { 0: values.amount, 1: values.payable, 2: values.shipping }
        )
      )
      for (const target of targets) {
        const isFee =
          current.snapshot.orderId === record.snapshot.orderId &&
          fee.value === target.id
        target.input.disabled = isFee
        target.choice.hidden = isFee
        if (isFee) target.input.checked = false
      }
    }
    const refreshTargets = () => {
      targetsHost.hidden = scope.value !== 'selected'
    }
    source.addEventListener('input', () => {
      refreshSource({ reset: true })
      changed()
    })
    fee.addEventListener('change', () => {
      const current = selectedSource()
      if (current)
        amount.value = paymentSourceEvidence(
          current,
          fee.value || undefined
        ).amount
      refreshSource()
      changed()
    })
    scope.addEventListener('change', () => {
      refreshTargets()
      changed()
    })
    for (const input of [
      reason,
      amount,
      ...targets.map((value) => value.input),
    ])
      input.addEventListener('input', changed)
    const actions = el('div', undefined, 'payment-link-card-actions')
    const review = el('button', message('Review source amount'))
    review.type = 'button'
    review.addEventListener('click', () => {
      row.reviewSource = true
      row.reviewedAt = new Date().toISOString()
      changed()
    })
    const remove = el('button', message('Remove link'))
    remove.type = 'button'
    remove.addEventListener('click', () => {
      rows.splice(rows.indexOf(row), 1)
      row.destroySource?.()
      card.remove()
      changed()
    })
    actions.append(review, remove)
    const grid = el('div', undefined, 'payment-link-fields')
    const sourceField = el(
      'div',
      undefined,
      'payment-link-field payment-link-source-field'
    )
    const sourceHelp = el(
      'small',
      message(
        historical
          ? 'This existing link is kept for review. New payment sources must belong to this store.'
          : 'Search existing orders from this store. Choose this order to use one of its fee rows.'
      ),
      'payment-links-help'
    )
    sourceHelp.id = `payment-source-help-${crypto.randomUUID()}`
    source.setAttribute('aria-describedby', sourceHelp.id)
    sourceField.append(label('Source order', source), sourceHelp)
    grid.append(
      sourceField,
      label('Payment or fee row', fee),
      label('Recorded amount to attribute · CNY', amount),
      label('Reason', reason),
      label('Receiving goods', scope)
    )
    card.append(grid, evidence, targetsHost, actions)
    rows.push(row)
    list.append(card)
    row.destroySource = attachSearchSuggestions(
      source,
      () => [...sourceLabels.keys()],
      { showOnFocus: true }
    )
    refreshSource({ selected: link.sourceEntryId })
    refreshTargets()
    return row
  }
  const flush = async () => {
    if (saving || !dirty()) return
    if (!checked.checked)
      throw new Error('Confirm the payment review before saving')
    const links = read()
    validatePaymentGraph(allRecords({ ...record, paymentLinks: links }))
    saving = true
    fields.disabled = true
    add.disabled = true
    save.disabled = true
    bindText(status, message('Saving…'))
    showError()
    try {
      const sources = new Set(
        [...saved, ...links].map((link) => link.sourceOrderId)
      )
      const expectedSourceClocks = Object.fromEntries(
        [...sources].map((id) => [id, sourceClocks[id]])
      )
      const result = await onSave(links, {
        expectedUpdatedAt: reviewClock,
        expectedSourceClocks,
      })
      record = result?.record?.snapshot
        ? result.record
        : result?.snapshot
          ? result
          : { ...record, paymentLinks: links }
      records = result?.records || allRecords(record)
      saved = validatePaymentLinks(record.paymentLinks || [])
      bindText(status, message('Saved'))
      refreshSummary()
      dialog.close()
    } finally {
      saving = false
      fields.disabled = false
      add.disabled = false
      renderPreview()
    }
  }
  const open = () => {
    if (dialog?.open) return dialog
    rows = []
    reviewClock = record.paymentLinksUpdatedAt || ''
    sourceClocks = Object.fromEntries(
      records
        .filter(
          (value) => value.snapshot.accountId === record.snapshot.accountId
        )
        .map((value) => [value.snapshot.orderId, paymentSourceClock(value)])
    )
    dialog = el('dialog', undefined, 'payment-links-dialog')
    bindAttribute(dialog, 'aria-label', message('Review linked payments'))
    const title = el('header', undefined, 'payment-links-dialog-heading')
    title.append(el('h2', message('Review linked payments')))
    add = el('button', message('Link existing payment'), 'payment-links-add')
    add.type = 'button'
    decorateIcon(add, 'plus')
    add.addEventListener('click', () => {
      if (saving) return
      const row = appendLink()
      changed()
      row.source.focus()
    })
    const close = el('button')
    close.type = 'button'
    decorateIcon(close, 'close', { iconOnly: true, label: message('Close') })
    close.addEventListener('click', () => {
      if (!saving) dialog.close()
    })
    const titleActions = el('div', undefined, 'payment-links-title-actions')
    titleActions.append(add, close)
    title.append(titleActions)
    const form = el('form')
    form.noValidate = true
    fields = el('fieldset')
    fields.append(el('legend', message('Linked payments'), 'sr-only'))
    fields.append(
      el(
        'p',
        message(
          'Link an already recorded payment or fee to its original goods. Keep manually entered additional charges separate.'
        ),
        'payment-links-help'
      )
    )
    list = el('div', undefined, 'payment-links-list')
    fields.append(list)
    preview = el('div', undefined, 'payment-links-preview')
    preview.setAttribute('aria-live', 'polite')
    fields.append(preview)
    const confirmation = el('label', undefined, 'payment-links-confirmation')
    checked = el('input')
    checked.type = 'checkbox'
    checked.addEventListener('change', renderPreview)
    confirmation.append(
      checked,
      el(
        'span',
        message(
          'I reviewed the source payment, receiving goods, costs and packing exclusions.'
        )
      )
    )
    fields.append(confirmation)
    status = el('p', undefined, 'payment-links-status')
    status.setAttribute('role', 'status')
    error = el('p', undefined, 'payment-links-error')
    error.setAttribute('role', 'alert')
    error.hidden = true
    const footer = el('footer', undefined, 'payment-links-footer')
    const cancel = el('button', message('Cancel'))
    cancel.type = 'button'
    cancel.addEventListener('click', () => {
      if (!saving) dialog.close()
    })
    save = el('button', message('Save reviewed links'), 'primary')
    save.type = 'submit'
    footer.append(cancel, save)
    fields.append(status, error, footer)
    form.append(fields)
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      void flush().catch((failure) => {
        showError(failure.message)
        bindText(status, '')
      })
    })
    dialog.addEventListener('cancel', (event) => {
      if (saving) event.preventDefault()
    })
    dialog.addEventListener('close', () => dialog.remove(), { once: true })
    dialog.append(title, form)
    document.body.append(dialog)
    for (const link of saved) appendLink(link)
    dialog.showModal()
    renderPreview()
    close.focus()
    return dialog
  }
  launch.addEventListener('click', open)
  refreshSummary()
  return {
    control,
    open,
    flush,
    dirty,
    update(next, nextRecords = records) {
      if (dialog?.open && !same(next, record)) checked.checked = false
      record = next
      records = nextRecords
      if (!dialog?.open) saved = validatePaymentLinks(record.paymentLinks || [])
      refreshSummary()
      if (dialog?.open) renderPreview()
    },
  }
}
