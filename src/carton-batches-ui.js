import { element as el } from './ui.js'
import { bindAttribute, bindText, message as m } from './i18n.js'
import { decorateIcon } from './icons.js'
import { popupLanguageToggle } from './popup-language-toggle.js'
import { preparationHelp } from './preparation-help.js'
import { setCodeText, CODE_READING_HELP } from './code-display.js'
import { photoCopyTile } from './photo-copy.js'
import { copySingleImage } from './clipboard.js'
import {
  cartonBatchMetrics,
  cartonBatchRemaining,
  validateCartonBatch,
  cartonBatchMark,
  cartonBatchContentGroups,
} from './carton-batches.js'
import {
  cartonCube,
  cartonDecimal,
  cartonDimensionTuple,
  cartonNumberControl,
  cartonWhole,
} from './carton-details-ui.js'

const sourceKey = (value) => JSON.stringify([value.orderId, value.entryId])
const groupKey = (value) => JSON.stringify([value.orderId, value.groupId])
const groupReference = ({ orderId, groupId }) => ({ orderId, groupId })
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const contentsEqual = (left, right) =>
  equal(
    [...left].sort((a, b) => sourceKey(a).localeCompare(sourceKey(b))),
    [...right].sort((a, b) => sourceKey(a).localeCompare(sourceKey(b)))
  )
const clone = (value) => structuredClone(value)
const codeDisplay = (value, className = 'ce-code') => {
  const code = el('span', undefined, className)
  setCodeText(code, value)
  preparationHelp(code, m(CODE_READING_HELP))
  return code
}

/** Exact capacity can suggest full cartons; a remainder never becomes an assumed carton. */
export function cartonBatchProposals(scope, batches) {
  return cartonBatchRemaining(scope, batches)
    .filter((product) => BigInt(product.remaining) > 0n)
    .map((product) => {
      const capacity = String(product.unitsPerCarton || ''),
        quantity = BigInt(product.remaining)
      let count = null
      if (/^[1-9]\d*$/.test(capacity) && quantity % BigInt(capacity) === 0n) {
        const result = Number(quantity / BigInt(capacity))
        if (Number.isSafeInteger(result)) count = result
      }
      const carton = product.carton || {}
      return {
        id: crypto.randomUUID(),
        accountId: scope.accountId,
        month: scope.month,
        storeId: scope.storeId,
        groups: [{ orderId: product.orderId, groupId: product.groupId }],
        mark: { orderId: product.orderId, groupId: product.groupId },
        contents: [
          {
            orderId: product.orderId,
            entryId: product.entryId,
            quantity: product.remaining,
          },
        ],
        count,
        len: carton.len || '',
        wid: carton.wid || '',
        ht: carton.ht || '',
        weightBasis: 'carton',
        weight: carton.kg || '',
        suppliedCbm: carton.cbm || '',
        received: null,
        loaded: null,
        revision: 0,
        updatedAt: new Date().toISOString(),
      }
    })
}

