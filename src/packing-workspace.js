import {
  createPreparation,
  activeGroups,
  barcodeValue,
} from './packing-model.js'
import { DEFAULT_LABEL_SETTINGS, renderLabel } from './labels.js'
import { mountLabelEditor } from './label-editor.js'
import { createPreparationHistory } from './preparation-history.js'
import { acknowledgePreparation } from './preparation-save.js'
import { createPreparationMedia, preparationHelp } from './preparation-media.js'
import { createRowSelection } from './row-selection.js'
import { copyExcelImage } from './excel-image-copy.js'
import { decorateIcon } from './icons.js'
import { element as el, confirmScope, copied, yieldUI } from './ui.js'
import {
  preparationColumns,
  preparationTable,
  writeTable,
  labelClipboard,
} from './preparation-clipboard.js'

const $ = (id) => document.getElementById(id)
function unusedSuffix(used, sizeSuffix = '') {
  for (let number = 1; ; number++) {
    let n = number,
      value = ''
    while (n) {
      n--
      value = String.fromCharCode(65 + (n % 26)) + value
      n = Math.floor(n / 26)
    }
    if (!used.has(value + sizeSuffix)) return value
  }
}
function field(title, value, change, type = 'text') {
  const label = el('label', title),
    input = el('input')
  input.type = type
  input.id = `packing-${crypto.randomUUID()}`
  label.htmlFor = input.id
  input.value = value ?? ''
  input.addEventListener('input', () => change(input.value))
  label.append(input)
  return label
}
function inlineField(
  title,
  value,
  change,
  placeholder = '',
  multiline = false
) {
  const label = field(title, value, change)
  label.className = 'preparation-inline-field'
  let input = label.querySelector('input')
  if (multiline) {
    const textarea = el('textarea')
    textarea.id = input.id
    textarea.value = input.value
    textarea.rows = 2
    textarea.addEventListener('input', () => change(textarea.value))
    input.replaceWith(textarea)
    input = textarea
  }
  input.placeholder = placeholder
  return label
}
function button(text, handler, className) {
  const result = el('button', text, className)
  const buttonIcons = {
    Undo: 'undo',
    Redo: 'redo',
    'Apply to order': 'check',
    'Merge products': 'packing',
    'Copy Excel image': 'table',
    'Copy barcode images': 'barcode',
    'Copy carton marks': 'carton',
    'Copy code': 'copy',
    Barcode: 'barcode',
    'Carton mark': 'carton',
    Name: 'edit',
    Prepare: 'packing',
    'Share one barcode': 'barcode',
    'Give rows separate barcodes': 'barcode',
    'Move to new product': 'packing',
    'Save settings': 'check',
    Remove: 'trash',
  }
  if (buttonIcons[text]) decorateIcon(result, buttonIcons[text])
  result.addEventListener('click', async () => {
    try {
      await handler(result)
    } catch (error) {
      showError(error.message)
    }
  })
  return result
}
function showError(message) {
  const target = $('label-dialog').open
    ? $('label-content')
    : $('preparation-dialog').open
      ? $('preparation-content')
      : $('settings-dialog').open
        ? $('settings-content')
        : $('feedback')
  let error = target.querySelector('p.packing-error')
  if (!error) {
    error = el('p', undefined, 'packing-error')
    error.setAttribute('role', 'alert')
    target.append(error)
  }
  error.textContent = message
}
function dialog(target) {
  if (!target.open) target.showModal()
}
const blobData = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })

