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
const initialVocabulary = [
  ['玻璃罐', 'FRASCO DE VIDRIO', '玻璃'],
  ['玻璃壶', 'JARRA DE VIDRIO', '玻璃'],
  ['玻璃杯', 'VASO DE VIDRIO', '玻璃'],
  ['保鲜盒', 'RECIPIENTE DE COCINA', '日用品'],
  ['保温杯', 'VASO TERMICO', '日用品'],
  ['地毯', 'ALFOMBRA', '纺织品'],
  ['镜子', 'ESPEJO', '镜子'],
  ['花瓶', 'FLORERO', '工艺品'],
  ['收纳盒', 'CAJA ORGANIZADORA', '日用品'],
  ['蜡烛', 'VELA', '工艺品'],
  ['碗', 'TAZON', '日用品'],
  ['盘子', 'PLATO', '日用品'],
].map(([match, spanishName, category]) => ({ match, spanishName, category }))
function field(title, value, change, type = 'text') {
  const label = el('label', title),
    input = el('input')
  input.type = type
  input.value = value ?? ''
  input.addEventListener('input', () => change(input.value))
  label.append(input)
  return label
}
function button(text, handler, className) {
  const result = el('button', text, className)
  result.addEventListener('click', async () => {
    try {
      await handler(result)
    } catch (error) {
      showError(error.message)
    }
  })
  return result
}
function disclosure(title, className = '') {
  const details = el('details', undefined, className)
  details.append(el('summary', title))
  return details
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
    preferences,
    editor,
    drafts = [],
    current = 0,
    groupPage = 0
  const channel = globalThis.BroadcastChannel
    ? new BroadcastChannel('1688-preparation')
    : null
  const variantPages = new Map()
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
  $('preparation-dialog').addEventListener('close', () => media.reset())
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
    if (
      !preferences.settings.vocabularyInitialized &&
      !preferences.vocabulary.length
    )
      preferences.vocabulary = structuredClone(initialVocabulary)
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
  channel?.addEventListener('message', async () => {
    await reload()
    changed()
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
  function outputModel(prep, group, variant, kind) {
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
      code: kind === 'mark' ? group.baseCode : barcodeValue(group, variant),
      spanishName: variant?.spanishName || group.spanishName,
      category: group.category,
    }
  }
  async function openLabel(orderId, groupId, variantId, kind) {
    let prep = structuredClone(preparations.get(orderId))
    if (!prep) throw new Error('Save the preparation first.')
    const group = prep.groups.find((group) => group.id === groupId),
      variant = group.variants.find((variant) => variant.id === variantId)
    const model = outputModel(prep, group, variant, kind)
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
          if (!next.code.startsWith(group.baseCode))
            throw new Error(
              'Edit the product code on its carton mark to change the shared base. The barcode must retain that base.'
            )
          const suffix = next.code.slice(group.baseCode.length)
          if (variant.sizeSuffix && suffix.endsWith(variant.sizeSuffix))
            variant.variantSuffix = suffix.slice(0, -variant.sizeSuffix.length)
          else {
            const parts = /^([A-Z]*)(.*)$/.exec(suffix)
            variant.variantSuffix = parts[1]
            variant.sizeSuffix = parts[2]
          }
          variant.needsSizeMapping = false
          variant.spanishName = next.spanishName.toUpperCase()
        }
        prep = await saved(draft)
        const savedGroup = prep.groups.find((item) => item.id === groupId)
        return outputModel(
          prep,
          savedGroup,
          savedGroup.variants.find((item) => item.id === variantId),
          kind
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
  async function openPreparation() {
    if (preparationBusy)
      throw new Error(
        'Wait for preparation to finish saving before reopening it.'
      )
    await flushSaves()
    const records = selectedRecords()
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
      }
      updateHistoryButtons()
      media.refresh()
    }
    return draft
  }
  function renderPreparation() {
    checkpoint()
    media.reset()
    codeFields.clear()
    const host = $('preparation-content'),
      draft = drafts[current]
    host.replaceChildren(el('h2', 'Prepare products & labels'))
    const heading = el('div', undefined, 'preparation-heading'),
      select = el('select')
    select.setAttribute('aria-label', 'Preparation order')
    drafts.forEach((prep, index) =>
      select.append(
        new Option(
          `${prep.sellerId || 'Seller unavailable'} · …${prep.orderId.slice(-8)}`,
          index
        )
      )
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
    heading.append(
      select,
      el(
        'span',
        `Packing ${new Date(`${draft.month}-01T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })} · ${draft.groups.length} product groups`,
        'packing-help'
      )
    )
    host.append(
      heading,
      el(
        'p',
        'Changes save automatically. Click a photo to zoom or a label to edit and copy.',
        'packing-help'
      )
    )
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
    let categoryValue = ''
    const orderTools = disclosure('Order tools', 'order-tools')
    const orderCategory = field(
      'Chinese category for this order',
      '',
      (value) => {
        categoryValue = value
      }
    )
    const applyCategory = prepButton('Apply to this order', () => {
      for (const group of draft.groups) group.category = categoryValue
      renderPreparation()
    })
    orderTools.append(
      preparationHelp(
        orderCategory,
        'One Chinese name for all carton marks in this order. For example, 玻璃 means glass.'
      ),
      preparationHelp(
        applyCategory,
        'Replace the Chinese category for every product in this order.'
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
          const ids = [...host.querySelectorAll('.group-select:checked')].map(
            (check) => check.value
          )
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
    host.append(actions, orderTools)
    updateHistoryButtons()
    const pageGroups = draft.groups.slice(groupPage * 20, (groupPage + 1) * 20)
    for (const group of pageGroups) {
      const card = el('section', undefined, 'preparation-group'),
        title = el(
          'h3',
          group.spanishName || `Product ${draft.groups.indexOf(group) + 1}`
        ),
        check = el('input')
      check.type = 'checkbox'
      check.className = 'group-select'
      check.value = group.id
      check.setAttribute('aria-label', `Select group ${group.title}`)
      title.prepend(check)
      const originalTitle = disclosure(
        'Original product name',
        'original-product-name'
      )
      originalTitle.append(el('p', group.title))
      card.append(title, originalTitle)
      const fields = el('div', undefined, 'group-fields')
      const productCode = preparationHelp(
        field(
          'Product code',
          group.baseCode,
          (v) => (group.baseCode = v.toUpperCase())
        ),
        'Shared by all variants of this product. Printed on its carton mark.'
      )
      codeFields.set(group.id, productCode.querySelector('input'))
      fields.append(
        productCode,
        preparationHelp(
          field(
            'Spanish short name',
            group.spanishName,
            (v) => (group.spanishName = v.toUpperCase())
          ),
          'Printed on barcode labels in uppercase.'
        ),
        preparationHelp(
          field(
            'Chinese category',
            group.category,
            (v) => (group.category = v)
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
      overview.append(fields, carton)
      card.append(overview)
      const scroll = el('div', undefined, 'variant-scroll'),
        table = el('table', undefined, 'variants'),
        head = el('tr')
      for (const label of ['', 'Photo', 'Product variant', 'Barcode'])
        head.append(el('th', label))
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
        const row = el('tr'),
          choose = el('input')
        choose.type = 'checkbox'
        choose.value = variant.id
        choose.className = 'variant-select'
        choose.dataset.group = group.id
        choose.setAttribute(
          'aria-label',
          `Select variant ${variant.variant || variant.size || variant.id}`
        )
        const td = el('td')
        td.append(choose)
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
          const otherPhotos = disclosure(
            `${uniquePhotos.length - 1} more photos`
          )
          const gallery = el('div'),
            navigation = el('div', undefined, 'dialog-actions')
          let photoPage = 0
          const pages = Math.ceil((uniquePhotos.length - 1) / 10)
          function showPhotos() {
            media.forget(gallery)
            gallery.replaceChildren(
              ...uniquePhotos
                .slice(1 + photoPage * 10, 11 + photoPage * 10)
                .map((item) => media.photo(item))
            )
            previous.disabled = photoPage === 0
            next.disabled = photoPage + 1 === pages
          }
          const previous = prepButton('Previous photos', () => {
              photoPage--
              showPhotos()
            }),
            next = prepButton('Next photos', () => {
              photoPage++
              showPhotos()
            })
          if (pages > 1) navigation.append(previous, next)
          otherPhotos.append(gallery, navigation)
          otherPhotos.addEventListener('toggle', () => {
            if (otherPhotos.open) showPhotos()
            else {
              media.forget(gallery)
              gallery.replaceChildren()
            }
          })
          photoCell.append(otherPhotos)
        }
        const option = el('td', undefined, 'variant-option')
        option.append(
          preparationHelp(
            field('Product variant', variant.variant, (value) => {
              variant.variant = value
            }),
            'Describe what differs, such as color or scent. This note is not printed.'
          )
        )
        if (variant.size)
          option.append(
            preparationHelp(
              el('small', `Order size: ${variant.size}`, 'source-size'),
              'From the order. Helps you choose a size code; this measurement is not printed.'
            )
          )
        const codeOptions = disclosure('Code options', 'variant-code-options')
        codeOptions.open = Boolean(variant.needsSizeMapping)
        for (const [key, label] of [
          ['variantSuffix', 'Variant code'],
          ['sizeSuffix', 'Size code'],
        ]) {
          const labelField = field(label, variant[key], (value) => {
            variant[key] = value.toUpperCase()
            if (key === 'sizeSuffix') variant.needsSizeMapping = false
          })
          labelField
            .querySelector('input')
            .setAttribute('aria-label', `${label} ${variant.id}`)
          codeOptions.append(
            preparationHelp(
              labelField,
              key === 'variantSuffix'
                ? 'Added to the product code: A for black, B for pink. Leave blank if not needed.'
                : 'Added to the barcode: S for small, L for large. Leave blank if not needed.'
            )
          )
        }
        if (variant.needsSizeMapping)
          codeOptions.append(
            el('small', 'Choose a size code', 'needs-preparation')
          )
        option.append(codeOptions)
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
      const groupTools = disclosure('Grouping tools', 'group-tools')
      const groupActions = el('div', undefined, 'dialog-actions')
      groupActions.append(
        preparationHelp(
          prepButton('Share one barcode', () => {
            const ids = [
              ...card.querySelectorAll('.variant-select:checked'),
            ].map((check) => check.value)
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
            const ids = new Set(
              [...card.querySelectorAll('.variant-select:checked')].map(
                (check) => check.value
              )
            )
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
            const ids = [
              ...card.querySelectorAll('.variant-select:checked'),
            ].map((check) => check.value)
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
    const output = el('div', undefined, 'dialog-actions')
    output.append(
      prepButton('Copy barcode images', async () => bulkLabels('barcode')),
      prepButton('Copy carton marks', async () => bulkLabels('mark'))
    )
    host.append(output)
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
    await flushSaves()
    const targets = [],
      pending = []
    const selected = new Set(
      getRows().map((row) => `${row.orderId}/${row.entryId}`)
    )
    for (const record of selectedRecords()) {
      const prep =
        drafts.find((draft) => draft.orderId === record.snapshot.orderId) ||
        preparations.get(record.snapshot.orderId)
      if (!prep)
        throw new Error('Open preparation for the selected orders first.')
      if (
        JSON.stringify(prep) !== JSON.stringify(preparations.get(prep.orderId))
      )
        pending.push(prep)
      for (const group of activeGroups(prep, record.snapshot)) {
        const variants = group.variants.filter((variant) =>
          variant.entryIds.some((id) => selected.has(`${prep.orderId}/${id}`))
        )
        if (!variants.length) continue
        if (kind === 'mark') targets.push({ prep, group, variant: null })
        else
          for (const variant of variants) targets.push({ prep, group, variant })
      }
    }
    if (!targets.length) throw new Error('No active labels to copy.')
    if (
      targets.length > 1 &&
      !(await confirmScope({
        action: 'Copy',
        count: targets.length,
        unit: kind === 'mark' ? 'carton marks' : 'barcode labels',
        detail:
          'Images will be generated at the configured print size.' +
          (pending.length
            ? ` This also prepares ${pending.length} orders that have not been saved yet.`
            : ''),
      }))
    )
      return
    for (const prep of pending) await saveDraft(drafts.indexOf(prep))
    const models = targets.map(({ prep, group, variant }) => {
      const latest = preparations.get(prep.orderId)
      const savedGroup = latest.groups.find((entry) => entry.id === group.id)
      return outputModel(
        latest,
        savedGroup,
        savedGroup.variants.find((entry) => entry.id === variant?.id),
        kind
      )
    })
    const frozenSettings = structuredClone(settings()),
      frozenLogo = logoUrl()
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
  function preparedRows() {
    return getRows().map((row) => {
      const match = membership.get(`${row.orderId}/${row.entryId}`)
      if (!match)
        return {
          ...row,
          baseCode: '',
          barcode: '',
          spanishName: '',
          groupId: row.entryId,
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
        groupId: match.group.id,
      }
    })
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
    const host = $('settings-content')
    host.replaceChildren(el('h2', 'Label settings'))
    const grid = el('div', undefined, 'settings-grid')
    for (const [key, label] of [
      ['website', 'Website'],
      ['destination', 'Destination'],
    ])
      grid.append(
        field(label, value.settings[key], (v) => (value.settings[key] = v))
      )
    grid.append(
      field(
        'Output DPI',
        value.settings.dpi,
        (v) => (value.settings.dpi = Number(v)),
        'number'
      )
    )
    for (const kind of ['barcode', 'mark'])
      for (const [key, label] of [
        ['widthMm', 'width (mm)'],
        ['heightMm', 'height (mm)'],
        ['textScale', 'text scale (0.75–1.25)'],
      ])
        grid.append(
          field(
            `${kind === 'mark' ? 'Carton mark' : 'Barcode'} ${label}`,
            value.settings[kind][key] ?? 1,
            (v) => (value.settings[kind][key] = Number(v)),
            'number'
          )
        )
    const logo = el('input')
    logo.type = 'file'
    logo.accept = 'image/png,image/jpeg,image/webp'
    logo.setAttribute('aria-label', 'Replace label logo')
    logo.onchange = async () => {
      try {
        const file = logo.files[0]
        if (file) {
          if (file.size > 2 * 1024 * 1024)
            throw new Error('Choose a logo smaller than 2 MB.')
          value.logoDataUrl = await blobData(file)
        }
      } catch (error) {
        showError(error.message)
      }
    }
    host.append(
      grid,
      el('h3', 'Logo'),
      logo,
      el('h3', 'Local vocabulary'),
      el(
        'p',
        'Match Chinese title text to an uppercase Spanish short name and a Chinese category. No online translation.',
        'packing-help'
      )
    )
    const table = el('table', undefined, 'vocabulary-table'),
      body = el('tbody'),
      head = el('tr')
    for (const name of ['Title contains', 'Spanish name', 'Category', ''])
      head.append(el('th', name))
    table.append(head, body)
    function vocabularyRow(entry) {
      const row = el('tr')
      for (const key of ['match', 'spanishName', 'category']) {
        const td = el('td'),
          input = el('input')
        input.value = entry[key]
        input.setAttribute('aria-label', key)
        input.oninput = () => (entry[key] = input.value)
        td.append(input)
        row.append(td)
      }
      const td = el('td')
      td.append(
        button('Remove', () => {
          value.vocabulary = value.vocabulary.filter((item) => item !== entry)
          row.remove()
        })
      )
      row.append(td)
      body.append(row)
    }
    value.vocabulary.forEach(vocabularyRow)
    const scroll = el('div', undefined, 'variant-scroll')
    scroll.append(table)
    host.append(
      scroll,
      button('Add vocabulary entry', () => {
        const entry = { match: '', spanishName: '', category: '' }
        value.vocabulary.push(entry)
        vocabularyRow(entry)
      })
    )
    host.append(
      button(
        'Save settings',
        async () => {
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
          channel?.postMessage('changed')
          $('settings-dialog').close()
          feedback('Settings saved.')
        },
        'primary'
      )
    )
    dialog($('settings-dialog'))
  }
  for (const id of ['prepare-orders', 'open-preparation'])
    $(id).onclick = () =>
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
    searchText(orderId, entryId) {
      const match = membership.get(`${orderId}/${entryId}`)
      if (!match) return ''
      let code = ''
      try {
        code = barcodeValue(match.group, match.variant)
      } catch {}
      return `${match.group.baseCode} ${code} ${match.group.spanishName} ${match.variant.spanishName || ''}`
    },
    updateActions() {
      const records = selectedRecords(),
        unprepared = records.some(
          ({ snapshot }) => !preparations.has(snapshot.orderId)
        )
      $('prepare-orders').hidden = !unprepared && records.length > 0
      $('open-preparation').hidden = unprepared || !records.length
      $('prepare-orders').disabled = !records.length
    },
    decorateRow(host, row) {
      const matched = membership.get(`${row.orderId}/${row.entryId}`),
        bar = el('div', undefined, 'row-preparation')
      if (matched) {
        bar.append(el('code', matched.group.baseCode))
        if (matched.group.spanishName)
          bar.append(el('span', matched.group.spanishName))
        if (
          !(matched.variant.spanishName || matched.group.spanishName) ||
          !matched.group.category
        )
          bar.append(el('small', 'Finish label names', 'needs-preparation'))
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
      } else bar.append(el('small', 'Not prepared', 'needs-preparation'))
      host.append(bar)
    },
  }
}