/** The modal owns transient drafts only. Expected revisions remain the repository's authority. */
export function openCartonBatchEditor({
  scope,
  batches = [],
  onSave,
  onRemove,
  loadPhoto,
  onChange,
  renderMark,
}) {
  const dialog = el('dialog', undefined, 'carton-batch-dialog'),
    header = el('header', undefined, 'carton-batch-header'),
    heading = el('div', undefined, 'carton-batch-heading'),
    tools = el('div', undefined, 'carton-batch-header-tools'),
    close = decorateIcon(el('button'), 'close', {
      iconOnly: true,
      label: m('Close carton details'),
    }),
    body = el('div', undefined, 'carton-batch-body'),
    navigator = el('nav', undefined, 'carton-batch-navigation'),
    editor = el(
      'form',
      undefined,
      'carton-batch-editor product-carton-details'
    ),
    footer = el('footer', undefined, 'carton-batch-footer'),
    status = el('span', undefined, 'carton-batch-status'),
    apply = decorateIcon(
      el('button', m('Apply carton contents'), 'primary'),
      'check'
    ),
    remove = el('button', m('Remove batch'), 'carton-batch-remove'),
    done = el('button', m('Done')),
    dismissal = el('div', undefined, 'carton-batch-dismissal'),
    discard = el('button', m('Discard unapplied changes')),
    keep = el('button', m('Keep editing')),
    all = clone(batches),
    drafts = new Map(),
    touched = new Set(),
    groupIds = new Set(scope.groups.map(groupKey)),
    initialGroupIds = new Set(
      (scope.initialGroupRefs || scope.groups).map(groupKey)
    ),
    productIds = new Set(scope.products.map(sourceKey))
  let selected,
    inputs,
    selections,
    weightBasis,
    packingMode,
    selectedMark,
    timer,
    work,
    viewVersion = 0,
    resolveClosed,
    changed = false,
    closing = false
  const promise = new Promise((resolve) => {
    resolveClosed = resolve
  })
  bindAttribute(dialog, 'aria-label', m('Carton batches'))
  dialog.dataset.baseCode = scope.baseCode
  close.type = done.type = remove.type = discard.type = keep.type = 'button'
  apply.type = 'submit'
  apply.setAttribute('form', `carton-batches-${crypto.randomUUID()}`)
  editor.id = apply.getAttribute('form')
  heading.append(
    el('h2', m('Carton batches')),
    codeDisplay(scope.baseCode, 'ce-code carton-batch-group-code'),
    el(
      'span',
      `${scope.sellerName || ''} · ${scope.month}`,
      'carton-batch-context'
    )
  )
  const mark = el('div', undefined, 'carton-batch-mark')
  heading.append(mark)
  let markVersion = 0
  async function refreshMark() {
    const choice = scope.groups.find(
        (group) => groupKey(group) === groupKey(selectedMark || {})
      ),
      code = heading.querySelector('.carton-batch-group-code'),
      version = ++markVersion
    code.hidden = readOnly() || !choice
    if (choice) setCodeText(code, choice.baseCode || scope.baseCode)
    mark.hidden = readOnly() || !renderMark || !choice
    mark.replaceChildren()
    if (mark.hidden) return
    try {
      const markScope = {
          ...scope,
          ...choice,
          baseCode: choice.baseCode || scope.baseCode,
          category: choice.category || scope.category,
          mark: clone(selectedMark),
        },
        rendered = await renderMark(markScope)
      if (!dialog.isConnected || version !== markVersion || !rendered) return
      if (rendered.nodeType) mark.append(rendered)
      else {
        const image = el('img')
        image.src = rendered
        bindAttribute(
          image,
          'alt',
          m('Carton mark {0}', { 0: markScope.baseCode })
        )
        mark.append(image)
      }
    } catch {
      if (version === markVersion) mark.hidden = true
    }
  }
  tools.append(popupLanguageToggle(dialog), close)
  header.append(heading, tools)
  bindAttribute(navigator, 'aria-label', m('Carton batches'))
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  dismissal.hidden = true
  dismissal.append(
    el('span', m('Carton contents have unapplied changes.')),
    keep,
    discard
  )
  footer.append(status, remove, done, apply)
  body.append(navigator, editor)
  dialog.append(header, body, dismissal, footer)
  document.body.append(dialog)

  const relevant = (batch) =>
    !batch.deletedAt &&
    batch.accountId === scope.accountId &&
    batch.storeId === scope.storeId &&
    ((batch.month === scope.month &&
      batch.groups.some((group) => groupIds.has(groupKey(group)))) ||
      (batch.needsReview &&
        batch.contents.some((product) => productIds.has(sourceKey(product)))))
  const savedFor = (id) =>
    all.find((batch) => batch.id === id && !batch.deletedAt)
  function nextCartonNumber() {
    let maximum = 0n
    for (const batch of [...all, ...drafts.values()]) {
      if (
        batch.deletedAt ||
        batch.accountId !== scope.accountId ||
        batch.storeId !== scope.storeId ||
        batch.month !== scope.month ||
        !/^\d+$/.test(batch.cartonNumber || '')
      )
        continue
      const number = BigInt(batch.cartonNumber)
      if (number > maximum) maximum = number
    }
    return String(maximum + 1n)
  }
  const fresh = (contents = []) => ({
    id: crypto.randomUUID(),
    accountId: scope.accountId,
    month: scope.month,
    storeId: scope.storeId,
    groups: cartonBatchContentGroups(scope, contents),
    mark: groupReference(scope.mark || scope.groups[0]),
    contents,
    cartonNumber: nextCartonNumber(),
    count: 1,
    len: '',
    wid: '',
    ht: '',
    weightBasis: 'carton',
    weight: '',
    suppliedCbm: '',
    received: null,
    loaded: null,
    revision: 0,
    updatedAt: new Date().toISOString(),
  })
  const showError = (error) => {
    dialog.dataset.saveState = 'error'
    bindText(
      status,
      m('Not saved: {error}. Your draft is still here.', {
        error: m(error.message || String(error)),
      })
    )
  }
  function availableProducts() {
    return cartonBatchRemaining(scope, all, selected)
  }
  function currentDraft() {
    return drafts.get(selected)
  }
  const readOnly = () => currentDraft()?.month !== scope.month
  function read({ validate = true, correctReview = false } = {}) {
    const current = currentDraft()
    if (!current || !inputs) return current
    const next = { ...clone(current), weightBasis }
    delete next._raw
    for (const key of ['count', 'received', 'loaded']) {
      try {
        next[key] = cartonWhole(inputs[key].value)
        inputs[key].removeAttribute('aria-invalid')
      } catch (error) {
        inputs[key].setAttribute('aria-invalid', 'true')
        throw error
      }
    }
    for (const key of ['len', 'wid', 'ht', 'weight'])
      next[key] = cartonDecimal(inputs[key].value, {
        positive: key !== 'weight',
      })
    if (packingMode === 'exact') {
      next.cartonNumber = inputs.cartonNumber.value.trim()
      next.count = 1
    } else delete next.cartonNumber
    next.contents = []
    for (const [key, entry] of selections) {
      if (!entry.checked.checked) continue
      const quantity = String(entry.quantity.value).trim()
      if (!/^[1-9]\d*$/.test(quantity))
        throw new Error(
          'Carton contents must contain positive whole quantities'
        )
      if (BigInt(quantity) > BigInt(entry.product.remaining)) {
        entry.quantity.setAttribute('aria-invalid', 'true')
        throw new Error(
          'Carton contents exceed the current available product quantity.'
        )
      }
      entry.quantity.removeAttribute('aria-invalid')
      next.contents.push({
        orderId: entry.product.orderId,
        entryId: entry.product.entryId,
        quantity,
      })
    }
    next.groups = cartonBatchContentGroups(scope, next.contents)
    next.mark = clone(selectedMark)
    if (correctReview && current.needsReview) {
      delete next.needsReview
    }
    if (validate) return validateCartonBatch(next)
    return next
  }
  function membershipDirty(value = read({ validate: false })) {
    const saved = savedFor(selected)
    return (
      !saved ||
      currentDraft()?.needsReview ||
      (saved.cartonNumber || '') !== (value.cartonNumber || '') ||
      !equal(cartonBatchMark(saved), value.mark) ||
      !contentsEqual(saved.contents, value.contents)
    )
  }
  function dirty() {
    if (readOnly()) return false
    if (!touched.has(selected) && !currentDraft()?._raw) return false
    try {
      const next = read({ validate: false }),
        saved = savedFor(selected)
      if (!saved && !touched.has(selected)) return false
      if (!saved)
        return Boolean(
          next.contents.length ||
          ['len', 'wid', 'ht', 'weight'].some((key) => next[key]) ||
          ['count', 'received', 'loaded'].some((key) => next[key] !== null)
        )
      return !equal(validateCartonBatch(next), validateCartonBatch(saved))
    } catch {
      return true
    }
  }
  function otherDraftsDirty() {
    return [...drafts.values()].some((draft) => {
      if (draft.id === selected) return false
      if (draft.month !== scope.month) return false
      if (draft._raw) return true
      if (!touched.has(draft.id)) return false
      const saved = savedFor(draft.id)
      if (!saved && !touched.has(draft.id)) return false
      if (!saved)
        return Boolean(
          draft.contents.length ||
          ['len', 'wid', 'ht', 'weight'].some((key) => draft[key]) ||
          ['count', 'received', 'loaded'].some((key) => draft[key] !== null)
        )
      try {
        return !equal(validateCartonBatch(draft), validateCartonBatch(saved))
      } catch {
        return true
      }
    })
  }
  function preserve() {
    if (!selected || !inputs || readOnly()) return
    try {
      drafts.set(selected, read({ validate: false }))
    } catch {
      // Keep exact, incomplete typed drafts when navigating between batch cards.
      currentDraft()._raw = {
        fields: Object.fromEntries(
          Object.entries(inputs).map(([key, input]) => [key, input.value])
        ),
        choices: [...selections].map(([key, entry]) => [
          key,
          entry.checked.checked,
          entry.quantity.value,
        ]),
        weightBasis,
        packingMode,
        selectedMark: clone(selectedMark),
      }
    }
  }
  function renderNavigation() {
    navigator.replaceChildren()
    const items = [...all.filter(relevant)]
    for (const draft of drafts.values())
      if (!savedFor(draft.id)) items.push(draft)
    items.forEach((batch, index) => {
      const button = el('button', undefined, 'carton-batch-card')
      button.type = 'button'
      button.dataset.batchId = batch.id
      button.dataset.month = batch.month
      button.setAttribute('aria-current', String(batch.id === selected))
      const name = batch.cartonNumber
        ? m('Carton {0}', { 0: batch.cartonNumber })
        : savedFor(batch.id)
          ? m('Batch {0}', { 0: index + 1 })
          : m('New batch {0}', { 0: index + 1 })
      button.append(
        el('strong', name),
        el('time', batch.month, 'carton-batch-month'),
        el(
          'span',
          m('{0} cartons · {1} products', {
            0: batch.count ?? '—',
            1: batch.contents.length,
          })
        )
      )
      if (batch.needsReview)
        button.append(el('span', m('Review cartons'), 'carton-batch-review'))
      button.addEventListener('click', () => void select(batch.id))
      navigator.append(button)
    })
    const add = decorateIcon(
      el('button', m('New batch'), 'carton-batch-new'),
      'plus'
    )
    add.type = 'button'
    add.addEventListener('click', () => {
      if (work) return
      preserve()
      const batch = fresh()
      drafts.set(batch.id, batch)
      void select(batch.id)
    })
    navigator.append(add)
  }
  function fillRemaining({ allProducts = false } = {}) {
    const available = availableProducts()
    for (const product of available) {
      const row = selections.get(sourceKey(product))
      if (!row || (!allProducts && !row.checked.checked)) continue
      row.checked.checked =
        BigInt(product.remaining) > 0n &&
        (!allProducts || initialGroupIds.has(groupKey(product)))
      row.quantity.value = product.remaining
      row.quantity.disabled = !row.checked.checked
      row.card.dataset.selected = String(row.checked.checked)
    }
    contentChanged()
  }
  function renderEditor() {
    viewVersion++
    const version = viewVersion,
      draft = currentDraft(),
      available = availableProducts()
    inputs = {}
    selections = new Map()
    weightBasis = draft.weightBasis
    packingMode =
      draft._raw?.packingMode || (draft.cartonNumber ? 'exact' : 'batch')
    const priorMark = draft.mark || cartonBatchMark(draft),
      availableMark = scope.groups.some(
        (group) => groupKey(group) === groupKey(priorMark || {})
      )
    selectedMark = clone(
      draft._raw?.selectedMark ||
        (availableMark || draft.mark
          ? priorMark
          : groupReference(scope.mark || scope.groups[0]))
    )
    editor.replaceChildren()
    const identity = el('section', undefined, 'carton-batch-identity'),
      modeSwitch = el('div', undefined, 'carton-batch-mode'),
      cartonNumberField = el(
        'div',
        undefined,
        'product-carton-field carton-batch-number'
      ),
      cartonNumberLabel = el('label', m('Carton number')),
      cartonNumber = el('input'),
      modeHelp = el('p', undefined, 'carton-batch-mode-help'),
      markChoices = el('div', undefined, 'carton-batch-mark-choices'),
      markChoicesHeading = el('h3', m('Actual carton mark'))
    let aggregateCount = draft.cartonNumber ? '' : (draft.count ?? '')
    modeSwitch.setAttribute('role', 'group')
    bindAttribute(modeSwitch, 'aria-label', m('Packing detail'))
    for (const [mode, label] of [
      ['exact', 'Exact carton'],
      ['batch', 'Batch'],
    ]) {
      const button = el('button', m(label))
      button.type = 'button'
      button.dataset.packingMode = mode
      button.addEventListener('click', () => {
        if (readOnly() || packingMode === mode) return
        if (packingMode === 'batch') aggregateCount = inputs.count.value
        packingMode = mode
        inputs.count.value = mode === 'exact' ? '1' : String(aggregateCount)
        updateMode()
        contentChanged()
      })
      modeSwitch.append(button)
    }
    cartonNumber.id = `carton-number-${crypto.randomUUID()}`
    cartonNumber.name = 'cartonNumber'
    cartonNumber.type = 'text'
    cartonNumber.maxLength = 80
    cartonNumber.autocomplete = 'off'
    cartonNumber.value = draft.cartonNumber || nextCartonNumber()
    cartonNumberLabel.setAttribute('for', cartonNumber.id)
    bindAttribute(cartonNumber, 'aria-label', m('Carton number'))
    preparationHelp(
      cartonNumber,
      m('Supplier carton number, for example 1, 001 or A-01.')
    )
    cartonNumber.addEventListener('input', contentChanged)
    inputs.cartonNumber = cartonNumber
    cartonNumberField.append(cartonNumberLabel, cartonNumber)
    identity.append(modeSwitch, cartonNumberField, modeHelp)
    const markOptions = new Map()
    for (const choice of scope.groups) {
      const code = choice.baseCode || scope.baseCode
      if (
        !markOptions.has(code) ||
        groupKey(choice) === groupKey(selectedMark || {})
      )
        markOptions.set(code, choice)
    }
    markChoices.append(markChoicesHeading)
    const markButtons = el('div', undefined, 'carton-batch-mark-options')
    markButtons.setAttribute('role', 'group')
    bindAttribute(markButtons, 'aria-label', m('Actual carton mark'))
    for (const [code, choice] of markOptions) {
      const button = el('button')
      button.type = 'button'
      button.dataset.markGroup = choice.groupId
      button.dataset.markOrder = choice.orderId
      bindAttribute(button, 'aria-label', m('Use carton mark {0}', { 0: code }))
      button.append(codeDisplay(code))
      button.addEventListener('click', () => {
        if (readOnly()) return
        selectedMark = groupReference(choice)
        updateMarks()
        contentChanged()
      })
      markButtons.append(button)
    }
    function updateMarks() {
      for (const button of markButtons.children)
        button.setAttribute(
          'aria-pressed',
          String(
            groupKey({
              orderId: button.dataset.markOrder,
              groupId: button.dataset.markGroup,
            }) === groupKey(selectedMark || {})
          )
        )
      void refreshMark()
    }
    markChoices.append(markButtons)
    const contents = el('section', undefined, 'carton-batch-contents'),
      contentHeader = el('header', undefined, 'carton-batch-section-heading'),
      choices = el('div', undefined, 'carton-batch-choices'),
      shortcuts = el('div', undefined, 'carton-batch-shortcuts')
    contentHeader.append(
      el('h3', m('Carton contents')),
      el('span', m('Total across this batch'))
    )
    for (const [label, action] of [
      ['Pack together', () => fillRemaining({ allProducts: true })],
      ['Separate variants', separate],
      ['Use all remaining', () => fillRemaining()],
      ['Another carton', anotherCarton],
    ]) {
      const button = el('button', m(label))
      button.type = 'button'
      button.addEventListener('click', action)
      shortcuts.append(button)
    }
    for (const product of available) {
      const key = sourceKey(product),
        allocation = draft.contents.find((entry) => sourceKey(entry) === key),
        card = el('div', undefined, 'carton-batch-product'),
        checkboxLabel = el('label', undefined, 'carton-batch-product-pick'),
        checked = el('input'),
        info = el('span', undefined, 'carton-batch-product-info'),
        quantityLabel = el('label', m('Pieces'), 'carton-batch-quantity'),
        quantity = el('input')
      card.dataset.orderId = product.orderId
      card.dataset.entryId = product.entryId
      checked.type = 'checkbox'
      checked.checked = Boolean(allocation)
      checked.disabled = !allocation && BigInt(product.remaining) === 0n
      card.dataset.selected = String(checked.checked)
      checkboxLabel.append(checked)
      if (product.thumbnail) {
        const image = el('img'),
          photo = el('span', undefined, 'carton-batch-product-photo'),
          tile = photoCopyTile(
            photo,
            async () =>
              copySingleImage(
                loadPhoto
                  ? await loadPhoto(product.thumbnail)
                  : product.thumbnail
              ),
            { onError: showError }
          )
        tile.classList.add('photo-copy-square')
        image.alt = ''
        image.loading = 'lazy'
        photo.append(image)
        card.append(tile)
        void (async () => {
          try {
            const url = loadPhoto
              ? await loadPhoto(product.thumbnail)
              : product.thumbnail
            if (version === viewVersion && card.isConnected) image.src = url
          } catch {
            image.remove()
          }
        })()
      }
      info.append(
        codeDisplay(product.barcode || scope.baseCode),
        el(
          'span',
          product.description || product.title || '',
          'carton-batch-product-description'
        ),
        el(
          'small',
          m('{0} available · Purchase {1}', {
            0: product.remaining,
            1: product.orderId,
          })
        )
      )
      checkboxLabel.append(info)
      quantity.type = 'text'
      quantity.inputMode = 'numeric'
      quantity.setAttribute('pattern', '[1-9][0-9]*')
      quantity.value = allocation?.quantity || product.remaining
      quantity.disabled = !checked.checked
      quantity.id = `batch-quantity-${crypto.randomUUID()}`
      quantityLabel.setAttribute('for', quantity.id)
      quantityLabel.append(quantity)
      checked.addEventListener('change', () => {
        quantity.disabled = !checked.checked
        card.dataset.selected = String(checked.checked)
        contentChanged()
      })
      quantity.addEventListener('input', contentChanged)
      selections.set(key, { card, product, checked, quantity })
      card.append(checkboxLabel, quantityLabel)
      choices.append(card)
    }
    const missing = draft.contents.filter(
      (entry) => !selections.has(sourceKey(entry))
    )
    for (const product of missing) {
      const card = el(
          'div',
          undefined,
          'carton-batch-product carton-batch-missing'
        ),
        label = el('label'),
        checked = el('input'),
        quantity = el('input')
      checked.type = 'checkbox'
      checked.checked = true
      quantity.value = product.quantity
      quantity.hidden = true
      label.append(
        checked,
        el('span', m('Unavailable product: {0}', { 0: product.entryId }))
      )
      checked.addEventListener('change', contentChanged)
      card.append(
        label,
        el('span', m('Review this allocation before applying.'))
      )
      selections.set(sourceKey(product), {
        card,
        product: { ...product, remaining: '0' },
        checked,
        quantity,
      })
      choices.append(card)
    }
    contents.append(contentHeader, shortcuts, choices)
    const measurements = el('section', undefined, 'carton-batch-measurements'),
      measurementHeader = el(
        'header',
        undefined,
        'carton-batch-section-heading'
      ),
      reuse = el('button', m('Reuse measurements')),
      reuseList = el('div', undefined, 'carton-batch-reuse-list'),
      geometry = el('div', undefined, 'product-carton-geometry'),
      dimensions = el('fieldset', undefined, 'product-carton-dimensions'),
      dimensionFields = el('div', undefined, 'product-carton-dimension-fields'),
      counts = el('div', undefined, 'carton-batch-counts'),
      weight = el('div', undefined, 'carton-batch-weight')
    reuse.type = 'button'
    reuseList.hidden = true
    const candidates = all.filter(
      (batch) =>
        !batch.deletedAt &&
        batch.accountId === scope.accountId &&
        batch.storeId === scope.storeId &&
        batch.id !== selected &&
        (['len', 'wid', 'ht'].every((key) => batch[key]) || batch.weight)
    )
    reuse.disabled = candidates.length === 0
    preparationHelp(
      reuse,
      m(
        candidates.length
          ? 'Reuse dimensions and weight from this store. Counts and contents stay unchanged.'
          : 'No saved measurements from this store yet.'
      )
    )
    reuse.setAttribute('aria-expanded', 'false')
    reuseList.id = `batch-reuse-${crypto.randomUUID()}`
    reuse.setAttribute('aria-controls', reuseList.id)
    reuse.addEventListener('click', () => {
      reuseList.hidden = !reuseList.hidden
      reuse.setAttribute('aria-expanded', String(!reuseList.hidden))
    })
    for (const batch of candidates) {
      const button = el(
        'button',
        `${batch.len || '—'} × ${batch.wid || '—'} × ${batch.ht || '—'} cm · ${batch.weight || '—'} kg`
      )
      button.type = 'button'
      button.addEventListener('click', () => {
        for (const key of ['len', 'wid', 'ht', 'weight'])
          inputs[key].value = batch[key] || ''
        weightBasis = batch.weightBasis
        updateBasis()
        reuseList.hidden = true
        reuse.setAttribute('aria-expanded', 'false')
        measurementChanged()
      })
      reuseList.append(button)
    }
    measurementHeader.append(el('h3', m('Carton measurements')), reuse)
    dimensions.append(el('legend', m('Carton · cm')))
    let countField
    for (const [key, label] of [
      ['len', 'Length'],
      ['wid', 'Width'],
      ['ht', 'Height'],
    ]) {
      if (dimensionFields.childElementCount)
        dimensionFields.append(el('span', '×', 'product-carton-times'))
      const control = cartonNumberControl({
        key,
        label,
        value: draft[key],
        onInput: measurementChanged,
      })
      inputs[key] = control.input
      control.input.addEventListener('paste', (event) => {
        const tuple = cartonDimensionTuple(
          event.clipboardData?.getData('text/plain')
        )
        if (!tuple) return
        event.preventDefault()
        for (const [key, value] of Object.entries(tuple))
          inputs[key].value = value
        measurementChanged()
      })
      dimensionFields.append(control.field)
    }
    dimensions.append(
      dimensionFields,
      el(
        'p',
        m('Paste L × W × H, or enter centimetres.'),
        'product-carton-note'
      )
    )
    geometry.append(cartonCube(), dimensions)
    for (const [key, label] of [
      ['count', 'Cartons'],
      ['received', 'Received boxes'],
      ['loaded', 'Loaded boxes'],
    ]) {
      const control = cartonNumberControl({
        key,
        label,
        value: draft[key],
        integer: true,
        onInput: measurementChanged,
      })
      inputs[key] = control.input
      if (key === 'count') countField = control.field
      counts.append(control.field)
    }
    const weightControl = cartonNumberControl({
        key: 'weight',
        label: 'Weight',
        value: draft.weight,
        unit: 'kg',
        onInput: measurementChanged,
      }),
      basis = el('div', undefined, 'carton-batch-weight-basis')
    inputs.weight = weightControl.input
    basis.setAttribute('role', 'group')
    bindAttribute(basis, 'aria-label', m('Weight basis'))
    for (const [value, text] of [
      ['carton', 'Per carton'],
      ['batch', 'Batch total'],
    ]) {
      const button = el('button', m(text))
      button.type = 'button'
      button.dataset.basis = value
      button.addEventListener('click', () => {
        weightBasis = value
        updateBasis()
        measurementChanged()
      })
      basis.append(button)
    }
    function updateBasis() {
      for (const button of basis.children)
        button.setAttribute(
          'aria-pressed',
          String(button.dataset.basis === weightBasis)
        )
    }
    updateBasis()
    weight.append(weightControl.field, basis)
    const supplied = el('p', undefined, 'product-carton-supplied')
    supplied.hidden = !draft.suppliedCbm
    if (!supplied.hidden)
      bindText(
        supplied,
        m('Supplied volume: {0} m³ · read-only', { 0: draft.suppliedCbm })
      )
    measurements.append(
      measurementHeader,
      reuseList,
      geometry,
      counts,
      weight,
      supplied
    )
    function updateMode() {
      for (const button of modeSwitch.children)
        button.setAttribute(
          'aria-pressed',
          String(button.dataset.packingMode === packingMode)
        )
      cartonNumberField.hidden = packingMode !== 'exact'
      cartonNumber.required = packingMode === 'exact'
      cartonNumber.disabled = readOnly() || packingMode !== 'exact'
      countField.hidden = packingMode === 'exact'
      inputs.count.disabled = readOnly() || packingMode === 'exact'
      if (packingMode === 'exact') inputs.count.value = '1'
      basis.hidden = packingMode === 'exact'
      bindText(
        modeHelp,
        m(
          packingMode === 'exact'
            ? 'Contents and measurements describe this one numbered carton.'
            : 'Totals across several cartons. Per-carton contents remain unspecified.'
        )
      )
      updateSummary()
    }
    editor.append(
      identity,
      markChoices,
      contents,
      measurements,
      el('div', undefined, 'carton-batch-summary'),
      el('p', undefined, 'carton-batch-warning')
    )
    if (draft._raw) {
      for (const [key, value] of Object.entries(draft._raw.fields))
        inputs[key].value = value
      for (const [key, checked, value] of draft._raw.choices) {
        const row = selections.get(key)
        if (!row) continue
        row.checked.checked = checked
        row.quantity.value = value
        row.quantity.disabled = !checked
        row.card.dataset.selected = String(checked)
      }
      weightBasis = draft._raw.weightBasis
      updateBasis()
    }
    updateMode()
    updateMarks()
    editor.dataset.readOnly = String(readOnly())
    if (readOnly()) {
      for (const control of editor.querySelectorAll('input, button'))
        control.disabled = true
      const notice = el(
        'p',
        m(
          'This batch belongs to {0}. It is read-only. Remove it to release its allocation; confirmations stay in the original month.',
          { 0: draft.month }
        ),
        'carton-batch-readonly-note'
      )
      editor.prepend(notice)
    }
    updateSummary()
  }
  function updateSummary() {
    const summary = editor.querySelector('.carton-batch-summary'),
      warning = editor.querySelector('.carton-batch-warning')
    if (!summary) return
    apply.hidden = readOnly()
    apply.disabled = Boolean(work) || readOnly()
    remove.hidden = !savedFor(selected) || !onRemove
    summary.replaceChildren()
    let value
    try {
      value = readOnly() ? clone(currentDraft()) : read()
      for (const input of Object.values(inputs))
        input.removeAttribute('aria-invalid')
    } catch (error) {
      try {
        value = read({ validate: false })
      } catch {}
      if (!value) {
        bindText(warning, m(error.message))
        warning.hidden = false
        apply.disabled = Boolean(work)
        return
      }
    }
    let metrics
    try {
      metrics = cartonBatchMetrics(value)
    } catch {
      return
    }
    const exact = Boolean(value.cartonNumber)
    for (const [label, text, unit] of exact
      ? [
          ['Pieces', metrics.quantity, ''],
          ['Carton volume', metrics.volumePerCarton, 'm³'],
          ['Carton weight', metrics.totalWeight, 'kg'],
        ]
      : [
          ['Pieces', metrics.quantity, ''],
          ['m³/box', metrics.volumePerCarton, 'm³'],
          ['Batch volume', metrics.totalVolume, 'm³'],
          ['Batch weight', metrics.totalWeight, 'kg'],
        ]) {
      const cell = el('span', undefined, 'carton-batch-metric')
      cell.append(
        el('small', m(label)),
        el('strong', text === '' ? '—' : `${text}${unit ? ` ${unit}` : ''}`)
      )
      summary.append(cell)
    }
    const notes = []
    if (
      !value.contents.length &&
      availableProducts().every((product) => product.remaining === '0')
    )
      notes.push(m('All available pieces are already allocated.'))
    if (currentDraft().needsReview && !readOnly())
      notes.push(m('Review contents, then Apply to confirm this group.'))
    if (
      value.count !== null &&
      ((value.received !== null && value.received > value.count) ||
        (value.loaded !== null && value.loaded > value.count))
    )
      notes.push(
        m('Confirmed counts exceed planned cartons. Check the counts.')
      )
    if (
      value.weightBasis === 'batch' &&
      value.loaded !== null &&
      value.loaded !== 0 &&
      value.loaded !== value.count
    )
      notes.push(m('Partial loaded weight is unknown for a batch total.'))
    if (!exact && value.contents.length > 1)
      notes.push(
        m('Mixed contents: per-carton piece distribution is not assumed.')
      )
    warning.hidden = notes.length === 0
    bindText(warning, () => notes.map(String).join(' '))
    apply.hidden = readOnly()
    apply.disabled = Boolean(work) || readOnly()
    remove.hidden = !savedFor(selected) || !onRemove
    apply.textContent = ''
    bindText(
      apply,
      m(
        membershipDirty(value) ? 'Apply carton contents' : 'Save carton details'
      )
    )
    decorateIcon(apply, 'check')
  }
  function contentChanged() {
    if (readOnly()) return
    touched.add(selected)
    clearTimeout(timer)
    dialog.dataset.saveState = 'draft'
    bindText(status, m('Apply to save carton contents.'))
    updateSummary()
  }
  function measurementChanged() {
    if (readOnly()) return
    touched.add(selected)
    dialog.dataset.saveState = 'draft'
    bindText(status, m('Not saved yet'))
    updateSummary()
    clearTimeout(timer)
    timer = setTimeout(() => {
      try {
        if (!membershipDirty()) void flush().catch(() => {})
      } catch {}
    }, 450)
  }
  function setBusy(busy) {
    dialog.setAttribute('aria-busy', String(busy))
    apply.disabled = remove.disabled = busy
    for (const button of navigator.querySelectorAll('button'))
      button.disabled = busy
  }
  async function saveCurrent({ explicit = false } = {}) {
    clearTimeout(timer)
    if (readOnly() || (!explicit && currentDraft()?.needsReview)) return
    if (!explicit && !touched.has(selected) && !currentDraft()?._raw) return
    if (work) {
      await work
      return saveCurrent({ explicit })
    }
    let submitted, originalSubmission
    try {
      originalSubmission = read()
      submitted =
        explicit && currentDraft().needsReview
          ? read({ correctReview: true })
          : originalSubmission
      if (!explicit && membershipDirty(submitted)) return
    } catch (error) {
      showError(error)
      throw error
    }
    const before = savedFor(selected)
    if (before && equal(validateCartonBatch(before), submitted)) return
    const capturedId = selected,
      expectedRevision = before?.revision ?? 0
    setBusy(true)
    dialog.dataset.saveState = 'saving'
    bindText(status, m('Saving…'))
    work = (async () => onSave(submitted, { expectedRevision }))()
    try {
      const saved = await work
      if (!saved?.id) throw new Error('The carton batch could not be saved.')
      const index = all.findIndex((entry) => entry.id === saved.id)
      if (index < 0) all.push(clone(saved))
      else all[index] = clone(saved)
      changed = true
      // Inputs stay editable during persistence: retain later keystrokes with the new clock.
      let next
      try {
        next = read({ validate: false })
      } catch {}
      const stillSame =
        next &&
        equal(
          {
            ...next,
            revision: originalSubmission.revision,
            updatedAt: originalSubmission.updatedAt,
          },
          originalSubmission
        )
      if (stillSame) drafts.set(capturedId, clone(saved))
      else {
        preserve()
        Object.assign(drafts.get(capturedId), {
          revision: saved.revision,
          updatedAt: saved.updatedAt,
          groups: clone(saved.groups),
        })
        if (!saved.needsReview) delete drafts.get(capturedId).needsReview
      }
      dialog.dataset.saveState = 'saved'
      bindText(status, m('Saved'))
      renderNavigation()
      if (stillSame) renderEditor()
      if (onChange) await onChange(saved)
    } catch (error) {
      showError(error)
      throw error
    } finally {
      work = undefined
      setBusy(false)
      updateSummary()
    }
    if (!explicit && dirty()) {
      try {
        if (!membershipDirty()) return saveCurrent()
      } catch {}
    }
  }
  const flush = () => saveCurrent()
  async function select(id) {
    if (work || id === selected) return
    clearTimeout(timer)
    if (selected && inputs) {
      try {
        if (!membershipDirty()) await flush()
      } catch {
        preserve()
      }
      preserve()
    }
    selected = id
    delete remove.dataset.confirm
    bindText(remove, m('Remove batch'))
    if (!drafts.has(id)) drafts.set(id, clone(savedFor(id)))
    dismissal.hidden = true
    bindText(status, '')
    renderNavigation()
    renderEditor()
  }
  async function separate() {
    if (work) return
    preserve()
    const chosen = new Set(
        [...selections]
          .filter(([, entry]) => entry.checked.checked)
          .map(([key]) => key)
      ),
      proposals = cartonBatchProposals(
        {
          ...scope,
          products: scope.products.filter((product) =>
            chosen.size
              ? chosen.has(sourceKey(product))
              : initialGroupIds.has(groupKey(product))
          ),
        },
        all
      )
    if (!proposals.length) {
      bindText(status, m('All available pieces are already allocated.'))
      return
    }
    for (const proposal of proposals) {
      drafts.set(proposal.id, proposal)
      touched.add(proposal.id)
    }
    await select(proposals[0].id)
    bindText(
      status,
      m('{0} separate proposals. Apply each batch after review.', {
        0: proposals.length,
      })
    )
  }
  async function anotherCarton() {
    if (work || readOnly()) return
    const next = fresh()
    next.mark = groupReference(selectedMark || scope.mark || scope.groups[0])
    let dimensions
    try {
      dimensions = Object.fromEntries(
        ['len', 'wid', 'ht'].map((key) => [
          key,
          cartonDecimal(inputs[key].value, { positive: true }),
        ])
      )
    } catch {}
    if (dimensions && Object.values(dimensions).every(Boolean))
      Object.assign(next, dimensions)
    preserve()
    drafts.set(next.id, next)
    touched.add(next.id)
    await select(next.id)
    bindText(
      status,
      m(
        'Set this carton’s contents and weight. Previous quantities and confirmations were not copied.'
      )
    )
  }
  async function requestClose({ discardDraft = false } = {}) {
    if (closing) return
    closing = true
    try {
      if (work) await work
      if (!discardDraft) {
        if (dirty() && !membershipDirty()) await flush()
        preserve()
        if (dirty() || otherDraftsDirty()) {
          dismissal.hidden = false
          keep.focus()
          closing = false
          return
        }
      }
    } catch {
      dismissal.hidden = false
      keep.focus()
      closing = false
      return
    }
    clearTimeout(timer)
    dialog.close()
  }
  editor.addEventListener(
    'invalid',
    (event) => event.target.setAttribute('aria-invalid', 'true'),
    true
  )
  editor.addEventListener('submit', (event) => {
    event.preventDefault()
    void saveCurrent({ explicit: true }).catch(() => {})
  })
  editor.addEventListener('focusout', () => {
    try {
      if (!membershipDirty()) void flush().catch(() => {})
    } catch {}
  })
  editor.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.isComposing) event.preventDefault()
  })
  remove.addEventListener('click', async () => {
    if (work || !onRemove) return
    const batch = savedFor(selected)
    if (!batch) return
    // One explicit inline confirmation, not an accidental icon deletion.
    if (remove.dataset.confirm !== batch.id) {
      remove.dataset.confirm = batch.id
      bindText(remove, m('Remove this batch?'))
      bindText(
        status,
        m('Products stay in packing. Only this carton allocation is removed.')
      )
      return
    }
    setBusy(true)
    work = (async () =>
      onRemove(clone(batch), { expectedRevision: batch.revision }))()
    try {
      const removed = await work,
        index = all.findIndex((entry) => entry.id === batch.id)
      all[index] = {
        ...batch,
        ...removed,
        deletedAt: removed?.deletedAt || new Date().toISOString(),
      }
      drafts.delete(batch.id)
      changed = true
      selected = undefined
      inputs = undefined
      const next = all.find(relevant) || fresh()
      if (!savedFor(next.id)) drafts.set(next.id, next)
      work = undefined
      await select(next.id)
      bindText(
        status,
        m('Batch removed. Product quantities are available again.')
      )
      if (onChange) await onChange(removed || all[index])
    } catch (error) {
      showError(error)
    } finally {
      work = undefined
      setBusy(false)
    }
  })
  for (const button of [close, done])
    button.addEventListener('click', () => void requestClose())
  keep.addEventListener('click', () => {
    dismissal.hidden = true
  })
  discard.addEventListener(
    'click',
    () => void requestClose({ discardDraft: true })
  )
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault()
    void requestClose()
  })
  dialog.addEventListener(
    'close',
    () => {
      clearTimeout(timer)
      viewVersion++
      dialog.remove()
      resolveClosed({ changed, batches: clone(all) })
    },
    { once: true }
  )
  const initial =
    all.find(relevant) ||
    fresh(
      cartonBatchRemaining(scope, all)
        .filter(
          (product) =>
            BigInt(product.remaining) > 0n &&
            initialGroupIds.has(groupKey(product))
        )
        .map(({ orderId, entryId, remaining }) => ({
          orderId,
          entryId,
          quantity: remaining,
        }))
    )
  if (!savedFor(initial.id)) drafts.set(initial.id, initial)
  void select(initial.id)
  dialog.showModal()
  close.focus()
  promise.dialog = dialog
  promise.flush = flush
  promise.dirty = dirty
  return promise
}