export async function startPackingWorkspace({
  repository,
  getRecords,
  getRows,
  headers,
  changed,
  feedback,
  loadImage,
}) {
  const monthInput = $('packing-month')
  if (!monthInput.value) {
    const today = new Date()
    monthInput.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  }
  let preparations = new Map(),
    membership = new Map(),
    suggestions = new Map(),
    preferences,
    editor,
    drafts = [],
    current = 0,
    groupPage = 0
  const channel = globalThis.BroadcastChannel
    ? new BroadcastChannel('1688-preparation')
    : null
  const variantPages = new Map()
  const selectionStates = new Map()
  let activeSelection,
    copyScope,
    preparationImageAbort,
    selectedOrderTabId,
    selectedOrderOpening
  function updatePreparationCopyScope() {
    if (!copyScope || !drafts[current]) return
    const count = preparationCopyRows(drafts[current]).length
    const state = selectionStates.get(drafts[current].orderId)
    const selected =
      state?.groups.size ||
      [...(state?.variants.values() || [])].some((entry) => entry.selected.size)
    copyScope.textContent = `${count} ${selected ? 'selected' : 'current-order'} rows`
  }
  function detachPreparationSelection() {
    if (!activeSelection) return
    activeSelection.cards.clear()
    activeSelection.controller.detach()
    for (const variants of activeSelection.variants.values())
      variants.controller.detach()
    activeSelection = null
  }
  function preparationSelection(draft) {
    let state = selectionStates.get(draft.orderId)
    if (!state) {
      state = {
        groups: new Set(),
        variants: new Map(),
        cards: new Map(),
        keys: [],
      }
      state.controller = createRowSelection({
        selected: state.groups,
        getKeys: () => state.keys,
        onChange: () => {
          for (const [id, card] of state.cards)
            card.classList.toggle('is-selected', state.groups.has(id))
          updatePreparationCopyScope()
        },
      })
      selectionStates.set(draft.orderId, state)
    }
    state.keys = draft.groups.map((group) => group.id)
    const groupIds = new Set(state.keys)
    for (const id of state.groups)
      if (!groupIds.has(id)) state.groups.delete(id)
    for (const id of state.variants.keys())
      if (!groupIds.has(id)) state.variants.delete(id)
    for (const group of draft.groups) {
      let variants = state.variants.get(group.id)
      if (!variants) {
        variants = { selected: new Set(), keys: [] }
        variants.controller = createRowSelection({
          selected: variants.selected,
          getKeys: () => variants.keys,
          onChange: updatePreparationCopyScope,
        })
        state.variants.set(group.id, variants)
      }
      variants.keys = group.variants.map((variant) => variant.id)
      const ids = new Set(variants.keys)
      for (const id of variants.selected)
        if (!ids.has(id)) variants.selected.delete(id)
    }
    return state
  }
  const history = createPreparationHistory(),
    checkpoints = new Map()
  let undoButton,
    redoButton,
    preparationBusy = false
  let saveTimer, saveWork, saveStatus, reloadPreparationButton
  const pendingSaves = new Set(),
    saveErrors = new Map(),
    codeFields = new Map()
  function updateSaveStatus() {
    if (!saveStatus) return
    const id = drafts[current]?.orderId
    const error = saveErrors.get(id)
    saveStatus.textContent = error
      ? `Not saved — ${error} Your edits are still here.`
      : pendingSaves.has(id) || saveWork
        ? 'Saving…'
        : preparations.has(id)
          ? 'Saved automatically'
          : 'Changes save automatically'
    saveStatus.classList.toggle('packing-error', Boolean(error))
    if (reloadPreparationButton) {
      reloadPreparationButton.hidden = !error
      reloadPreparationButton.textContent = preparations.has(id)
        ? 'Reload saved version'
        : 'Discard pending edits'
    }
  }
  function scheduleSave(draft = drafts[current]) {
    if (!draft) return
    pendingSaves.add(draft.orderId)
    saveErrors.delete(draft.orderId)
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (preparationBusy) scheduleSave(draft)
      else void flushSaves().catch(() => {}) // The inline status retains the error.
    }, 800)
    updateSaveStatus()
  }
  async function flushSaves() {
    clearTimeout(saveTimer)
    while (saveWork) await saveWork
    if (!pendingSaves.size) return
    saveWork = (async () => {
      // Let saveWork be assigned before the first write starts.
      await Promise.resolve()
      const failed = new Set()
      let firstError
      while (pendingSaves.size) {
        const id = [...pendingSaves].find((entry) => !failed.has(entry))
        if (!id) break
        pendingSaves.delete(id)
        const index = drafts.findIndex((draft) => draft.orderId === id)
        if (index < 0) continue
        try {
          await saveDraft(index)
          saveErrors.delete(id)
        } catch (error) {
          pendingSaves.add(id)
          saveErrors.set(id, error.message)
          failed.add(id)
          firstError ||= error
        }
      }
      if (firstError) throw firstError
    })()
    updateSaveStatus()
    try {
      await saveWork
    } finally {
      saveWork = null
      updateSaveStatus()
    }
  }
  async function preparationAction(action) {
    if (preparationBusy) return
    preparationBusy = true
    $('preparation-content').disabled = true
    let focusId
    try {
      if (saveWork) await saveWork
      return await action()
    } catch (error) {
      focusId = error.focusId
      throw error
    } finally {
      preparationBusy = false
      $('preparation-content').disabled = false
      if (focusId && $('preparation-dialog').open) $(focusId)?.focus()
    }
  }
  function prepButton(text, action, className) {
    return button(text, () => preparationAction(action), className)
  }
  const settings = () => ({
    ...DEFAULT_LABEL_SETTINGS,
    ...preferences.settings,
    barcode: {
      ...DEFAULT_LABEL_SETTINGS.barcode,
      ...preferences.settings.barcode,
    },
    mark: { ...DEFAULT_LABEL_SETTINGS.mark, ...preferences.settings.mark },
  })
  const logoUrl = () =>
    preferences.logoDataUrl ||
    new URL('assets/casa-elida.png', location.href).href
  const media = createPreparationMedia({
    container: $('preparation-dialog'),
    loadImage,
    settings,
    logoUrl,
  })
  function updateHistoryButtons() {
    const state = history.state()
    if (undoButton) undoButton.disabled = !state.canUndo
    if (redoButton) redoButton.disabled = !state.canRedo
  }
  function checkpoint(mergeKey = null) {
    const draft = drafts[current]
    if (!draft) return
    const next = JSON.stringify(draft),
      before = checkpoints.get(draft.orderId)
    if (before !== undefined)
      if (history.record(draft.orderId, before, next, mergeKey))
        scheduleSave(draft)
    checkpoints.set(draft.orderId, next)
    updateHistoryButtons()
  }
  function travel(direction) {
    const result = history[direction]()
    if (!result) return
    current = drafts.findIndex((draft) => draft.orderId === result.orderId)
    drafts[current] = result.value
    checkpoints.set(result.orderId, JSON.stringify(result.value))
    scheduleSave(result.value)
    groupPage = 0
    renderPreparation()
  }
  const editKeys = new WeakMap()
  $('preparation-content').addEventListener('input', (event) => {
    if (!editKeys.has(event.target))
      editKeys.set(event.target, crypto.randomUUID())
    checkpoint(editKeys.get(event.target))
    media.refresh()
  })
  $('preparation-content').addEventListener('focusout', () =>
    history.breakGroup()
  )
  $('preparation-dialog').addEventListener('close', () => {
    preparationImageAbort?.abort()
    media.reset()
    detachPreparationSelection()
  })
  $('preparation-dialog').addEventListener('cancel', (event) => {
    if (!pendingSaves.size && !saveWork && !preparationBusy) return
    event.preventDefault()
    if (preparationBusy) return
    void preparationAction(async () => {
      await flushSaves()
      $('preparation-dialog').close()
    }).catch(() => {
      const failed = drafts.findIndex((draft) => saveErrors.has(draft.orderId))
      if (failed >= 0 && failed !== current) {
        current = failed
        renderPreparation()
      }
      updateSaveStatus()
    })
  })
  // Dialog forms otherwise bypass cancel and could destroy a pending label edit.
  for (const id of ['preparation-dialog', 'label-dialog']) {
    const modal = $(id)
    modal.querySelector('form').addEventListener('submit', (event) => {
      event.preventDefault()
      if (typeof modal.requestClose === 'function') modal.requestClose()
      else if (modal.dispatchEvent(new Event('cancel', { cancelable: true })))
        modal.close()
    })
  }
  addEventListener('beforeunload', (event) => {
    if (!pendingSaves.size && !saveWork) return
    event.preventDefault()
    event.returnValue = ''
  })
  async function reload() {
    preparations = new Map(
      (await repository.listPreparations()).map((item) => [item.orderId, item])
    )
    preferences = await repository.getPackingPreferences()
    suggestions = new Map()
    for (const record of getRecords())
      for (const group of record.namingSuggestions?.groups || [])
        for (const entryId of group.entryIds)
          suggestions.set(`${record.snapshot.orderId}/${entryId}`, group)
    membership = new Map()
    for (const prep of preparations.values())
      for (const group of prep.groups)
        for (const variant of group.variants)
          for (const entryId of variant.entryIds)
            membership.set(`${prep.orderId}/${entryId}`, {
              prep,
              group,
              variant,
            })
  }
  await reload()
  channel?.addEventListener('message', async ({ data }) => {
    try {
      if (data === 'preferences') await changed({ reload: true })
      else {
        await reload()
        changed()
      }
    } catch (error) {
      feedback(error.message, true)
    }
  })
  addEventListener(
    'pagehide',
    () => {
      editor?.destroy()
      media.destroy()
      channel?.close()
    },
    { once: true }
  )
  function selectedRecords() {
    const ids = new Set(getRows().map((row) => row.orderId))
    return getRecords().filter((record) => ids.has(record.snapshot.orderId))
  }
  async function saved(draft) {
    const result = await repository.savePreparation(draft, {
      expectedRevision: draft.revision,
    })
    const previous = preparations.get(result.orderId)
    for (const group of previous?.groups || [])
      for (const variant of group.variants)
        for (const entryId of variant.entryIds)
          membership.delete(`${result.orderId}/${entryId}`)
    preparations.set(result.orderId, result)
    for (const group of result.groups)
      for (const variant of group.variants)
        for (const entryId of variant.entryIds)
          membership.set(`${result.orderId}/${entryId}`, {
            prep: result,
            group,
            variant,
          })
    changed()
    channel?.postMessage('changed')
    return result
  }
  function outputModel(prep, group, variant, kind, editing = false) {
    const record = getRecords().find(
      (record) => record.snapshot.orderId === prep.orderId
    )
    if (
      !record ||
      !activeGroups(prep, record.snapshot).some(
        (item) =>
          item.id === group.id &&
          (kind === 'mark' || item.variants.some((v) => v.id === variant.id))
      )
    )
      throw new Error('This product is no longer present in the current order.')
    return {
      kind,
      code:
        kind === 'mark'
          ? group.baseCode
          : barcodeValue(
              group,
              editing ? { ...variant, needsSizeMapping: false } : variant
            ),
      spanishName: variant?.spanishName || group.spanishName,
      category: group.category,
      ...(kind === 'barcode'
        ? {
            baseCode: group.baseCode,
            variantSuffix: variant.variantSuffix,
            sizeSuffix: variant.sizeSuffix,
            needsSizeMapping: variant.needsSizeMapping,
          }
        : {}),
    }
  }
  async function openLabel(orderId, groupId, variantId, kind) {
    let prep = structuredClone(preparations.get(orderId))
    if (!prep) throw new Error('Save the preparation first.')
    const group = prep.groups.find((group) => group.id === groupId),
      variant = group.variants.find((variant) => variant.id === variantId)
    const model = outputModel(prep, group, variant, kind, true)
    editor?.destroy()
    const host = $('label-content')
    host.replaceChildren(
      el('h2', kind === 'mark' ? 'Carton mark' : 'Barcode label')
    )
    const mount = el('div')
    host.append(mount)
    editor = mountLabelEditor(mount, {
      model,
      settings: settings(),
      logoUrl: logoUrl(),
      onCommit: async (next) => {
        const draft = structuredClone(prep)
        const group = draft.groups.find((item) => item.id === groupId)
        const variant = group.variants.find((item) => item.id === variantId)
        if (kind === 'mark') {
          group.baseCode = next.code
          group.category = next.category
        } else {
          if (
            next.baseCode !== group.baseCode ||
            next.code !== group.baseCode + next.variantSuffix + next.sizeSuffix
          )
            throw new Error(
              'Edit the product code on its carton mark to change the shared base. The barcode must retain that base.'
            )
          variant.variantSuffix = next.variantSuffix
          variant.sizeSuffix = next.sizeSuffix
          variant.needsSizeMapping = next.needsSizeMapping
          variant.spanishName = next.spanishName.toUpperCase()
        }
        prep = await saved(draft)
        const savedGroup = prep.groups.find((item) => item.id === groupId)
        return outputModel(
          prep,
          savedGroup,
          savedGroup.variants.find((item) => item.id === variantId),
          kind,
          true
        )
      },
      onCopy: async (result) => labelClipboard([result]),
    })
    dialog($('label-dialog'))
  }
  $('label-dialog').addEventListener('close', () => {
    editor?.destroy()
    editor = null
    if ($('preparation-dialog').open && drafts[current]) {
      const latest = preparations.get(drafts[current].orderId)
      if (latest) {
        drafts[current] = structuredClone(latest)
        checkpoints.set(latest.orderId, JSON.stringify(latest))
        history.clear(latest.orderId)
      }
      renderPreparation()
    }
  })

  function extendPreparation(prep, snapshot) {
    const result = structuredClone(prep),
      known = new Set(
        result.groups.flatMap((g) => g.variants.flatMap((v) => v.entryIds))
      )
    const missing = snapshot.items.filter((item) => !known.has(item.entryId))
    if (missing.length)
      result.groups.push(
        ...createPreparation(
          { ...snapshot, items: missing },
          prep.month,
          preferences.vocabulary
        ).groups
      )
    return result
  }
  async function openPreparation(orderId) {
    if (preparationBusy)
      throw new Error(
        'Wait for preparation to finish saving before reopening it.'
      )
    await flushSaves()
    const records = orderId
      ? getRecords().filter((record) => record.snapshot.orderId === orderId)
      : selectedRecords()
    if (!records.length)
      throw new Error('Select orders or products to prepare.')
    const month = $('packing-month').value
    if (
      !month &&
      records.some((record) => !preparations.has(record.snapshot.orderId))
    ) {
      $('packing-month').focus()
      throw new Error('Choose the packing month before preparing new orders.')
    }
    drafts = records.map(({ snapshot }) =>
      preparations.has(snapshot.orderId)
        ? extendPreparation(preparations.get(snapshot.orderId), snapshot)
        : createPreparation(snapshot, month, preferences.vocabulary)
    )
    const orderIds = new Set(drafts.map((draft) => draft.orderId))
    for (const id of selectionStates.keys())
      if (!orderIds.has(id)) selectionStates.delete(id)
    current = 0
    groupPage = 0
    history.clear()
    checkpoints.clear()
    renderPreparation()
    dialog($('preparation-dialog'))
    if (
      drafts[current].sellerId &&
      JSON.stringify(drafts[current]) !==
        JSON.stringify(preparations.get(drafts[current].orderId))
    )
      scheduleSave()
  }
  async function saveDraft(index) {
    if (!drafts[index].sellerId.trim()) {
      throw Object.assign(
        new Error('Enter the seller member login to assign label codes.'),
        { focusId: 'preparation-seller' }
      )
    }
    const draft = drafts[index]
    if (
      JSON.stringify(draft) === JSON.stringify(preparations.get(draft.orderId))
    ) {
      history.clear(draft.orderId)
      updateHistoryButtons()
      return draft
    }
    const previous = preparations.get(draft.orderId)
    if (
      draft.groups.some(
        (group) =>
          !group.baseCode &&
          previous?.groups.some((old) => old.id === group.id && old.baseCode)
      )
    )
      throw new Error(
        'Enter a complete product code. Clearing an assigned code cannot create a new one.'
      )
    const submitted = structuredClone(draft)
    const result = await saved(submitted)
    acknowledgePreparation(draft, submitted, result)
    const next = JSON.stringify(draft)
    history.clear(draft.orderId)
    history.record(draft.orderId, JSON.stringify(result), next)
    checkpoints.set(draft.orderId, next)
    if (index === current) {
      for (const group of draft.groups) {
        const input = codeFields.get(group.id)
        if (input && input !== document.activeElement)
          input.value = group.baseCode
        input?.dispatchEvent(new Event('change'))
      }
      updateHistoryButtons()
      media.refresh()
    }
    return draft
  }
  function renderPreparation() {
    preparationImageAbort?.abort()
    checkpoint()
    media.reset()
    codeFields.clear()
    detachPreparationSelection()
    const host = $('preparation-content'),
      draft = drafts[current]
    const selection = preparationSelection(draft)
    activeSelection = selection
    const header = el('header', undefined, 'preparation-header')
    header.append(el('h2', 'Prepare packing list'))
    host.replaceChildren(header)
    const heading = el('div', undefined, 'preparation-heading'),
      select = el('select')
    select.setAttribute('aria-label', 'Preparation order')
    function orderChoice(prep) {
      const source = getRecords().find(
        (record) => record.snapshot.orderId === prep.orderId
      )?.snapshot
      const names = [
        ...new Set(
          prep.groups.map((group) => group.spanishName).filter(Boolean)
        ),
      ]
      const categories = [
        ...new Set(prep.groups.map((group) => group.category).filter(Boolean)),
      ]
      return [
        source?.sellerName || prep.sellerId || 'Seller unavailable',
        names.join(', '),
        categories.join('、'),
        prep.orderId,
      ]
        .filter(Boolean)
        .join(' · ')
    }
    const updateOrderChoices = () => {
      drafts.forEach((prep, index) => {
        select.options[index].textContent = orderChoice(prep)
      })
    }
    drafts.forEach((prep, index) =>
      select.append(new Option(orderChoice(prep), index))
    )
    select.value = String(current)
    select.onchange = () => {
      checkpoint()
      history.breakGroup()
      current = Number(select.value)
      groupPage = 0
      renderPreparation()
      if (
        drafts[current].sellerId &&
        !pendingSaves.has(drafts[current].orderId) &&
        JSON.stringify(drafts[current]) !==
          JSON.stringify(preparations.get(drafts[current].orderId))
      )
        scheduleSave()
    }
    const currentSource = getRecords().find(
      (record) => record.snapshot.orderId === draft.orderId
    )?.snapshot
    const openOrder = el(
      'a',
      'Open selected order',
      'button open-selected-order'
    )
    openOrder.href = currentSource.sourceUrl
    openOrder.target = '_blank'
    openOrder.rel = 'noopener'
    decorateIcon(openOrder, 'external')
    openOrder.addEventListener('click', async (event) => {
      if (!globalThis.chrome?.tabs) return
      event.preventDefault()
      if (selectedOrderOpening) return
      selectedOrderOpening = true
      openOrder.setAttribute('aria-disabled', 'true')
      try {
        if (selectedOrderTabId) {
          try {
            await chrome.tabs.get(selectedOrderTabId)
          } catch {
            selectedOrderTabId = null
          }
        }
        if (selectedOrderTabId)
          await chrome.tabs.update(selectedOrderTabId, {
            url: currentSource.sourceUrl,
            active: true,
          })
        else
          selectedOrderTabId = (
            await chrome.tabs.create({
              url: currentSource.sourceUrl,
              active: true,
            })
          ).id
      } catch (error) {
        showError(error.message)
      } finally {
        selectedOrderOpening = false
        openOrder.removeAttribute('aria-disabled')
      }
    })
    heading.append(select, openOrder)
    const orderMeta = el('div', undefined, 'preparation-order-meta')
    orderMeta.append(
      el(
        'span',
        currentSource?.sellerName || draft.sellerId || 'Seller unavailable',
        'preparation-seller-name'
      ),
      el('code', draft.orderId, 'preparation-order-number'),
      el(
        'span',
        `Packing ${new Date(`${draft.month}-01T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })} · ${draft.groups.length} product groups`,
        'packing-help'
      )
    )
    host.append(heading, orderMeta)
    const source = getRecords().find(
      ({ snapshot }) => snapshot.orderId === draft.orderId
    )?.snapshot
    if (source?.sellerUnavailable || !draft.sellerId) {
      const help = el(
        'p',
        'Seller unavailable on the source page. Enter the seller’s 1688 member login to assign label codes. Reuse the same login for this seller’s other orders.',
        'packing-help'
      )
      help.id = 'preparation-seller-help'
      const seller = field(
        'Seller member login (required)',
        draft.sellerId,
        (value) => {
          draft.sellerId = value
        }
      )
      const input = seller.querySelector('input')
      input.id = 'preparation-seller'
      seller.htmlFor = input.id
      input.required = true
      input.autocomplete = 'off'
      input.autocapitalize = 'off'
      input.setAttribute('autocorrect', 'off')
      input.spellcheck = false
      input.setAttribute('aria-describedby', help.id)
      host.append(help, seller)
    }
    const categories = new Set(draft.groups.map((group) => group.category))
    const names = new Set(draft.groups.map((group) => group.spanishName))
    let categoryValue = categories.size === 1 ? [...categories][0] : ''
    let spanishValue = names.size === 1 ? [...names][0] : ''
    let categoryChanged = false,
      spanishChanged = false
    const orderTools = el('section', undefined, 'order-tools')
    orderTools.setAttribute('aria-label', 'Order tools')
    const orderSpanish = field('Spanish', spanishValue, (value) => {
      spanishValue = value.toUpperCase()
      spanishChanged = true
    })
    orderSpanish.querySelector('input').placeholder =
      names.size > 1 ? 'Mixed names' : 'Name all products'
    const orderCategory = field('Chinese', categoryValue, (value) => {
      categoryValue = value
      categoryChanged = true
    })
    orderCategory.querySelector('input').placeholder =
      categories.size > 1 ? 'Mixed categories' : 'Add a category'
    const applyCategory = prepButton('Apply to order', () => {
      for (const group of draft.groups) {
        if (categoryChanged) group.category = categoryValue
        if (spanishChanged) {
          group.spanishName = spanishValue
          for (const variant of group.variants) variant.spanishName = ''
        }
      }
      renderPreparation()
    })
    orderSpanish
      .querySelector('input')
      .setAttribute('aria-label', 'Spanish category for order')
    orderCategory
      .querySelector('input')
      .setAttribute('aria-label', 'Chinese category for order')
    orderTools.append(
      el('span', 'For this order', 'order-category-label'),
      preparationHelp(
        orderSpanish,
        'Use one Spanish label name for every product in this order.'
      ),
      preparationHelp(
        orderCategory,
        'One Chinese name for all carton marks in this order. For example, 玻璃 means glass.'
      ),
      preparationHelp(
        applyCategory,
        'Apply the names you changed to all products in this order. Other fields stay as they are.'
      )
    )
    const actions = el('div', undefined, 'dialog-actions preparation-actions')
    undoButton = prepButton('Undo', () => travel('undo'))
    redoButton = prepButton('Redo', () => travel('redo'))
    saveStatus = el('span', '', 'preparation-save-status')
    saveStatus.setAttribute('role', 'status')
    reloadPreparationButton = prepButton('Reload saved version', async () => {
      const hasSavedVersion = preparations.has(draft.orderId)
      if (
        !(await confirmScope({
          action: hasSavedVersion ? 'Reload' : 'Discard',
          count: 1,
          unit: 'preparation',
          detail:
            'This replaces unsaved edits for this order with the latest saved version, or the original product suggestions if none exists. Cancel keeps your edits here.',
        }))
      )
        return
      await reload()
      const latest =
        preparations.get(draft.orderId) ||
        createPreparation(source, draft.month, preferences.vocabulary)
      drafts[current] = structuredClone(latest)
      pendingSaves.delete(draft.orderId)
      saveErrors.delete(draft.orderId)
      history.clear(draft.orderId)
      checkpoints.set(draft.orderId, JSON.stringify(latest))
      renderPreparation()
    })
    actions.append(
      preparationHelp(
        undoButton,
        'Undo edits that have not yet been saved. Autosave clears this history.'
      ),
      preparationHelp(redoButton, 'Restore an undone edit before autosave.'),
      saveStatus,
      reloadPreparationButton
    )
    updateSaveStatus()
    orderTools.append(
      preparationHelp(
        prepButton('Merge products', async () => {
          const ids = draft.groups
            .filter((group) => selection.groups.has(group.id))
            .map((group) => group.id)
          if (ids.length < 2)
            throw new Error('Select at least two product groups to merge.')
          const target = draft.groups.find((g) => g.id === ids[0]),
            used = new Set(
              target.variants.map((v) => v.variantSuffix + v.sizeSuffix)
            )
          if (target.baseCode)
            for (const code of await repository.getReservedBarcodes(
              target.baseCode,
              { accountId: draft.accountId }
            ))
              used.add(code.slice(target.baseCode.length))
          for (const group of draft.groups.filter(
            (g) => ids.includes(g.id) && g !== target
          ))
            for (const variant of group.variants) {
              if (used.has(variant.variantSuffix + variant.sizeSuffix))
                variant.variantSuffix = unusedSuffix(used, variant.sizeSuffix)
              used.add(variant.variantSuffix + variant.sizeSuffix)
              target.variants.push(variant)
            }
          draft.groups = draft.groups.filter(
            (g) => !ids.includes(g.id) || g === target
          )
          renderPreparation()
        }),
        'Give selected products one product code and carton mark. Variants keep separate barcodes.'
      )
    )
    header.append(actions)
    host.append(orderTools)
    updateHistoryButtons()
    groupPage = Math.min(
      groupPage,
      Math.max(0, Math.ceil(draft.groups.length / 20) - 1)
    )
    const pageGroups = draft.groups.slice(groupPage * 20, (groupPage + 1) * 20)
    for (const group of pageGroups) {
      const card = el('section', undefined, 'preparation-group'),
        title = el('h3'),
        selectGroup = el('button', `Group ${draft.groups.indexOf(group) + 1}`)
      selectGroup.type = 'button'
      selectGroup.className = 'group-select'
      selectGroup.setAttribute(
        'aria-label',
        `Select group ${draft.groups.indexOf(group) + 1}: ${group.title}`
      )
      selection.controller.bind(selectGroup, group.id, {
        attribute: 'aria-pressed',
      })
      selection.cards.set(group.id, card)
      card.classList.toggle('is-selected', selection.groups.has(group.id))
      const isCardTarget = (event) =>
        !event.target.closest(
          'button, a, input, select, textarea, label, [contenteditable]:not([contenteditable="false"]), .variants'
        )
      card.addEventListener('pointerdown', (event) => {
        if (event.shiftKey && isCardTarget(event)) event.preventDefault()
      })
      card.addEventListener('click', (event) => {
        if (!isCardTarget(event)) return
        selectGroup.focus({ preventScroll: true })
        selection.controller.select(group.id, event)
      })
      const productInput = el('input')
      productInput.className = 'group-code-editor'
      productInput.setAttribute('aria-label', 'Product code')
      productInput.value = group.baseCode
      productInput.placeholder = 'Assigning code…'
      productInput.autocomplete = 'off'
      productInput.setAttribute('autocorrect', 'off')
      productInput.spellcheck = false
      productInput.size = 12
      productInput.addEventListener('input', () => {
        group.baseCode = productInput.value.toUpperCase()
      })
      codeFields.set(group.id, productInput)
      title.append(
        selectGroup,
        preparationHelp(
          productInput,
          'Product code shared by all variants. Printed on its carton mark.'
        )
      )
      const groupName = el('input')
      groupName.className = 'group-name-editor'
      groupName.setAttribute('aria-label', 'Spanish short name')
      groupName.placeholder = 'Name product'
      groupName.value = group.spanishName
      groupName.maxLength = 80
      groupName.size = Math.max(12, Math.min(32, group.spanishName.length))
      groupName.addEventListener('input', () => {
        group.spanishName = groupName.value.toUpperCase()
        updateOrderChoices()
      })
      preparationHelp(
        selectGroup,
        'Click to select this group. Click again to deselect; Shift-click selects a range.'
      )
      preparationHelp(
        title,
        'Click this header to select the group. Click again to deselect; Shift-click selects a range.'
      )
      const originalTitle = el('div', undefined, 'original-product-name')
      originalTitle.append(
        el('span', 'Original product name'),
        el('p', group.title)
      )
      const summary = el('div', undefined, 'product-summary')
      summary.append(title)
      const fields = el('div', undefined, 'group-fields')
      fields.append(
        preparationHelp(
          groupName,
          'Edit the Spanish name printed on this product’s barcode labels.'
        ),
        preparationHelp(
          inlineField(
            'Chinese category',
            group.category,
            (v) => {
              group.category = v
              updateOrderChoices()
            },
            'Add a category'
          ),
          'Printed on the carton mark, for example 玻璃 for glass.'
        )
      )
      const overview = el('div', undefined, 'product-overview')
      const carton = el('div', undefined, 'carton-preview')
      carton.append(
        el('strong', 'Carton mark'),
        media.label(
          () => outputModel(draft, group, null, 'mark'),
          () =>
            preparationAction(async () => {
              await saveDraft(current)
              await openLabel(draft.orderId, group.id, null, 'mark')
            }),
          'mark'
        )
      )
      summary.append(fields, originalTitle)
      overview.append(summary, carton)
      card.append(overview)
      const scroll = el('div', undefined, 'variant-scroll'),
        table = el('table', undefined, 'variants'),
        head = el('tr')
      table.setAttribute('role', 'grid')
      table.setAttribute(
        'aria-label',
        `Variants for ${group.spanishName || group.title}`
      )
      table.setAttribute('aria-multiselectable', 'true')
      for (const label of ['#', 'Photo', 'Product variant', 'Barcode']) {
        const column = el('th', label)
        column.scope = 'col'
        head.append(column)
      }
      const variantSelection = selection.variants.get(group.id)
      const thead = el('thead')
      thead.append(head)
      table.append(thead)
      const body = el('tbody')
      const snapshot = getRecords().find(
          (record) => record.snapshot.orderId === draft.orderId
        ).snapshot,
        live = new Set(snapshot.items.map((item) => item.entryId))
      const sourceItems = new Map(
        snapshot.items.map((item) => [item.entryId, item])
      )
      const variantPage = Math.min(
        variantPages.get(group.id) || 0,
        Math.max(0, Math.ceil(group.variants.length / 50) - 1)
      )
      for (const variant of group.variants.slice(
        variantPage * 50,
        (variantPage + 1) * 50
      )) {
        const row = el('tr')
        variantSelection.controller.bind(row, variant.id)
        const td = el(
          'td',
          String(group.variants.indexOf(variant) + 1),
          'variant-index'
        )
        if (variant.entryIds.length > 1)
          td.append(el('small', `${variant.entryIds.length} source rows`))
        row.append(td)
        const photoCell = el('td', undefined, 'variant-photos')
        const items = variant.entryIds
          .map((id) => sourceItems.get(id))
          .filter(Boolean)
        const uniquePhotos = [
          ...new Map(
            items.map((item) => [item.thumbnail || item.entryId, item])
          ).values(),
        ]
        if (uniquePhotos.length) photoCell.append(media.photo(uniquePhotos[0]))
        if (uniquePhotos.length > 1) {
          const otherPhotos = el('div', undefined, 'variant-gallery'),
            gallery = el('div', undefined, 'variant-gallery-grid'),
            navigation = el('div', undefined, 'gallery-navigation'),
            pageLabel = el('span')
          let photoPage = 0
          const pages = Math.ceil((uniquePhotos.length - 1) / 4)
          function showPhotos() {
            media.forget(gallery)
            gallery.replaceChildren(
              ...uniquePhotos
                .slice(1 + photoPage * 4, 5 + photoPage * 4)
                .map((item) => media.photo(item))
            )
            previous.disabled = photoPage === 0
            next.disabled = photoPage + 1 === pages
            pageLabel.textContent = `${photoPage + 1} / ${pages}`
          }
          const previous = prepButton('Previous photos', () => {
              photoPage--
              showPhotos()
            }),
            next = prepButton('Next photos', () => {
              photoPage++
              showPhotos()
            })
          previous.textContent = '‹'
          previous.setAttribute('aria-label', 'Previous photos')
          next.textContent = '›'
          next.setAttribute('aria-label', 'Next photos')
          if (pages > 1) navigation.append(previous, pageLabel, next)
          otherPhotos.append(gallery, navigation)
          showPhotos()
          photoCell.append(otherPhotos)
        }
        const option = el('td', undefined, 'variant-option'),
          details = el('div', undefined, 'variant-details'),
          description = el('div', undefined, 'variant-description'),
          note = inlineField(
            'Product variant',
            variant.variant,
            (value) => {
              variant.variant = value
            },
            'Describe this variant',
            true
          )
        note.classList.add('variant-note')
        note.firstChild.replaceWith(
          el('span', 'Product variant', 'visually-hidden')
        )
        description.append(
          preparationHelp(
            note,
            'Describe what differs, such as color or scent. This note is not printed.'
          )
        )
        if (variant.size)
          description.append(
            preparationHelp(
              el('small', `Order size: ${variant.size}`, 'source-size'),
              'From the order. Helps you choose a size code; this measurement is not printed.'
            )
          )
        const codeOptions = el('fieldset', undefined, 'variant-code-options')
        codeOptions.append(el('legend', 'Code options'))
        const codeReadout = el(
          'output',
          undefined,
          'variant-code-readout visually-hidden'
        )
        codeReadout.setAttribute('aria-label', 'Full barcode')
        const codeDesign = el('div', undefined, 'variant-code-design')
        const codeBasePart = el('div', undefined, 'code-base-part')
        const codeBase = el(
          'code',
          group.baseCode || 'Assigning code…',
          'variant-code-base'
        )
        codeBasePart.append(
          codeBase,
          el('span', 'Product code', 'code-part-label')
        )
        codeDesign.append(
          preparationHelp(
            codeBasePart,
            'Shared product code. Edit the title above to change it for every variant.'
          )
        )
        const updateCodeReadout = () => {
          codeReadout.textContent = `${group.baseCode || 'Product code'}${variant.variantSuffix}${variant.sizeSuffix}`
          codeBase.textContent = group.baseCode || 'Assigning code…'
        }
        updateCodeReadout()
        productInput.addEventListener('input', updateCodeReadout)
        productInput.addEventListener('change', updateCodeReadout)
        for (const [key, label] of [
          ['variantSuffix', 'Variant code'],
          ['sizeSuffix', 'Size code'],
        ]) {
          const labelField = inlineField(
            label,
            variant[key],
            (value) => {
              variant[key] = value.toUpperCase()
              if (key === 'sizeSuffix') variant.needsSizeMapping = false
              updateCodeReadout()
            },
            '—'
          )
          labelField.classList.add(`code-part-${key}`)
          labelField.firstChild.replaceWith(
            el(
              'span',
              label === 'Variant code' ? 'Variant' : 'Size',
              'code-part-label'
            )
          )
          const codeInput = labelField.querySelector('input')
          codeInput.setAttribute('aria-label', `${label} ${variant.id}`)
          codeInput.autocomplete = 'off'
          codeInput.setAttribute('autocorrect', 'off')
          codeInput.spellcheck = false
          codeInput.maxLength = 30
          codeInput.size = Math.max(1, codeInput.value.length)
          codeInput.addEventListener('input', () => {
            codeInput.size = Math.max(1, codeInput.value.length)
          })
          codeDesign.append(
            preparationHelp(
              labelField,
              key === 'variantSuffix'
                ? 'Identifies the color or style: A, B, C. Leave blank when not needed.'
                : 'Identifies the size: S, M, L. Leave blank when not needed.'
            )
          )
        }
        codeOptions.append(codeDesign, codeReadout)
        if (variant.needsSizeMapping)
          codeOptions.append(
            el('small', 'Choose a size code', 'needs-preparation')
          )
        details.append(description, codeOptions)
        option.append(details)
        row.append(photoCell, option)
        const output = el('td')
        if (!variant.entryIds.some((id) => live.has(id)))
          output.append(el('span', 'Removed from order', 'packing-help'))
        else
          output.append(
            media.label(
              () => outputModel(draft, group, variant, 'barcode'),
              () =>
                preparationAction(async () => {
                  await saveDraft(current)
                  await openLabel(
                    draft.orderId,
                    group.id,
                    variant.id,
                    'barcode'
                  )
                }),
              'barcode'
            )
          )
        row.append(output)
        body.append(row)
      }
      table.append(body)
      scroll.append(table)
      card.append(scroll)
      if (group.variants.length > 50) {
        const navigation = el('div', undefined, 'dialog-actions')
        const previous = prepButton('Previous variants', () => {
            variantPages.set(group.id, variantPage - 1)
            renderPreparation()
          }),
          next = prepButton('Next variants', () => {
            variantPages.set(group.id, variantPage + 1)
            renderPreparation()
          })
        previous.disabled = variantPage === 0
        next.disabled = (variantPage + 1) * 50 >= group.variants.length
        navigation.append(
          previous,
          el(
            'span',
            `${variantPage + 1} / ${Math.ceil(group.variants.length / 50)}`
          ),
          next
        )
        card.append(navigation)
      }
      const groupTools = el('section', undefined, 'group-tools')
      groupTools.setAttribute('aria-label', 'Grouping tools')
      groupTools.append(el('h4', 'Grouping tools'))
      const groupActions = el('div', undefined, 'dialog-actions')
      groupActions.append(
        preparationHelp(
          prepButton('Share one barcode', () => {
            const ids = [...variantSelection.selected]
            if (ids.length < 2)
              throw new Error('Select at least two matching product variants.')
            const target = group.variants.find((v) => ids.includes(v.id))
            for (const variant of group.variants.filter(
              (v) => ids.includes(v.id) && v !== target
            ))
              target.entryIds.push(...variant.entryIds)
            group.variants = group.variants.filter(
              (v) => !ids.includes(v.id) || v === target
            )
            renderPreparation()
          }),
          'Give matching variants one barcode. Original prices and quantities stay separate.'
        ),
        preparationHelp(
          prepButton('Give rows separate barcodes', async () => {
            const ids = variantSelection.selected
            const selected = group.variants.filter(
              (v) => ids.has(v.id) && v.entryIds.length > 1
            )
            if (!selected.length)
              throw new Error(
                'Select a variant containing multiple source rows.'
              )
            const used = new Set(
              group.variants.map((v) => v.variantSuffix + v.sizeSuffix)
            )
            if (group.baseCode)
              for (const code of await repository.getReservedBarcodes(
                group.baseCode,
                { accountId: draft.accountId }
              ))
                used.add(code.slice(group.baseCode.length))
            for (const variant of selected) {
              for (const entryId of variant.entryIds.slice(1)) {
                const suffix = unusedSuffix(used, variant.sizeSuffix)
                used.add(suffix + variant.sizeSuffix)
                group.variants.push({
                  ...structuredClone(variant),
                  id: crypto.randomUUID(),
                  entryIds: [entryId],
                  variantSuffix: suffix,
                })
              }
              variant.entryIds = variant.entryIds.slice(0, 1)
            }
            renderPreparation()
          }),
          'Split a combined variant back into one barcode per original order row.'
        ),
        preparationHelp(
          prepButton('Move to new product', () => {
            const ids = [...variantSelection.selected]
            if (!ids.length || ids.length === group.variants.length)
              throw new Error(
                'Select some, but not all, variants to split into a new product group.'
              )
            const separated = {
              ...structuredClone(group),
              id: crypto.randomUUID(),
              baseCode: '',
              variants: group.variants.filter((v) => ids.includes(v.id)),
            }
            group.variants = group.variants.filter((v) => !ids.includes(v.id))
            draft.groups.push(separated)
            renderPreparation()
          }),
          'Give selected variants their own product code and carton mark.'
        )
      )
      groupTools.append(groupActions)
      card.append(groupTools)
      host.append(card)
    }
    if (draft.groups.length > 20) {
      const nav = el('div', undefined, 'dialog-actions')
      const prev = prepButton('Previous groups', () => {
          groupPage--
          renderPreparation()
        }),
        next = prepButton('Next groups', () => {
          groupPage++
          renderPreparation()
        })
      prev.disabled = groupPage === 0
      next.disabled = (groupPage + 1) * 20 >= draft.groups.length
      nav.append(
        prev,
        el('span', `${groupPage + 1} / ${Math.ceil(draft.groups.length / 20)}`),
        next
      )
      host.append(nav)
    }
    const output = el('div', undefined, 'dialog-actions preparation-output')
    const imageCopy = button('Copy Excel image', async (target) => {
      if (preparationImageAbort) return
      const original = target.textContent
      const abort = new AbortController()
      preparationImageAbort = abort
      const cancel = button('Cancel image', () => abort.abort())
      cancel.hidden = true
      target.after(cancel)
      target.disabled = true
      target.classList.remove('copied', 'copy-failed')
      output.querySelector('.copy-error')?.remove()
      try {
        const rows = await preparationAction(async () => {
          await flushSaves()
          if (
            JSON.stringify(draft) !==
            JSON.stringify(preparations.get(draft.orderId))
          )
            await saveDraft(current)
          return preparationCopyRows(draft)
        })
        if (!rows) return
        const success = await copyExcelImage(rows, {
          loadImage,
          signal: abort.signal,
          onProgress: (message) => {
            target.textContent = message
            cancel.hidden = false
          },
        })
        if (success) {
          target.textContent = 'Copied'
          target.classList.add('copied')
        } else target.textContent = original
      } catch (error) {
        target.textContent = 'Try again'
        target.classList.add('copy-failed')
        const message = el('span', error.message, 'copy-error')
        message.setAttribute('role', 'alert')
        output.append(message)
      } finally {
        if (preparationImageAbort === abort) preparationImageAbort = null
        target.disabled = false
        cancel.remove()
        setTimeout(() => {
          target.textContent = original
          target.classList.remove('copied', 'copy-failed')
          decorateIcon(target, 'table')
        }, 3000)
      }
    })
    copyScope = el('span', '', 'packing-help preparation-copy-scope')
    output.append(
      copyScope,
      imageCopy,
      prepButton('Copy barcode images', async () => bulkLabels('barcode')),
      prepButton('Copy carton marks', async () => bulkLabels('mark'))
    )
    host.append(output)
    updatePreparationCopyScope()
    selection.controller.paint()
    for (const variants of selection.variants.values())
      variants.controller.paint()
  }

  async function chooseImageBatch(rows, size = 20) {
    if (rows.length <= size) return rows
    const modal = el('dialog')
    modal.setAttribute('aria-label', 'Choose image batch')
    modal.append(
      el('h2', 'Copy images in manageable batches'),
      el(
        'p',
        `${rows.length} images. Each batch preserves original quality and row order.`
      )
    )
    document.body.append(modal)
    return new Promise((resolve) => {
      let result = null
      const count = Math.ceil(rows.length / size),
        select = el('input'),
        range = el('p')
      select.type = 'number'
      select.min = '1'
      select.max = String(count)
      select.value = '1'
      select.setAttribute('aria-label', `Batch number (1–${count})`)
      const describe = () => {
        const start = (Number(select.value) - 1) * size
        range.textContent = `Batch ${select.value} of ${count} · rows ${start + 1}–${Math.min(rows.length, start + size)}`
      }
      select.oninput = describe
      describe()
      const proceed = el('button', 'Use this batch')
      proceed.onclick = () => {
        if (!select.reportValidity()) return
        const start = (Number(select.value) - 1) * size
        result = rows.slice(start, start + size)
        modal.close()
      }
      modal.append(select, range, proceed)
      const cancel = el('button', 'Cancel')
      cancel.onclick = () => modal.close()
      modal.append(cancel)
      modal.onclose = () => {
        modal.remove()
        resolve(result)
      }
      modal.showModal()
    })
  }
  async function bulkLabels(kind) {
    const draft = drafts[current],
      selected = new Set(preparationCopyRows(draft).map((row) => row.entryId))
    await flushSaves()
    if (
      JSON.stringify(draft) !== JSON.stringify(preparations.get(draft.orderId))
    )
      await saveDraft(drafts.indexOf(draft))
    const record = getRecords().find(
        (record) => record.snapshot.orderId === draft.orderId
      ),
      prep = preparations.get(draft.orderId),
      models = []
    for (const group of activeGroups(prep, record.snapshot)) {
      const variants = group.variants.filter((variant) =>
        variant.entryIds.some((id) => selected.has(id))
      )
      if (!variants.length) continue
      if (kind === 'mark') models.push(outputModel(prep, group, null, kind))
      else
        for (const variant of variants)
          models.push(outputModel(prep, group, variant, kind))
    }
    if (!models.length) throw new Error('No active labels to copy.')
    const frozenSettings = structuredClone(settings()),
      frozenLogo = logoUrl()
    if (
      models.length > 1 &&
      !(await confirmScope({
        action: 'Copy',
        count: models.length,
        unit: kind === 'mark' ? 'carton marks' : 'barcode labels',
        detail:
          'Uses the selection in this order. Images will be generated at the configured print size.',
      }))
    )
      return
    const geometry = frozenSettings[kind]
    const estimatedBytes =
      Math.ceil((geometry.widthMm * frozenSettings.dpi) / 25.4) *
      Math.ceil((geometry.heightMm * frozenSettings.dpi) / 25.4) *
      4
    const budgetCount = Math.max(
      1,
      Math.floor((64 * 1024 * 1024) / estimatedBytes)
    )
    const batch = await chooseImageBatch(
      models,
      Math.min(budgetCount, kind === 'mark' ? 4 : 20)
    )
    if (!batch) return
    const modal = el('dialog')
    modal.setAttribute('aria-label', 'Prepare label images')
    const status = el('p', 'Preparing…'),
      copy = el('button', 'Copy prepared images', 'primary'),
      cancel = el('button', 'Cancel')
    copy.disabled = true
    modal.append(el('h2', 'Label images'), status, copy, cancel)
    document.body.append(modal)
    const abort = new AbortController(),
      results = []
    cancel.onclick = () => modal.close()
    modal.onclose = () => {
      abort.abort()
      modal.remove()
    }
    modal.showModal()
    try {
      for (const [index, model] of batch.entries()) {
        if (abort.signal.aborted) return
        status.textContent = `Preparing ${index + 1} of ${batch.length}`
        results.push(
          await renderLabel({
            ...model,
            settings: frozenSettings,
            logoUrl: frozenLogo,
            signal: abort.signal,
          })
        )
        await yieldUI()
      }
      status.textContent = `${results.length} images ready. Paste into Excel after copying.`
      copy.disabled = false
      copy.onclick = () => copied(copy, () => labelClipboard(results))
    } catch (error) {
      if (!abort.signal.aborted) status.textContent = error.message
    }
  }
  function preparedRows(rows = getRows()) {
    return rows.map((row) => {
      const match = membership.get(`${row.orderId}/${row.entryId}`)
      if (!match) {
        const suggestion = suggestions.get(`${row.orderId}/${row.entryId}`)
        return {
          ...row,
          baseCode: '',
          barcode: '',
          spanishName: suggestion?.spanishName || '',
          chineseCategory: suggestion?.category || '',
          groupId: row.entryId,
        }
      }
      let code = ''
      try {
        code = barcodeValue(match.group, match.variant)
      } catch {}
      return {
        ...row,
        baseCode: match.group.baseCode,
        barcode: code,
        spanishName: match.variant.spanishName || match.group.spanishName,
        chineseCategory: match.group.category,
        groupId: match.group.id,
        variantDescription: match.variant.variant,
        sourceSize: match.variant.size,
      }
    })
  }
  function preparationCopyRows(draft) {
    const record = getRecords().find(
      (entry) => entry.snapshot.orderId === draft.orderId
    )
    if (!record) throw new Error('This order is no longer available.')
    const state = preparationSelection(draft)
    const selectedVariants = [...state.variants.values()].some(
      (entry) => entry.selected.size
    )
    const hasSelection = state.groups.size > 0 || selectedVariants
    const entryIds = new Set()
    for (const group of activeGroups(draft, record.snapshot)) {
      const variants = state.variants.get(group.id)?.selected
      for (const variant of group.variants) {
        const include = variants?.size
          ? variants.has(variant.id)
          : !hasSelection || state.groups.has(group.id)
        if (include) for (const id of variant.entryIds) entryIds.add(id)
      }
    }
    return preparedRows(
      record.snapshot.items
        .filter((item) => entryIds.has(item.entryId))
        .map((item) => ({ ...item, orderId: draft.orderId }))
    )
  }
  async function copyPreparation() {
    const rows = preparedRows()
    if (!rows.length) throw new Error('Select product rows to copy.')
    const modal = el('dialog')
    modal.setAttribute('aria-label', 'Copy preparation columns')
    modal.append(el('h2', `Copy ${rows.length} product rows`))
    const fields = el('div', undefined, 'column-options')
    for (const [key, title] of preparationColumns) {
      const label = el('label', title),
        check = el('input')
      check.type = 'checkbox'
      check.value = key
      check.checked = true
      label.prepend(check)
      fields.append(label)
    }
    const copy = button(
        'Copy chosen columns',
        async (b) =>
          copied(b, () =>
            writeTable(
              preparationTable(
                rows,
                [...fields.querySelectorAll('input:checked')].map(
                  (check) => check.value
                ),
                headers()
              )
            )
          ),
        'primary'
      ),
      close = el('button', 'Close')
    close.onclick = () => modal.close()
    modal.append(
      fields,
      el(
        'p',
        `This will iterate over ${new Set(rows.map((row) => row.orderId)).size} orders. Product codes appear only once per group.`
      ),
      copy,
      close
    )
    document.body.append(modal)
    modal.onclose = () => modal.remove()
    modal.showModal()
  }
  async function openSettings() {
    const value = structuredClone(preferences)
    value.settings = settings()
    const host = $('settings-content'),
      data = $('settings-data'),
      tabs = el('div', undefined, 'settings-tabs'),
      panels = new Map(),
      tabButtons = []
    host.replaceChildren(el('h2', 'Settings'), tabs)
    tabs.setAttribute('role', 'tablist')
    tabs.setAttribute('aria-label', 'Settings sections')
    function selectTab(id) {
      for (const tab of tabButtons) {
        const selected = tab.getAttribute('aria-controls') === id
        tab.setAttribute('aria-selected', String(selected))
        tab.tabIndex = selected ? 0 : -1
      }
      for (const [key, panel] of panels) panel.hidden = key !== id
    }
    for (const [key, title, symbol] of [
      ['labels', 'Labels', 'barcode'],
      ['names', 'Product names', 'text'],
      ['data', 'Data', 'download'],
    ]) {
      const id = `settings-panel-${key}`,
        tab = decorateIcon(
          button(title, () => selectTab(id)),
          symbol
        ),
        panel = el('section', undefined, 'settings-panel')
      tab.id = `settings-tab-${key}`
      tab.setAttribute('role', 'tab')
      tab.setAttribute('aria-controls', id)
      panel.id = id
      panel.setAttribute('role', 'tabpanel')
      panel.setAttribute('aria-labelledby', tab.id)
      panel.tabIndex = 0
      tabButtons.push(tab)
      panels.set(id, panel)
      tabs.append(tab)
      host.append(panel)
    }
    tabs.addEventListener('keydown', (event) => {
      const current = tabButtons.indexOf(event.target)
      if (current < 0) return
      const index =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? tabButtons.length - 1
            : event.key === 'ArrowRight'
              ? (current + 1) % tabButtons.length
              : event.key === 'ArrowLeft'
                ? (current + tabButtons.length - 1) % tabButtons.length
                : -1
      if (index < 0) return
      event.preventDefault()
      selectTab(tabButtons[index].getAttribute('aria-controls'))
      tabButtons[index].focus()
    })
    const labels = panels.get('settings-panel-labels'),
      names = panels.get('settings-panel-names'),
      grid = el('div', undefined, 'settings-grid')
    function card(title, symbol, className = '') {
      const section = el('section', undefined, `settings-card ${className}`),
        heading = el('h3', title)
      decorateIcon(heading, symbol)
      section.append(heading)
      grid.append(section)
      return section
    }
    function settingField(
      title,
      current,
      change,
      { min, max, step, help } = {}
    ) {
      const result = field(
          title,
          current,
          change,
          min === undefined ? 'text' : 'number'
        ),
        input = result.querySelector('input')
      if (min !== undefined) {
        input.min = String(min)
        input.max = String(max)
        input.step = String(step ?? 1)
      }
      if (help) preparationHelp(result, help)
      return result
    }
    const shared = card('Shared label text', 'text', 'settings-shared')
    for (const [key, label] of [
      ['website', 'Website'],
      ['destination', 'Destination'],
    ])
      shared.append(
        settingField(
          label,
          value.settings[key],
          (v) => (value.settings[key] = v),
          {
            help:
              key === 'website'
                ? 'Printed on every barcode label.'
                : 'Destination printed on every barcode label.',
          }
        )
      )
    shared.append(
      settingField(
        'Output DPI',
        value.settings.dpi,
        (v) => (value.settings.dpi = Number(v)),
        {
          min: 150,
          max: 600,
          help: 'Image detail for copying and printing. 300 DPI is the default; physical dimensions stay the same.',
        }
      )
    )
    for (const kind of ['barcode', 'mark']) {
      const title = kind === 'mark' ? 'Carton mark' : 'Barcode',
        section = card(title, kind === 'mark' ? 'carton' : 'barcode'),
        dimensions = el('div', undefined, 'settings-dimensions')
      for (const [key, label, minimum] of [
        ['widthMm', 'width', 20],
        ['heightMm', 'height', 10],
      ]) {
        const size = settingField(
          `${label === 'width' ? 'Width' : 'Height'} (mm)`,
          value.settings[kind][key] ?? 1,
          (v) => (value.settings[kind][key] = Number(v)),
          {
            min: minimum,
            max: 300,
            step: 0.1,
            help: `${title} ${label} in millimetres. Saved images carry this physical size.`,
          }
        )
        size
          .querySelector('input')
          .setAttribute('aria-label', `${title} ${label} (mm)`)
        dimensions.append(size)
      }
      const scale = settingField(
          'Text size',
          value.settings[kind].textScale ?? 1,
          (v) => {
            value.settings[kind].textScale = Number(v)
            scaleValue.value = `${Math.round(Number(v) * 100)}%`
          },
          {
            min: 0.75,
            max: 1.25,
            step: 0.05,
            help: 'Resize label text from 75% to 125%. The layout and barcode bars keep their proportions.',
          }
        ),
        scaleValue = el(
          'output',
          `${Math.round((value.settings[kind].textScale ?? 1) * 100)}%`
        ),
        scaleInput = scale.querySelector('input')
      scale.className = 'settings-scale'
      scaleInput.type = 'range'
      scaleInput.setAttribute('aria-label', `${title} text scale (0.75–1.25)`)
      scaleValue.htmlFor = scaleInput.id
      scale.append(scaleValue)
      section.append(dimensions, scale)
    }
    const logoCard = card('Label logo', 'image', 'settings-logo'),
      logo = el('input'),
      logoPreview = el('img'),
      logoControls = el('div'),
      logoStatus = el('span', 'PNG, JPG or WebP · up to 2 MB', 'packing-help')
    logo.type = 'file'
    logo.className = 'settings-logo-file'
    logo.accept = 'image/png,image/jpeg,image/webp'
    logo.setAttribute('aria-label', 'Replace label logo')
    logoPreview.src = value.logoDataUrl || logoUrl()
    logoPreview.alt = 'Current label logo'
    logoPreview.className = 'settings-logo-preview'
    logo.onchange = async () => {
      try {
        const file = logo.files[0]
        if (file) {
          if (file.size > 2 * 1024 * 1024)
            throw new Error('Choose a logo smaller than 2 MB.')
          const url = await blobData(file),
            image = new Image()
          image.src = url
          await image.decode()
          value.logoDataUrl = url
          logoPreview.src = url
          logoStatus.textContent = file.name
        }
      } catch (error) {
        showError(error.message)
      }
    }
    logoControls.append(
      decorateIcon(
        button('Replace logo', () => logo.click()),
        'upload'
      ),
      logoStatus,
      logo
    )
    logoCard.append(logoPreview, logoControls)
    labels.append(grid)
    names.append(
      el('h3', 'Automatic product names'),
      el(
        'p',
        'Fill names from product titles. Your edits stay unchanged; unknown products stay unnamed.',
        'packing-help'
      )
    )
    const table = el('table', undefined, 'vocabulary-table'),
      body = el('tbody'),
      thead = el('thead'),
      head = el('tr')
    for (const name of [
      'Title includes',
      'Skip if it includes',
      'Spanish name',
      'Chinese category',
      '',
    ]) {
      const th = el('th', name)
      th.scope = 'col'
      head.append(th)
    }
    thead.append(head)
    table.append(thead, body)
    let vocabularyPage = 0
    const pageSize = 12
    const vocabularySearch = field(
      'Search naming rules',
      '',
      () => {
        vocabularyPage = 0
        renderVocabulary()
      },
      'search'
    )
    vocabularySearch.className = 'vocabulary-search'
    const vocabularyCount = el('span', undefined, 'packing-help')
    vocabularyCount.setAttribute('role', 'status')
    const vocabularyNavigation = el('div', undefined, 'vocabulary-navigation')
    const previousRules = button('Previous rules', () => {
      vocabularyPage--
      renderVocabulary()
    })
    const nextRules = button('Next rules', () => {
      vocabularyPage++
      renderVocabulary()
    })
    decorateIcon(previousRules, 'previous', { iconOnly: true })
    decorateIcon(nextRules, 'next', { iconOnly: true })
    preparationHelp(previousRules, 'Previous page of naming rules.')
    preparationHelp(nextRules, 'Next page of naming rules.')
    vocabularyNavigation.append(previousRules, vocabularyCount, nextRules)
    function vocabularyRow(entry) {
      const row = el('tr')
      for (const [key, name] of [
        ['match', 'Title includes'],
        ['exclude', 'Skip if it includes'],
        ['spanishName', 'Spanish name'],
        ['category', 'Chinese category'],
      ]) {
        const td = el('td'),
          input = el('input')
        input.value = entry[key] || ''
        input.setAttribute('aria-label', name)
        input.oninput = () =>
          (entry[key] =
            key === 'spanishName' ? input.value.toUpperCase() : input.value)
        preparationHelp(
          input,
          key === 'match'
            ? 'Words to match in the original title. Separate alternatives with |.'
            : key === 'exclude'
              ? 'Ignore this rule if the title includes any of these words. Separate alternatives with |.'
              : key === 'spanishName'
                ? 'Short uppercase name printed on the barcode.'
                : 'Chinese category printed on the carton mark.'
        )
        td.append(input)
        row.append(td)
      }
      const td = el('td')
      const remove = decorateIcon(
        button('Remove naming rule', () => {
          value.vocabulary = value.vocabulary.filter((item) => item !== entry)
          renderVocabulary()
        }),
        'trash',
        { iconOnly: true }
      )
      preparationHelp(remove, 'Remove this naming rule when you save Settings.')
      td.append(remove)
      row.append(td)
      body.append(row)
    }
    function renderVocabulary() {
      const query = vocabularySearch
        .querySelector('input')
        .value.trim()
        .toLowerCase()
      const matching = value.vocabulary.filter((entry) =>
        [entry.match, entry.exclude, entry.spanishName, entry.category].some(
          (value) =>
            String(value || '')
              .toLowerCase()
              .includes(query)
        )
      )
      const pages = Math.max(1, Math.ceil(matching.length / pageSize))
      vocabularyPage = Math.max(0, Math.min(vocabularyPage, pages - 1))
      body.replaceChildren()
      matching
        .slice(vocabularyPage * pageSize, (vocabularyPage + 1) * pageSize)
        .forEach(vocabularyRow)
      const start = matching.length ? vocabularyPage * pageSize + 1 : 0,
        end = Math.min((vocabularyPage + 1) * pageSize, matching.length)
      vocabularyCount.textContent = `${start}–${end} of ${matching.length} rules`
      if (!matching.length) {
        const row = el('tr'),
          cell = el('td', 'No matching rules.', 'vocabulary-empty')
        cell.colSpan = 5
        row.append(cell)
        body.append(row)
      }
      previousRules.disabled = vocabularyPage === 0
      nextRules.disabled = vocabularyPage + 1 === pages
    }
    renderVocabulary()
    const scroll = el('div', undefined, 'vocabulary-scroll'),
      toolbar = el('div', undefined, 'vocabulary-toolbar')
    scroll.append(table)
    scroll.tabIndex = 0
    scroll.setAttribute('role', 'region')
    scroll.setAttribute('aria-label', 'Naming rules')
    toolbar.append(
      vocabularySearch,
      decorateIcon(
        button('Add rule', () => {
          const entry = { match: '', spanishName: '', category: '' }
          value.vocabulary.unshift(entry)
          vocabularySearch.querySelector('input').value = ''
          vocabularyPage = 0
          renderVocabulary()
          body.querySelector('input')?.focus()
        }),
        'plus'
      )
    )
    names.append(toolbar, scroll, vocabularyNavigation)
    panels.get('settings-panel-data').append(data)
    const footer = el('div', undefined, 'settings-footer')
    const settingsError = el('p', undefined, 'packing-error')
    settingsError.setAttribute('role', 'alert')
    host.append(settingsError)
    footer.append(
      el('span', 'Save changes to labels and naming rules.', 'packing-help'),
      button(
        'Save settings',
        async (save) => {
          save.disabled = true
          settingsError.textContent = ''
          try {
            value.settings.vocabularyInitialized = true
            // Validate geometry with a representative render before accepting settings.
            await renderLabel({
              kind: 'barcode',
              code: 'CE26060101AS',
              spanishName: 'JARRA DE VIDRIO',
              settings: value.settings,
              logoUrl: value.logoDataUrl || logoUrl(),
            })
            await renderLabel({
              kind: 'mark',
              code: 'CE26060101',
              category: '玻璃',
              settings: value.settings,
            })
            preferences = await repository.savePackingPreferences(value)
            await changed({ reload: true })
            channel?.postMessage('preferences')
            $('settings-dialog').close()
            feedback('Settings saved.')
          } finally {
            save.disabled = false
          }
        },
        'primary'
      )
    )
    host.append(footer)
    selectTab('settings-panel-labels')
    dialog($('settings-dialog'))
  }
  $('prepare-orders').onclick = () =>
    openPreparation().catch((e) => feedback(e.message, true))
  $('copy-preparation').onclick = () =>
    copyPreparation().catch((e) => feedback(e.message, true))
  $('packing-settings').onclick = () =>
    openSettings().catch((e) => feedback(e.message, true))
  $('copy-group-codes').onclick = async () => {
    const rows = preparedRows(),
      codes = [...new Set(rows.map((row) => row.baseCode).filter(Boolean))]
    if (!codes.length) {
      feedback('Prepare product codes first.', true)
      return
    }
    if (
      codes.length > 1 &&
      !(await confirmScope({
        action: 'Copy',
        count: codes.length,
        unit: 'product codes',
        detail: 'Each product group appears once.',
      }))
    )
      return
    await copied($('copy-group-codes'), () =>
      navigator.clipboard.writeText(codes.join('\r\n'))
    )
  }
  return {
    reload,
    chooseImageBatch,
    preparedRows,
    searchText(orderId, entryId) {
      const match = membership.get(`${orderId}/${entryId}`)
      if (!match) {
        const suggestion = suggestions.get(`${orderId}/${entryId}`)
        return `${suggestion?.spanishName || ''} ${suggestion?.category || ''}`
      }
      let code = ''
      try {
        code = barcodeValue(match.group, match.variant)
      } catch {}
      return `${match.group.baseCode} ${code} ${match.group.spanishName} ${match.variant.spanishName || ''} ${match.group.category}`
    },
    updateActions() {
      $('prepare-orders').disabled = !selectedRecords().length
    },
    decorateRow(host, row) {
      const matched = membership.get(`${row.orderId}/${row.entryId}`),
        bar = el('div', undefined, 'row-preparation')
      if (matched) {
        bar.append(el('code', matched.group.baseCode))
        const name = matched.variant.spanishName || matched.group.spanishName
        if (name) bar.append(el('span', name))
        if (matched.group.category)
          bar.append(el('span', matched.group.category, 'category-name'))
        if (
          !(matched.variant.spanishName || matched.group.spanishName) ||
          !matched.group.category
        )
          bar.append(
            button(
              'Name',
              () => openPreparation(row.orderId),
              'needs-preparation name-product'
            )
          )
        const { prep, group, variant } = matched
        bar.append(
          button('Barcode', () =>
            openLabel(prep.orderId, group.id, variant.id, 'barcode')
          ),
          button('Carton mark', () =>
            openLabel(prep.orderId, group.id, null, 'mark')
          )
        )
        const copy = button('Copy code', (b) =>
          copied(b, () => navigator.clipboard.writeText(group.baseCode))
        )
        bar.append(copy)
      } else {
        const suggestion = suggestions.get(`${row.orderId}/${row.entryId}`)
        if (suggestion?.spanishName)
          bar.append(el('span', suggestion.spanishName))
        if (suggestion?.category)
          bar.append(el('span', suggestion.category, 'category-name'))
        bar.append(
          button(
            'Prepare',
            () => openPreparation(row.orderId),
            'needs-preparation name-product'
          )
        )
      }
      host.append(bar)
    },
  }
}
