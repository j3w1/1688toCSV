import {
  message as uiMessage,
  bindText,
  bindAttribute,
  isMessage,
  t,
  getLocale,
  getLanguage,
  onLanguageChange,
} from './i18n.js'
import {
  activeGroups,
  barcodeValue,
  groupPackingMonth,
  planSelectedPreparations,
  reorderPreparationGroups,
  reorderPreparationVariants,
  restoreDefaultPacking,
  restorePreviousPacking,
  regeneratePreparationCode,
  hasDefaultPackingChanges,
  defaultPackingChanges,
  removeSelectedProducts,
  variantMaterial,
  setVariantMaterial,
  refreshPreparationMaterials,
  mergeVariantMaterials,
} from './packing-model.js'
import {
  createNameSuggester,
  refreshPreparationNames,
} from './product-vocabulary.js'
import { suggestMaterial, translateMaterial } from './material-vocabulary.js'
import { getItemColorHints } from './color-vocabulary.js'
import { openImageCopyDialog, imageBatchPlans } from './image-copy-dialog.js'
import { mountCopyActions, dismissCopyActionsOnEscape } from './copy-actions.js'
import { reorderHandle, movedKeys } from './packing-reorder.js'
import { reviewPackingChanges } from './packing-review.js'
import { resolvePendingSizeMappings } from './size-vocabulary.js'
import { mountSizeVocabulary } from './size-vocabulary-settings.js'
import { DEFAULT_LABEL_SETTINGS, renderLabel } from './labels.js'
import { mountLabelEditor } from './label-editor.js'
import { createPreparationHistory } from './preparation-history.js'
import { acknowledgePreparation } from './preparation-save.js'
import { createPreparationMedia, preparationHelp } from './preparation-media.js'
import { createRowSelection } from './row-selection.js'
import { copyExcelImage } from './excel-image-copy.js'
import { decorateIcon } from './icons.js'
import {
  showErrorNotice,
  clearErrorNotice,
  clearErrorNotices,
} from './error-notice.js'
import { validateBackup } from './database.js'
import { createPackingBackup } from './packing-backup.js'
import { colorHints } from './color-hints.js'
import { normalizePrice } from './money.js'
import {
  element as el,
  copied,
  yieldUI,
  enableLightDismiss,
  copyTextButton,
} from './ui.js'
import {
  preparationColumns,
  preparationTable,
  writeTable,
  labelClipboard,
} from './preparation-clipboard.js'

const $ = (id) => document.getElementById(id)
const monthLabel = (month) =>
  new Date(`${month}-01T12:00:00Z`).toLocaleDateString(getLocale(), {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
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
  const label = el('label', isMessage(title) ? title : uiMessage(title)),
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
  bindAttribute(input, 'placeholder', placeholder)
  return label
}
function button(text, handler, className) {
  const result = el(
    'button',
    isMessage(text) ? text : uiMessage(text),
    className
  )
  const source = isMessage(text) ? text.source : text
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
  if (buttonIcons[source]) decorateIcon(result, buttonIcons[source])
  result.addEventListener('click', async () => {
    clearErrorNotice()
    try {
      await handler(result)
    } catch (error) {
      showError(error.message)
    }
  })
  return result
}
function showError(message) {
  showErrorNotice(message)
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
  getSelectedRows = getRows,
  headers,
  changed,
  feedback,
  loadImage,
  onProductDetails = () => {},
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
  const scopeEntries = new Map(),
    packingOrders = new Set()
  let copyButtons = [],
    copyActionPanel,
    backupButton,
    opening = false,
    labelOrderId
  const variantPages = new Map()
  const materialFields = new Set()
  onLanguageChange(() => {
    for (const entry of materialFields) {
      if (!entry.input.isConnected) materialFields.delete(entry)
      else if (entry.input !== document.activeElement && !entry.dirty())
        entry.input.value = translateMaterial(entry.value(), getLanguage())
    }
  })
  const selectionStates = new Map()
  let copyScope, preparationImageAbort, selectedOrderTabId, selectedOrderOpening
  function visibleDrafts() {
    return drafts.filter(
      (draft) => !packingOrders.size || packingOrders.has(draft.orderId)
    )
  }
  function scopedGroups(draft) {
    const entries = scopeEntries.get(draft.orderId) || new Set()
    return draft.groups.filter((group) =>
      group.variants.some((variant) =>
        variant.entryIds.some((id) => entries.has(id))
      )
    )
  }
  function scopedVariants(draft, group) {
    const entries = scopeEntries.get(draft.orderId) || new Set()
    return group.variants.filter((variant) =>
      variant.entryIds.some((id) => entries.has(id))
    )
  }
  function materialControl(draft, variants, label, applyLabel) {
    const scope = scopeEntries.get(draft.orderId) || new Set()
    const current = () => {
      const values = new Set(
        variants.flatMap((variant) =>
          variant.entryIds
            .filter((id) => scope.has(id))
            .map((id) => variantMaterial(variant, id).value)
        )
      )
      return {
        value: values.size === 1 ? [...values][0] : '',
        mixed: values.size > 1,
      }
    }
    let edited = false
    const control = el('div', undefined, 'material-control')
    const applyValue = (value) => {
      for (const variant of variants)
        setVariantMaterial(
          variant,
          value,
          variant.entryIds.filter((id) => scope.has(id))
        )
    }
    const edit = field(
      uiMessage('Material'),
      translateMaterial(current().value, getLanguage()),
      (value) => {
        edited = true
        if (applyLabel) apply.disabled = false
        else applyValue(value)
      }
    )
    const input = edit.querySelector('input')
    bindAttribute(input, 'aria-label', uiMessage(label))
    bindAttribute(
      input,
      'placeholder',
      uiMessage(current().mixed ? 'Mixed materials' : 'Enter material')
    )
    input.maxLength = 160
    materialFields.add({
      input,
      value: () => current().value,
      dirty: () => Boolean(applyLabel && edited),
    })
    control.append(
      preparationHelp(
        edit,
        uiMessage(
          'Suggested material is filled from the original product data. Your edits, including an empty value, are kept when preparing again.'
        )
      )
    )
    let apply
    if (applyLabel) {
      apply = prepButton(
        applyLabel,
        () => {
          applyValue(input.value)
          renderPreparation()
        },
        'material-apply text-button'
      )
      apply.disabled = true
      decorateIcon(apply, 'check', {
        iconOnly: true,
        label: uiMessage(applyLabel),
      })
      preparationHelp(
        apply,
        uiMessage(
          applyLabel === 'Apply material to group'
            ? 'Apply this material to the products currently shown for this group.'
            : 'Apply this material to the products currently shown for this order.'
        )
      )
      control.append(apply)
    }
    return control
  }
  function currentPackingMonths() {
    return [
      ...new Set(
        drafts.flatMap((draft) =>
          scopedGroups(draft).map((group) => groupPackingMonth(draft, group))
        )
      ),
    ].sort()
  }
  function packingCopyRows() {
    return visibleDrafts().flatMap(preparationCopyRows)
  }
  function updatePreparationCopyScope() {
    if (!copyScope) return
    const rows = packingCopyRows()
    bindText(
      copyScope,
      rows.length
        ? uiMessage('{0} selected products · {1} orders', {
            0: () => rows.length.toLocaleString(),
            1: new Set(rows.map((row) => row.orderId)).size,
          })
        : uiMessage('Select groups or products to copy')
    )
    for (const target of [...copyButtons, backupButton].filter(Boolean))
      target.disabled =
        !rows.length ||
        Boolean(preparationImageAbort) ||
        target.getAttribute('aria-busy') === 'true'
  }
  function detachPreparationSelection() {
    for (const state of selectionStates.values()) {
      state.cards.clear()
      state.controller.detach()
      for (const variants of state.variants.values())
        variants.controller.detach()
    }
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
        additive: true,
        getKeys: () => state.keys,
        onChange: () => {
          for (const [id, card] of state.cards) {
            if (state.groups.has(id)) {
              state.variants.get(id)?.selected.clear()
              state.variants.get(id)?.controller.paint()
            }
            card.classList.toggle('is-selected', state.groups.has(id))
          }
          updatePreparationCopyScope()
        },
      })
      selectionStates.set(draft.orderId, state)
    }
    state.keys = scopedGroups(draft).map((group) => group.id)
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
          onChange: () => {
            state.groups.delete(group.id)
            state.controller.paint()
            state.cards.get(group.id)?.classList.remove('is-selected')
            updatePreparationCopyScope()
          },
        })
        state.variants.set(group.id, variants)
      }
      variants.keys = scopedVariants(draft, group).map((variant) => variant.id)
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
  let saveTimer, saveWork, saveStatus, reloadPreparationButton, resolveButton
  const pendingSaves = new Set(),
    saveErrors = new Map(),
    codeFields = new Map(),
    resetButtons = new Map()
  function showSaveError(orderId, error) {
    showErrorNotice(error.message || error, {
      scope: $('packing-view'),
      key: `packing:${orderId}`,
      deduplicate: true,
      title: 'Not saved',
      detail: 'Your edits are still here.',
      action:
        error.conflict || error.code === 'PACKING_CODE_CONFLICT'
          ? {
              label: 'Resolve code',
              onClick: () => resolveConflict(orderId, { error }),
            }
          : undefined,
    })
  }
  function updateSaveStatus() {
    if (!saveStatus) return
    const id = [...saveErrors.keys()][0] || drafts[current]?.orderId
    const error = saveErrors.get(id)
    bindText(
      saveStatus,
      error
        ? uiMessage(
            error.code === 'PACKING_CODE_CONFLICT'
              ? 'Not saved · Code conflict'
              : 'Not saved'
          )
        : pendingSaves.has(id) || saveWork
          ? uiMessage('Saving…')
          : preparations.has(id)
            ? uiMessage('Saved automatically')
            : uiMessage('Changes save automatically')
    )
    if (error && !$('packing-view').hidden) showSaveError(id, error)
    saveStatus.classList.toggle('packing-error', Boolean(error))
    if (resolveButton)
      resolveButton.hidden = error?.code !== 'PACKING_CODE_CONFLICT'
    if (reloadPreparationButton) {
      reloadPreparationButton.hidden = !error
      bindText(
        reloadPreparationButton,
        preparations.has(id)
          ? uiMessage('Reload saved version')
          : uiMessage('Discard pending edits')
      )
    }
  }
  function scheduleSave(draft = drafts[current]) {
    if (!draft) return
    pendingSaves.add(draft.orderId)
    saveErrors.delete(draft.orderId)
    clearErrorNotice({
      scope: $('packing-view'),
      key: `packing:${draft.orderId}`,
    })
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
          clearErrorNotice({ scope: $('packing-view'), key: `packing:${id}` })
        } catch (error) {
          pendingSaves.add(id)
          saveErrors.set(id, error)
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
      if (focusId && !$('packing-view').hidden) $(focusId)?.focus()
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
  function createCartonMarkRenderer() {
    const labelSettings = structuredClone(settings())
    const labelLogo = logoUrl()
    return async (source, { signal } = {}) => {
      const rendered = await renderLabel({
        kind: 'mark',
        code: source.baseCode,
        category: source.chineseCategory,
        settings: labelSettings,
        logoUrl: labelLogo,
        signal,
      })
      return rendered.blob
    }
  }
  const media = createPreparationMedia({
    container: null,
    loadImage,
    settings,
    logoUrl,
    getPhotoItems: () =>
      visibleDrafts().flatMap((draft) => {
        const source = getRecords().find(
          ({ snapshot }) => snapshot.orderId === draft.orderId
        )?.snapshot
        const items = new Map(
          (source?.items || []).map((item) => [item.entryId, item])
        )
        const scope = scopeEntries.get(draft.orderId) || new Set()
        return scopedGroups(draft).flatMap((group) =>
          scopedVariants(draft, group).flatMap((variant) =>
            variant.entryIds
              .filter((id) => scope.has(id))
              .map((id) => items.get(id))
              .filter(Boolean)
          )
        )
      }),
  })
  function updateHistoryButtons() {
    const state = history.state()
    if (undoButton) undoButton.disabled = !state.canUndo
    if (redoButton) redoButton.disabled = !state.canRedo
  }
  function checkpoint(mergeKey = null, draft = drafts[current]) {
    if (!draft) return
    const next = JSON.stringify(draft),
      before = checkpoints.get(draft.orderId)
    if (before !== undefined)
      if (history.record(draft.orderId, before, next, mergeKey))
        scheduleSave(draft)
    checkpoints.set(draft.orderId, next)
    updateHistoryButtons()
    const reset = resetButtons.get(draft.orderId)
    if (reset) reset.disabled = !hasDefaultPackingChanges(draft)
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
    const orderId = event.target.closest('[data-packing-order]')?.dataset
      .packingOrder
    if (orderId)
      current = drafts.findIndex((entry) => entry.orderId === orderId)
    if (!editKeys.has(event.target))
      editKeys.set(event.target, crypto.randomUUID())
    checkpoint(editKeys.get(event.target))
    media.refresh()
  })
  $('preparation-content').addEventListener('focusout', () =>
    history.breakGroup()
  )
  async function showOrders() {
    if (preparationBusy) return
    try {
      await flushSaves()
    } catch (error) {
      clearErrorNotice({
        scope: $('packing-view'),
        key: `packing:${[...saveErrors.keys()][0]}`,
      })
      updateSaveStatus()
      if (error.focusId) $(error.focusId)?.focus()
      return
    }
    preparationImageAbort?.abort()
    media.reset()
    detachPreparationSelection()
    clearErrorNotices($('packing-view'))
    copyActionPanel?.destroy()
    copyActionPanel = null
    $('packing-view').hidden = true
    $('orders-view').hidden = false
    document.body.classList.remove('packing-active')
    $('prepare-orders').focus()
  }
  $('label-dialog')
    .querySelector('form')
    .addEventListener('submit', (event) => {
      event.preventDefault()
      const modal = $('label-dialog')
      if (typeof modal.requestClose === 'function') modal.requestClose()
      else if (modal.dispatchEvent(new Event('cancel', { cancelable: true })))
        modal.close()
    })
  $('packing-view').addEventListener(
    'keydown',
    (event) => {
      if (dismissCopyActionsOnEscape(event)) return
      if (
        event.key === 'Escape' &&
        !document.querySelector('dialog[open]') &&
        !event.target.closest('select')
      ) {
        event.preventDefault()
        event.stopPropagation()
        void showOrders()
        return
      }
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== 'a' ||
        event.target.closest('input, textarea, select, [contenteditable]')
      )
        return
      event.preventDefault()
      event.stopPropagation()
      selectPackingRows(true)
    },
    true
  )
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
  async function saved(draft, options = {}) {
    const result = await repository.savePreparation(draft, {
      expectedRevision: draft.revision,
      ...options,
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
    if (!$('packing-view').hidden) await flushSaves()
    let prep = structuredClone(preparations.get(orderId))
    if (!prep) throw new Error('Save the preparation first.')
    const group = prep.groups.find((group) => group.id === groupId),
      variant = group.variants.find((variant) => variant.id === variantId)
    const model = outputModel(prep, group, variant, kind, true)
    editor?.destroy()
    const host = $('label-content')
    host.replaceChildren(
      el(
        'h2',
        kind === 'mark' ? uiMessage('Carton mark') : uiMessage('Barcode label')
      )
    )
    const mount = el('div')
    host.append(mount)
    function labelDraft(next) {
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
      return draft
    }
    function acceptedModel(result) {
      prep = result
      const savedGroup = prep.groups.find((item) => item.id === groupId)
      return outputModel(
        prep,
        savedGroup,
        savedGroup.variants.find((item) => item.id === variantId),
        kind,
        true
      )
    }
    editor = mountLabelEditor(mount, {
      model,
      settings: settings(),
      logoUrl: logoUrl(),
      onValidate: (next) => repository.previewPreparations([labelDraft(next)]),
      onResolve: async (error, next) => {
        const result = await resolveConflict(orderId, {
          candidate: labelDraft(next),
          error,
        })
        return result ? acceptedModel(result) : null
      },
      onCommit: async (next) => acceptedModel(await saved(labelDraft(next))),
      onCopy: async (result) => labelClipboard([result]),
    })
    if (kind === 'mark') {
      const source = getRecords().find(
        (record) => record.snapshot.orderId === orderId
      )?.snapshot
      const ids = new Set(group.variants.flatMap((variant) => variant.entryIds))
      const items = (source?.items || []).filter((item) =>
        ids.has(item.entryId)
      )
      const affected = el('section', undefined, 'label-affected-products')
      affected.append(
        el(
          'p',
          uiMessage(
            '{count} products share this carton mark. Changing its code also changes the start of every barcode below. The Chinese category changes for the whole group.',
            { count: items.length }
          )
        )
      )
      const list = el('div', undefined, 'label-affected-list')
      for (const item of items) {
        const row = el('article', undefined, 'label-affected-item')
        row.append(media.photo(item), el('p', item.description || item.title))
        list.append(row)
      }
      affected.append(list)
      host.append(affected)
    }
    labelOrderId = orderId
    dialog($('label-dialog'))
  }
  $('label-dialog').addEventListener('close', () => {
    media.forget($('label-content'))
    editor?.destroy()
    editor = null
    const index = drafts.findIndex((draft) => draft.orderId === labelOrderId)
    labelOrderId = null
    if (!$('packing-view').hidden && index >= 0) {
      const latest = preparations.get(drafts[index].orderId)
      if (latest) {
        drafts[index] = structuredClone(latest)
        checkpoints.set(latest.orderId, JSON.stringify(latest))
        history.clear(latest.orderId)
      }
      renderPreparation()
    }
  })

  function launchRows(orderId, entryId) {
    if (orderId) {
      const source = getRecords().find(
        (record) => record.snapshot.orderId === orderId
      )?.snapshot
      return (source?.items || [])
        .filter((item) => !entryId || item.entryId === entryId)
        .map((item) => ({ ...item, orderId }))
    }
    const selected = getSelectedRows()
    if (selected.length) return selected
    const result = []
    for (const record of getRecords()) {
      const prep = preparations.get(record.snapshot.orderId)
      if (!prep) continue
      const ids = new Set(
        activeGroups(prep, record.snapshot)
          .filter(
            (group) => groupPackingMonth(prep, group) === monthInput.value
          )
          .flatMap((group) =>
            group.variants.flatMap((variant) => variant.entryIds)
          )
      )
      for (const item of record.snapshot.items)
        if (ids.has(item.entryId))
          result.push({ ...item, orderId: prep.orderId })
    }
    return result
  }
  function reviewChanges(before, after, records = getRecords()) {
    const previous = new Map(
      before.flatMap((draft) =>
        draft.groups.map((group) => [`${draft.orderId}/${group.id}`, group])
      )
    )
    return after.flatMap((draft) => {
      const source = records.find(
        (record) => record.snapshot.orderId === draft.orderId
      )?.snapshot
      return draft.groups.map((group) => {
        const entryIds = group.variants.flatMap((variant) => variant.entryIds)
        const old =
          previous.get(`${draft.orderId}/${group.id}`) ||
          before
            .find((prep) => prep.orderId === draft.orderId)
            ?.groups.find((candidate) =>
              candidate.variants.some((variant) =>
                variant.entryIds.some((id) => entryIds.includes(id))
              )
            )
        return {
          name: group.spanishName || group.title,
          order: `${source?.sellerName || draft.sellerId} · ${draft.orderId}`,
          before: old?.baseCode,
          after: group.baseCode,
          photo: source?.items.find((item) => entryIds.includes(item.entryId)),
          detail: uiMessage('{0} product rows · {1} variants', {
            0: entryIds.length,
            1: group.variants.length,
          }),
        }
      })
    })
  }
  function initializePackingSelection() {
    selectionStates.clear()
    for (const draft of drafts) {
      const state = preparationSelection(draft)
      for (const group of scopedGroups(draft)) state.groups.add(group.id)
      checkpoints.set(draft.orderId, JSON.stringify(draft))
    }
  }
  function packingProgress() {
    const host = el('section', undefined, 'packing-progress')
    bindAttribute(host, 'aria-label', uiMessage('Preparing packing'))
    const stage = el('strong'),
      progress = el('progress'),
      count = el('span'),
      summary = el('p')
    stage.setAttribute('role', 'status')
    bindAttribute(progress, 'aria-label', uiMessage('Preparing packing'))
    host.append(stage, progress, count, summary)
    $('orders-view').prepend(host)
    host.scrollIntoView({ block: 'nearest' })
    return {
      update(label, done, total, counts) {
        bindText(stage, uiMessage(label))
        if (total !== undefined) {
          progress.max = Math.max(1, total)
          progress.value = done
          bindText(
            count,
            uiMessage('{done} / {total} products', { done, total })
          )
        } else {
          progress.removeAttribute('value')
          count.replaceChildren()
        }
        if (counts)
          bindText(
            summary,
            uiMessage(
              'Names {names} · Sizes {sizes} · Colors {colors} · Materials {materials}',
              counts
            )
          )
      },
      remove: () => host.remove(),
    }
  }
  async function openPreparation(orderId, entryId) {
    if (opening) return
    if (preparationBusy)
      throw new Error(
        'Wait for preparation to finish saving before reopening it.'
      )
    opening = true
    updateLaunchActions()
    const progress = packingProgress()
    progress.update('Reading selected products')
    try {
      await yieldUI()
      await flushSaves()
      const rows = launchRows(orderId, entryId)
      if (!rows.length)
        throw new Error(
          'No products are assigned to this packing month. Select products in Orders first.'
        )
      const ids = new Map()
      for (const row of rows) {
        if (!ids.has(row.orderId)) ids.set(row.orderId, [])
        ids.get(row.orderId).push(row.entryId)
      }
      const month = monthInput.value
      const counts = { names: 0, sizes: 0, colors: 0, materials: 0 }
      const sourceOrders = getRecords().filter((record) =>
        ids.has(record.snapshot.orderId)
      )
      const plan = {
        month,
        preparations: [],
        scope: [],
        changes: [],
        orderCount: 0,
        rowCount: 0,
        changedCodeCount: 0,
        splitGroupCount: 0,
      }
      const suggestNames = createNameSuggester(preferences.vocabulary)
      let done = 0
      progress.update('Preparing names and sizes', done, rows.length, counts)
      for (const { snapshot } of sourceOrders) {
        const result = planSelectedPreparations(
          [
            {
              snapshot,
              preparation: preparations.get(snapshot.orderId),
              entryIds: ids.get(snapshot.orderId),
            },
          ],
          month,
          preferences
        )
        for (const draft of result.preparations) {
          const named = refreshPreparationNames(draft, suggestNames)
          const resolved = resolvePendingSizeMappings(
            named,
            preferences.sizeVocabulary
          ).preparation
          plan.preparations.push(resolved)
          const selected = new Set(ids.get(snapshot.orderId))
          for (const group of resolved.groups)
            for (const variant of group.variants)
              for (const id of variant.entryIds)
                if (selected.has(id)) {
                  if (group.spanishName && group.category) counts.names++
                  if (variant.size && !variant.needsSizeMapping) counts.sizes++
                }
        }
        for (const key of ['scope', 'changes']) plan[key].push(...result[key])
        for (const key of [
          'orderCount',
          'rowCount',
          'changedCodeCount',
          'splitGroupCount',
        ])
          plan[key] += result[key]
        done += ids.get(snapshot.orderId).length
        progress.update('Preparing names and sizes', done, rows.length, counts)
        await yieldUI()
      }
      done = 0
      let deadline = performance.now() + 40
      progress.update(
        'Recognizing colors and materials',
        done,
        rows.length,
        counts
      )
      for (const { snapshot } of sourceOrders) {
        const selected = new Set(ids.get(snapshot.orderId))
        const materialSuggestions = new Map()
        for (const item of snapshot.items) {
          if (!selected.has(item.entryId)) continue
          if (getItemColorHints(item).length) counts.colors++
          materialSuggestions.set(item.entryId, suggestMaterial(item))
          done++
          if (performance.now() >= deadline) {
            progress.update(
              'Recognizing colors and materials',
              done,
              rows.length,
              counts
            )
            await yieldUI()
            deadline = performance.now() + 40
          }
        }
        const index = plan.preparations.findIndex(
          (draft) => draft.orderId === snapshot.orderId
        )
        // Update suggestions only for this open packing selection.
        const draft = refreshPreparationMaterials(
          plan.preparations[index],
          {
            ...snapshot,
            items: snapshot.items.filter((item) => selected.has(item.entryId)),
          },
          materialSuggestions
        )
        plan.preparations[index] = draft
        for (const group of draft.groups)
          for (const variant of group.variants)
            for (const id of variant.entryIds)
              if (selected.has(id) && variantMaterial(variant, id).value)
                counts.materials++
        progress.update(
          'Recognizing colors and materials',
          done,
          rows.length,
          counts
        )
        await yieldUI()
      }
      const movedOrderIds = [
        ...new Set(
          plan.changes
            .filter((change) => change.oldCode)
            .map((change) => change.orderId)
        ),
      ]
      const hasMove = movedOrderIds.length > 0
      let candidates = plan.preparations
      const eligible = candidates.filter((draft) => draft.sellerId.trim())
      if (hasMove && eligible.length !== candidates.length)
        throw new Error(
          'Some selected orders have no identified seller. Prepare those orders separately and enter their seller member login before moving this selection to a different packing month. No codes have changed.'
        )
      const options = {
        capturePrevious: movedOrderIds,
        resetDefaults: movedOrderIds,
        expectedRevisions: eligible.map((draft) => draft.revision || 0),
        preserveNaming: true,
      }
      if (eligible.length) {
        progress.update('Checking product codes', undefined, undefined, counts)
        await yieldUI()
        const previews = new Map(
          (await repository.previewPreparations(eligible, options)).map(
            (draft) => [draft.orderId, draft]
          )
        )
        candidates = candidates.map(
          (draft) => previews.get(draft.orderId) || draft
        )
      }
      if (eligible.length && (hasMove || plan.changes.length > 1)) {
        progress.update(
          'Review changes to continue',
          undefined,
          undefined,
          counts
        )
        const relevant = new Set(
          plan.changes.map((change) => change.orderId + '/' + change.groupId)
        )
        const after = candidates.map((draft) => ({
          ...draft,
          groups: draft.groups.filter((group) =>
            relevant.has(draft.orderId + '/' + group.id)
          ),
        }))
        if (
          !(await reviewPackingChanges({
            title: hasMove
              ? uiMessage('Move selected products to this packing month?')
              : uiMessage('Assign product codes?'),
            explanation: uiMessage(
              '{rows} selected product rows from {orders} orders will be prepared for {month}. {detail}',
              {
                rows: plan.rowCount,
                orders: plan.orderCount,
                month: () => monthLabel(month),
                detail: hasMove
                  ? uiMessage(
                      '{codes} group codes and their barcodes will change. {splits} partial groups will be split; unselected products keep their month and codes. Previous issued codes remain reserved. You can restore the previous packing later.',
                      {
                        codes: plan.changedCodeCount,
                        splits: plan.splitGroupCount,
                      }
                    )
                  : uiMessage(
                      'New codes will be assigned to the groups below. Orders without a seller remain editable and receive codes after you identify the seller.'
                    ),
              }
            ),
            changes: reviewChanges([...preparations.values()], after),
            proceed: hasMove
              ? uiMessage('Change codes and prepare')
              : uiMessage('Assign codes and prepare'),
            media,
          }))
        )
          return
      }
      if (eligible.length) {
        progress.update('Saving packing data', undefined, undefined, counts)
        await yieldUI()
        const savedOrders = new Map(
          (
            await repository.savePreparations(
              candidates.filter((draft) => draft.sellerId.trim()),
              options
            )
          ).map((draft) => [draft.orderId, draft])
        )
        candidates = candidates.map(
          (draft) => savedOrders.get(draft.orderId) || draft
        )
        await reload()
        channel?.postMessage('changed')
        changed()
      }
      drafts = candidates
      scopeEntries.clear()
      for (const scope of plan.scope)
        scopeEntries.set(scope.orderId, new Set(scope.entryIds))
      packingOrders.clear()
      if (drafts.length === 1) packingOrders.add(drafts[0].orderId)
      current = 0
      groupPage = 0
      history.clear()
      checkpoints.clear()
      initializePackingSelection()
      progress.update('Displaying packing', undefined, undefined, counts)
      await yieldUI()
      $('orders-view').hidden = true
      $('packing-view').hidden = false
      document.body.classList.add('packing-active')
      renderPreparation()
      for (const draft of drafts)
        if (!draft.sellerId.trim()) scheduleSave(draft)
      $('packing-view').scrollIntoView({ block: 'start' })
    } finally {
      progress.remove()
      opening = false
      updateLaunchActions()
    }
  }
  async function saveDraft(index) {
    if (!drafts[index].sellerId.trim()) {
      throw Object.assign(
        new Error('Enter the seller member login to assign label codes.'),
        { focusId: `preparation-seller-${drafts[index].orderId}` }
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
    if (!$('packing-view').hidden) {
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
  function selectPackingRows(select) {
    for (const draft of visibleDrafts()) {
      const state = preparationSelection(draft)
      state.groups.clear()
      for (const variants of state.variants.values()) variants.selected.clear()
      if (select)
        for (const group of scopedGroups(draft)) state.groups.add(group.id)
    }
    renderPreparation()
  }
  async function openSelectedSource() {
    if (packingOrders.size !== 1 || selectedOrderOpening) return
    const orderId = [...packingOrders][0]
    const source = getRecords().find(
      (record) => record.snapshot.orderId === orderId
    )?.snapshot
    if (!source) return
    selectedOrderOpening = true
    try {
      if (!globalThis.chrome?.tabs) {
        window.open(source.sourceUrl, '1688-selected-order', 'noopener')
        return
      }
      if (selectedOrderTabId) {
        try {
          await chrome.tabs.get(selectedOrderTabId)
        } catch {
          selectedOrderTabId = null
        }
      }
      if (selectedOrderTabId)
        await chrome.tabs.update(selectedOrderTabId, {
          url: source.sourceUrl,
          active: true,
        })
      else
        selectedOrderTabId = (
          await chrome.tabs.create({ url: source.sourceUrl, active: true })
        ).id
    } finally {
      selectedOrderOpening = false
    }
  }
  async function reloadSavedOrder(orderId) {
    await reload()
    const index = drafts.findIndex((draft) => draft.orderId === orderId)
    const latest = preparations.get(orderId)
    if (index < 0) return
    if (latest) drafts[index] = structuredClone(latest)
    else {
      drafts.splice(index, 1)
      scopeEntries.delete(orderId)
      packingOrders.delete(orderId)
      selectionStates.delete(orderId)
    }
    pendingSaves.delete(orderId)
    saveErrors.delete(orderId)
    clearErrorNotice({ scope: $('packing-view'), key: `packing:${orderId}` })
    history.clear(orderId)
    if (latest) checkpoints.set(orderId, JSON.stringify(latest))
    else checkpoints.delete(orderId)
    renderPreparation()
  }
  function acceptDraft(result) {
    const index = drafts.findIndex((draft) => draft.orderId === result.orderId)
    if (index >= 0) drafts[index] = structuredClone(result)
    pendingSaves.delete(result.orderId)
    saveErrors.delete(result.orderId)
    clearErrorNotice({
      scope: $('packing-view'),
      key: `packing:${result.orderId}`,
    })
    history.clear(result.orderId)
    checkpoints.set(result.orderId, JSON.stringify(result))
  }
  async function restorePacking(draft, previous) {
    if (!previous && !hasDefaultPackingChanges(draft)) return
    const restore = previous ? restorePreviousPacking : restoreDefaultPacking
    const [candidate] = await repository.previewPreparations([restore(draft)], {
      preserveNaming: true,
    })
    if (
      !(await reviewPackingChanges({
        title: previous
          ? uiMessage('Restore previous packing?')
          : uiMessage('Reset order and codes?'),
        explanation: previous
          ? uiMessage(
              'This replaces this order’s current grouping, codes, names and variant settings with the setup saved before its last month move. Later edits will be lost. Other orders are unchanged; old issued codes remain reserved.'
            )
          : uiMessage(
              'This restores this order’s default grouping, source order, product codes and barcode endings. Current names are retained where their groups still exist. Manual reordering and code edits will be replaced. Other orders are unchanged.'
            ),
        changes: previous
          ? reviewChanges([draft], [candidate])
          : resetReviewChanges(draft, candidate),
        proceed: previous
          ? uiMessage('Restore previous packing')
          : uiMessage('Reset order and codes'),
        media,
      }))
    )
      return
    const result = await saved(candidate, {
      expectedRevision: draft.revision,
      preserveNaming: true,
    })
    acceptDraft(result)
    const source = getRecords().find(
      (record) => record.snapshot.orderId === result.orderId
    )?.snapshot
    scopeEntries.set(
      result.orderId,
      new Set(
        activeGroups(result, source).flatMap((group) =>
          group.variants.flatMap((variant) => variant.entryIds)
        )
      )
    )
    selectionStates.delete(result.orderId)
    const state = preparationSelection(result)
    for (const group of scopedGroups(result)) state.groups.add(group.id)
    renderPreparation()
  }
  function resetReviewChanges(draft, candidate) {
    const standard = reviewChanges([draft], [candidate])
    return defaultPackingChanges(draft).map((change) => {
      const group = change.after || change.before
      const card = standard.find((entry) => entry.after === group.baseCode) || {
        name: group.spanishName || group.title,
        before: change.before?.baseCode,
        after: change.after?.baseCode,
      }
      const details = []
      if (change.orderChanged)
        details.push(
          uiMessage('Position {before} → {after}', {
            before: change.beforePosition,
            after: change.afterPosition,
          })
        )
      if (change.variantOrderChanged)
        details.push(uiMessage('Restore original product order'))
      if (change.groupingChanged)
        details.push(uiMessage('Restore original grouping'))
      if (change.clearedManualOrdering)
        details.push(uiMessage('Clear manual sorting'))
      for (const code of change.barcodeChanges)
        details.push(`${code.before || '—'} → ${code.after || '—'}`)
      return {
        ...card,
        detail: uiMessage('{0}', { 0: () => details.map(String).join(' · ') }),
      }
    })
  }
  async function removePackingProducts(draft, entryIds) {
    const ids = [...new Set(entryIds)]
    if (!ids.length) return
    const source = getRecords().find(
      (record) => record.snapshot.orderId === draft.orderId
    )?.snapshot
    const changes = ids.map((id) => {
      const item = source?.items.find((item) => item.entryId === id)
      const group = draft.groups.find((group) =>
        group.variants.some((variant) => variant.entryIds.includes(id))
      )
      return {
        name: item?.description || group?.title,
        photo: item,
        before: group?.baseCode,
        after: uiMessage('Removed from packing'),
        order: source?.sellerName,
      }
    })
    if (
      !(await reviewPackingChanges({
        title: uiMessage('Remove from packing?'),
        explanation: uiMessage(
          '{count} selected products will be removed from this packing. Their original order data and issued codes are kept. You can select them in Orders to prepare them again.',
          { count: ids.length }
        ),
        changes,
        proceed: uiMessage('Remove from packing'),
        media,
      }))
    )
      return
    const result = await saved(removeSelectedProducts(draft, ids))
    acceptDraft(result)
    const scope = scopeEntries.get(draft.orderId)
    for (const id of ids) scope?.delete(id)
    selectionStates.delete(draft.orderId)
    renderPreparation()
    updateLaunchActions()
  }
  function requireCompleteGroups(draft, groups) {
    const scope = scopeEntries.get(draft.orderId) || new Set()
    if (
      groups.some((group) =>
        group.variants.some((variant) =>
          variant.entryIds.some((id) => !scope.has(id))
        )
      )
    )
      throw new Error(
        'These groups include products outside this packing selection. Select all their products in Orders before changing their grouping.'
      )
    if (
      new Set(groups.map((group) => groupPackingMonth(draft, group))).size > 1
    )
      throw new Error(
        'Groups from different packing months cannot be merged. Move the selected products to the same packing month first.'
      )
  }
  async function reviewGroupEdit(draft, candidate, title, explanation) {
    const [preview] = await repository.previewPreparations([candidate])
    if (
      !(await reviewPackingChanges({
        title,
        explanation,
        changes: reviewChanges([draft], [preview]),
        proceed: uiMessage('Apply changes'),
        media,
      }))
    )
      return
    const result = await saved(preview, { expectedRevision: draft.revision })
    acceptDraft(result)
    selectionStates.delete(result.orderId)
    const state = preparationSelection(result)
    for (const group of scopedGroups(result)) state.groups.add(group.id)
    renderPreparation()
  }
  async function resolveConflict(orderId, options = {}) {
    clearErrorNotice({ scope: $('packing-view'), key: `packing:${orderId}` })
    const index = drafts.findIndex((draft) => draft.orderId === orderId),
      draft = options.candidate || drafts[index]
    if (!draft) return
    const error = options.error || saveErrors.get(orderId)
    let resolved = null
    const code =
      error?.conflict?.code || error?.message?.match(/CE\d{8}[A-Z0-9]*/)?.[0]
    const previous = preparations.get(orderId)
    const requestedGroupId = error?.conflict?.requestedOwner?.groupId
    let group =
      draft.groups.find(
        (entry) =>
          entry.baseCode &&
          code?.startsWith(entry.baseCode) &&
          previous?.groups.find((old) => old.id === entry.id)?.baseCode !==
            entry.baseCode
      ) || draft.groups.find((entry) => entry.id === requestedGroupId)
    const modal = el('dialog', undefined, 'packing-review code-conflict-dialog')
    bindAttribute(modal, 'aria-label', uiMessage('Resolve code conflict'))
    modal.append(
      el('h2', uiMessage('Resolve code conflict')),
      el(
        'p',
        code
          ? uiMessage(
              '{0} is already reserved. A code stays with the product it was first issued to, even after that product changes codes or is removed.',
              { 0: code }
            )
          : uiMessage(
              error?.message || 'Review the product codes in this order.'
            )
      )
    )
    const evidence = el('div', undefined, 'conflict-evidence')
    const ownership = code
      ? await repository.queryCodeOwnership(code, {
          accountId: draft.accountId,
        })
      : { owners: [] }
    let conflictingVariant
    if (error?.conflict?.kind === 'barcode') {
      // Owner matching is diagnostic. Incomplete sizes or another unfinished
      // code must not prevent resolving this collision; saving still validates
      // the complete edited preparation and its reservations.
      const comparableBarcode = (entry, variant) => {
        if (!entry || !variant) return null
        try {
          return barcodeValue(entry, variant)
        } catch {
          return null
        }
      }
      const candidates = draft.groups.flatMap((entry) =>
        entry.variants
          .filter((variant) => comparableBarcode(entry, variant) === code)
          .map((variant) => ({ group: entry, variant }))
      )
      // Validation may encounter the unchanged owner after the edited row.
      // Resolve the changed row, regardless of its position in the group.
      const edited =
        candidates.find(({ group, variant }) => {
          const savedGroup = previous?.groups.find(
            (entry) => entry.id === group.id
          )
          const savedVariant = savedGroup?.variants.find(
            (entry) => entry.id === variant.id
          )
          return (
            comparableBarcode(savedGroup, savedVariant) !== code &&
            !ownership.owners.some(
              (owner) =>
                owner.kind === 'barcode' &&
                owner.orderId === orderId &&
                owner.groupId === group.id &&
                owner.variantId === variant.id
            )
          )
        }) ||
        candidates.find(
          ({ variant }) =>
            variant.id === error.conflict.requestedOwner?.variantId
        )
      if (edited) {
        group = edited.group
        conflictingVariant = edited.variant
      }
    }
    for (const owner of ownership.owners.filter(
      (entry) => entry.kind === (error?.conflict?.kind || 'base')
    )) {
      const card = el('article', undefined, 'packing-review-item')
      if (owner.photos[0])
        card.append(
          media.photo({
            thumbnail: owner.photos[0],
            description: owner.groupTitle || owner.spanishName,
          })
        )
      const details = el('div')
      details.append(
        el(
          'strong',
          owner.spanishName || owner.groupTitle || uiMessage('Original product')
        ),
        el('p', `${owner.sellerName} · ${owner.orderId}`),
        el('code', code),
        el(
          'p',
          owner.status === 'active'
            ? uiMessage('Currently used by this product.')
            : owner.currentBaseCode
              ? uiMessage(
                  'Previously issued here. This product now uses {0}. That is why the old code is absent from the product table.',
                  { 0: owner.currentBaseCode }
                )
              : uiMessage(
                  'Previously issued to a product that has been regrouped or removed. The reservation remains to prevent duplicate labels.'
                )
        )
      )
      if (owner.orderExists && owner.groupExists && !options.candidate)
        details.append(
          button(uiMessage('Show owning product'), async () => {
            modal.close()
            // Keep pending edits while revealing the owner; no reload or restore.
            let ownerDraft = drafts.find(
              (entry) => entry.orderId === owner.orderId
            )
            if (!ownerDraft) {
              ownerDraft = structuredClone(preparations.get(owner.orderId))
              if (ownerDraft) drafts.push(ownerDraft)
            }
            if (!ownerDraft) return
            const ownerGroup = ownerDraft.groups.find(
              (entry) => entry.id === owner.groupId
            )
            const entries = scopeEntries.get(owner.orderId) || new Set()
            for (const variant of ownerGroup?.variants || [])
              for (const id of variant.entryIds) entries.add(id)
            scopeEntries.set(owner.orderId, entries)
            packingOrders.clear()
            packingOrders.add(owner.orderId)
            groupPage = Math.floor(
              scopedGroups(ownerDraft).findIndex(
                (entry) => entry.id === owner.groupId
              ) / 20
            )
            renderPreparation()
            document
              .querySelector(`[data-group-id="${owner.groupId}"]`)
              ?.scrollIntoView({ block: 'center' })
          })
        )
      card.append(details)
      evidence.append(card)
    }
    if (group) {
      const source = getRecords().find(
        (record) => record.snapshot.orderId === orderId
      )?.snapshot
      const target = el('article', undefined, 'packing-review-item')
      const item = source?.items.find((item) =>
        group.variants.some((variant) =>
          variant.entryIds.includes(item.entryId)
        )
      )
      if (item) target.append(media.photo(item))
      const description = el('div')
      description.append(
        el('strong', uiMessage('Product you are editing')),
        el('p', group.spanishName || group.title),
        el('code', group.baseCode)
      )
      target.append(description)
      evidence.append(target)
    }
    const actions = el('div', undefined, 'dialog-actions')
    if (group)
      actions.append(
        button(
          conflictingVariant
            ? uiMessage('Use next available variant code')
            : uiMessage('Use next available code'),
          async () => {
            let candidate
            if (conflictingVariant) {
              candidate = structuredClone(draft)
              const editedGroup = candidate.groups.find(
                (entry) => entry.id === group.id
              )
              const editedVariant = editedGroup.variants.find(
                (entry) => entry.id === conflictingVariant.id
              )
              const used = new Set(
                editedGroup.variants
                  .filter((entry) => entry.id !== editedVariant.id)
                  .map((entry) => entry.variantSuffix + entry.sizeSuffix)
              )
              for (const code of await repository.getReservedBarcodes(
                editedGroup.baseCode,
                { accountId: candidate.accountId }
              ))
                used.add(code.slice(editedGroup.baseCode.length))
              editedVariant.variantSuffix = unusedSuffix(
                used,
                editedVariant.sizeSuffix
              )
            } else candidate = regeneratePreparationCode(draft, group.id)
            const result = await saved(candidate)
            resolved = result
            if (!options.candidate) acceptDraft(result)
            modal.close()
            if (!options.candidate) renderPreparation()
          },
          'primary'
        )
      )
    if (previous)
      actions.append(
        button(uiMessage('Keep saved version'), async () => {
          if (options.candidate) resolved = previous
          else await reloadSavedOrder(orderId)
          modal.close()
        })
      )
    actions.append(button(uiMessage('Continue editing'), () => modal.close()))
    modal.append(evidence, actions)
    const closed = new Promise((resolve) =>
      modal.addEventListener(
        'close',
        () => {
          media.forget(evidence)
          modal.remove()
          resolve(resolved)
        },
        { once: true }
      )
    )
    enableLightDismiss(modal)
    document.body.append(modal)
    modal.showModal()
    return closed
  }
  function watchCodeFields(inputs, draft, host) {
    const notice = el('div', undefined, 'code-field-error')
    notice.hidden = true
    const text = el('span', undefined, 'code-error-description')
    const summary = el('span')
    text.id = `code-error-${crypto.randomUUID()}`
    let timer,
      version = 0,
      issue = null
    const resolve = button(uiMessage('Resolve code'), () =>
      resolveConflict(draft.orderId, { error: issue })
    )
    resolve.addEventListener('pointerdown', (event) => {
      if (event.button === 0) event.preventDefault()
    })
    notice.append(summary, text, resolve)
    host.append(notice)
    function show(error) {
      issue = error
      notice.hidden = !error
      resolve.hidden = !error?.conflict
      if (error) {
        bindText(text, uiMessage(error.message))
        bindText(
          summary,
          uiMessage(error.conflict ? 'Code conflict' : 'Check code')
        )
        showSaveError(draft.orderId, error)
      } else
        clearErrorNotice({
          scope: $('packing-view'),
          key: `packing:${draft.orderId}`,
        })
      for (const input of inputs)
        if (error) {
          input.setAttribute('aria-invalid', 'true')
          input.setAttribute('aria-errormessage', text.id)
        } else {
          input.removeAttribute('aria-invalid')
          input.removeAttribute('aria-errormessage')
        }
    }
    const validate = ({ currentTarget: input }) => {
      clearTimeout(timer)
      const current = ++version
      show(null)
      timer = setTimeout(async () => {
        if (!input.isConnected) return
        const snapshot = JSON.stringify(draft)
        try {
          await repository.previewPreparations([JSON.parse(snapshot)])
        } catch (error) {
          if (
            input.isConnected &&
            current === version &&
            snapshot === JSON.stringify(draft)
          )
            show(error)
        }
      }, 180)
    }
    for (const input of inputs) input.addEventListener('input', validate)
  }
  function renderPackingHeader(host) {
    const header = el('header', undefined, 'packing-view-header')
    const back = button(uiMessage('Orders'), showOrders, 'text-button')
    decorateIcon(back, 'previous')
    const heading = el('div', undefined, 'packing-title')
    const months = currentPackingMonths()
    heading.append(
      el('h1', uiMessage('Prepare packing list')),
      el(
        'p',
        uiMessage('{0} · {1} orders · {2} products', {
          0: () => months.map(monthLabel).join(' · '),
          1: drafts.length,
          2: [...scopeEntries.values()].reduce((sum, ids) => sum + ids.size, 0),
        })
      )
    )
    const actions = el('div', undefined, 'preparation-actions')
    undoButton = prepButton('Undo', () => travel('undo'))
    redoButton = prepButton('Redo', () => travel('redo'))
    saveStatus = el('span', '', 'preparation-save-status')
    saveStatus.setAttribute('role', 'status')
    resolveButton = button(uiMessage('Resolve'), () =>
      resolveConflict([...saveErrors.keys()][0])
    )
    reloadPreparationButton = prepButton('Reload saved version', () =>
      reloadSavedOrder([...saveErrors.keys()][0])
    )
    actions.append(
      undoButton,
      redoButton,
      saveStatus,
      resolveButton,
      reloadPreparationButton
    )
    header.append(back, heading, actions)
    const commandBar = el('div', undefined, 'packing-command-bar')
    commandBar.append(header)
    const toolbar = el('div', undefined, 'packing-top-tools')
    const filter = el('select')
    bindAttribute(filter, 'aria-label', uiMessage('Show packing orders'))
    filter.name = 'packing-order'
    filter.className = 'packing-order-picker'
    const richPicker = CSS.supports('appearance', 'base-select')
    if (richPicker) {
      const selected = el('button')
      selected.type = 'button'
      selected.append(el('selectedcontent'))
      filter.append(selected)
      // Native selectedcontent snapshots the option before cached photos resolve.
      // Refresh that snapshot when the selected option's own image is ready.
      filter.addEventListener(
        'load',
        (event) => {
          const option = event.target.closest?.('option')
          if (option?.selected)
            selected
              .querySelector('selectedcontent')
              .replaceChildren(
                ...Array.from(option.childNodes, (node) => node.cloneNode(true))
              )
        },
        true
      )
    }
    const allOrders = new Option('', '')
    bindText(allOrders, uiMessage('All {0} orders', { 0: drafts.length }))
    filter.append(allOrders)
    for (const draft of drafts) {
      const source = getRecords().find(
        (record) => record.snapshot.orderId === draft.orderId
      )?.snapshot
      const categories = [
        ...new Set(scopedGroups(draft).map((group) => group.spanishName)),
      ].filter(Boolean)
      const sellerName =
        source?.sellerName || draft.sellerId || 'Seller unavailable'
      const option = new Option(
        `${sellerName} · ${categories.join(', ')}`,
        draft.orderId
      )
      if (richPicker) {
        const photos = el('span', undefined, 'packing-order-photos')
        const items =
          source?.items.filter((item) =>
            scopeEntries.get(draft.orderId)?.has(item.entryId)
          ) || []
        for (const item of [
          ...new Map(
            items
              .filter((item) => item.thumbnail)
              .map((item) => [item.thumbnail, item])
          ).values(),
        ].slice(0, 3))
          photos.append(media.photo(item, { interactive: false }))
        const text = el('span', undefined, 'packing-order-caption')
        text.append(
          el('strong', sellerName),
          el('small', categories.join(' · '))
        )
        option.replaceChildren(photos, text)
      }
      filter.append(option)
    }
    filter.value = packingOrders.size === 1 ? [...packingOrders][0] : ''
    filter.onchange = () => {
      packingOrders.clear()
      if (filter.value) packingOrders.add(filter.value)
      groupPage = 0
      renderPreparation()
    }
    const open = button(
      uiMessage('Open selected order'),
      openSelectedSource,
      'open-selected-order'
    )
    decorateIcon(open, 'external')
    open.disabled = packingOrders.size !== 1
    const selectAll = button(uiMessage('Select all'), () =>
        selectPackingRows(true)
      ),
      clear = button(uiMessage('Clear selection'), () =>
        selectPackingRows(false)
      )
    toolbar.append(filter, open, selectAll, clear)
    commandBar.append(toolbar)
    const output = el('div', undefined, 'preparation-output')
    copyScope = el('span', '', 'packing-help preparation-copy-scope')
    const imageCopy = button(uiMessage('Copy Excel image'), async (target) => {
      if (preparationImageAbort) return
      const selectedRows = packingCopyRows()
      if (!selectedRows.length) return
      const abort = new AbortController()
      try {
        await copied(target, async () => {
          preparationImageAbort = abort
          updatePreparationCopyScope()
          await flushSaves()
          if (abort.signal.aborted) return false
          const rows = preparedRows(selectedRows)
          return await copyExcelImage(rows, {
            loadImage,
            renderCartonMark: createCartonMarkRenderer(),
            signal: abort.signal,
          })
        })
      } finally {
        preparationImageAbort = null
        updatePreparationCopyScope()
      }
    })
    const columns = button(uiMessage('Copy columns'), async () => {
      const selectedRows = packingCopyRows()
      await flushSaves()
      await copyPreparation(preparedRows(selectedRows))
    })
    decorateIcon(columns, 'copy')
    const codes = button(uiMessage('Copy group codes'), async (target) => {
      const selectedRows = packingCopyRows()
      try {
        await copied(target, async () => {
          await flushSaves()
          const codes = [
            ...new Set(
              preparedRows(selectedRows)
                .map((row) => row.baseCode)
                .filter(Boolean)
            ),
          ]
          if (!codes.length) return false
          await navigator.clipboard.writeText(codes.join('\r\n'))
        })
      } finally {
        updatePreparationCopyScope()
      }
    })
    decorateIcon(codes, 'copy')
    const copyLabels = (kind) => {
      const selectedRows = packingCopyRows()
      return preparationAction(() => bulkLabels(kind, selectedRows))
    }
    copyButtons = [
      columns,
      codes,
      imageCopy,
      button(uiMessage('Copy barcode images'), () => copyLabels('barcode')),
      button(uiMessage('Copy carton marks'), () => copyLabels('mark')),
    ]
    const copyNames = [
      ['Copy columns', 'Chosen columns', 'columns'],
      ['Copy group codes', 'Group codes', 'copy'],
      ['Copy Excel image', 'Excel image', 'image'],
      ['Copy barcode images', 'Barcodes', 'barcode'],
      ['Copy carton marks', 'Carton marks', 'carton'],
    ]
    copyButtons.forEach((target, index) => {
      const [full, short, symbol] = copyNames[index]
      bindText(target, uiMessage(short))
      bindAttribute(target, 'aria-label', uiMessage(full))
      decorateIcon(target, symbol)
      preparationHelp(target, uiMessage(full))
    })
    const backup = button(uiMessage('Back up packing'), async (target) => {
      const rows = packingCopyRows()
      if (!rows.length) return
      await flushSaves()
      const selection = new Map()
      for (const row of rows) {
        if (!selection.has(row.orderId)) selection.set(row.orderId, new Set())
        selection.get(row.orderId).add(row.entryId)
      }
      const months = [
        ...new Set(
          [...selection].flatMap(([orderId, ids]) => {
            const prep = preparations.get(orderId)
            return prep.groups
              .filter((group) =>
                group.variants.some((variant) =>
                  variant.entryIds.some((id) => ids.has(id))
                )
              )
              .map((group) => groupPackingMonth(prep, group))
          })
        ),
      ].sort()
      const backup = createPackingBackup(
        await repository.exportBackup({ orderIds: [...selection.keys()] }),
        {
          months,
          orders: [...selection].map(([orderId, ids]) => ({
            accountId: preparations.get(orderId).accountId,
            orderId,
            entryIds: [...ids],
          })),
        }
      )
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(backup)], { type: 'application/json' })
      )
      const a = el('a')
      a.href = url
      a.download = `1688-packing-${months.length === 1 ? months[0] : 'mixed-months'}.json`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 60000)
      feedback(uiMessage('Packing backup saved'))
    })
    backupButton = backup
    decorateIcon(backup, 'download')
    preparationHelp(
      backup,
      uiMessage(
        'Back up selected groups and products only. Complete source orders and issued codes are retained so totals and code ownership can be restored safely.'
      )
    )
    const restoreFile = el('input')
    restoreFile.type = 'file'
    restoreFile.accept = '.json,application/json'
    restoreFile.hidden = true
    bindAttribute(restoreFile, 'aria-label', uiMessage('Packing backup file'))
    restoreFile.addEventListener('change', () => {
      const file = restoreFile.files[0]
      restoreFile.value = ''
      if (file)
        void preparationAction(() => restorePackingFile(file)).catch((error) =>
          showError(error.message)
        )
    })
    const restore = button(
      uiMessage('Restore packing'),
      () => restoreFile.click(),
      'text-button'
    )
    decorateIcon(restore, 'upload')
    preparationHelp(
      restore,
      uiMessage(
        'Open a packing backup. Missing orders and newer saved edits are restored; newer local edits and issued codes stay protected.'
      )
    )
    const copyActions = el('div', undefined, 'packing-copy-actions')
    copyActions.append(imageCopy)
    copyActionPanel = mountCopyActions(copyActions, {
      image: imageCopy,
      groups: [
        { label: 'Packing', actions: [columns, codes] },
        { label: 'Labels & codes', actions: copyButtons.slice(3) },
      ],
    })
    output.append(copyScope, copyActions)
    const files = el('div', undefined, 'packing-file-actions')
    files.append(backup, restore, restoreFile)
    output.append(files)
    commandBar.append(output)
    host.append(commandBar)
  }
  async function restorePackingFile(file) {
    await flushSaves()
    const input = JSON.parse(await file.text())
    const backup = validateBackup(input)
    const scope = backup.packingScope
    if (!scope)
      throw new Error(
        'Choose a file created by Back up packing. Use Settings → Data → Restore for a full-library backup.'
      )
    const newer = backup.preparations.filter((incoming) => {
      const local = preparations.get(incoming.orderId)
      return !local || incoming.updatedAt > local.updatedAt
    })
    const count = scope.orders.reduce(
      (sum, order) => sum + order.entryIds.length,
      0
    )
    const changes = reviewChanges(
      [...preparations.values()],
      newer,
      backup.orders
    )
    if (!changes.length) {
      for (const order of scope.orders) {
        const record = backup.orders.find(
          (record) => record.snapshot.orderId === order.orderId
        )
        changes.push({
          name: record.snapshot.sellerName,
          order: order.orderId,
          photo: record.snapshot.items.find((item) =>
            order.entryIds.includes(item.entryId)
          ),
          before: uiMessage('Current saved data'),
          after: uiMessage('Keep newer edits'),
          detail: uiMessage('{0} selected products', {
            0: order.entryIds.length,
          }),
        })
      }
    }
    if (
      !(await reviewPackingChanges({
        title: uiMessage('Restore packing backup?'),
        explanation: uiMessage(
          '{0} products from {1} orders will reopen. {2} orders can receive selected packing edits from this file. Unselected products, newer local edits and existing settings stay unchanged. Source orders and issued codes are retained for safe restoration.',
          { 0: count, 1: scope.orders.length, 2: newer.length }
        ),
        changes,
        proceed: uiMessage('Restore packing'),
        media,
      }))
    )
      return
    await repository.restoreBackup(input)
    await changed({ reload: true })
    await reload()
    drafts = scope.orders
      .map((order) => preparations.get(order.orderId))
      .filter(Boolean)
      .map((draft) => structuredClone(draft))
    scopeEntries.clear()
    for (const order of scope.orders)
      scopeEntries.set(order.orderId, new Set(order.entryIds))
    packingOrders.clear()
    if (drafts.length === 1) packingOrders.add(drafts[0].orderId)
    const restoredMonths = currentPackingMonths()
    if (restoredMonths.length === 1) monthInput.value = restoredMonths[0]
    current = 0
    groupPage = 0
    history.clear()
    checkpoints.clear()
    selectionStates.clear()
    initializePackingSelection()
    $('orders-view').hidden = true
    $('packing-view').hidden = false
    document.body.classList.add('packing-active')
    renderPreparation()
    updateLaunchActions()
    channel?.postMessage('changed')
    feedback(uiMessage('Packing restored. Newer local edits were kept.'))
  }
  function renderPreparation() {
    preparationImageAbort?.abort()
    clearErrorNotices($('packing-view'))
    copyActionPanel?.destroy()
    copyActionPanel = null
    for (const draft of drafts) checkpoint(null, draft)
    media.reset()
    codeFields.clear()
    resetButtons.clear()
    detachPreparationSelection()
    materialFields.clear()
    const host = $('preparation-content')
    host.replaceChildren()
    renderPackingHeader(host)
    const groups = visibleDrafts().flatMap((draft) =>
      scopedGroups(draft).map((group) => ({ draft, group }))
    )
    groupPage = Math.min(
      groupPage,
      Math.max(0, Math.ceil(groups.length / 20) - 1)
    )
    const pageGroups = groups.slice(groupPage * 20, (groupPage + 1) * 20)
    const body = el('div', undefined, 'packing-order-sections')
    for (const draft of visibleDrafts()) {
      const selected = pageGroups
        .filter((entry) => entry.draft === draft)
        .map((entry) => entry.group)
      if (!selected.length) continue
      const orderHost = el('section', undefined, 'packing-order-section')
      orderHost.dataset.packingOrder = draft.orderId
      body.append(orderHost)
      renderPackingOrder(orderHost, draft, selected)
    }
    if (!groups.length)
      body.append(
        el(
          'p',
          uiMessage(
            'No products in this packing selection. Return to Orders to choose products.'
          )
        )
      )
    host.append(body)
    if (groups.length > 20) {
      const nav = el('nav', undefined, 'packing-pages')
      const previous = prepButton('Previous groups', () => {
          groupPage--
          renderPreparation()
        }),
        next = prepButton('Next groups', () => {
          groupPage++
          renderPreparation()
        })
      previous.disabled = groupPage === 0
      next.disabled = (groupPage + 1) * 20 >= groups.length
      nav.append(
        previous,
        el(
          'span',
          uiMessage('{0} / {1} · {2} groups', {
            0: groupPage + 1,
            1: Math.ceil(groups.length / 20),
            2: groups.length,
          })
        ),
        next
      )
      host.append(nav)
    }
    updateSaveStatus()
    updateHistoryButtons()
    updatePreparationCopyScope()
    for (const state of selectionStates.values()) {
      state.controller.paint()
      for (const variant of state.variants.values()) variant.controller.paint()
    }
  }
  function renderPackingOrder(host, draft, pageGroups) {
    const index = drafts.indexOf(draft)
    const selection = preparationSelection(draft)
    function orderButton(text, action, className) {
      return prepButton(
        text,
        async () => {
          current = index
          return action()
        },
        className
      )
    }
    const source = getRecords().find(
      ({ snapshot }) => snapshot.orderId === draft.orderId
    )?.snapshot
    const orderHeader = el('header', undefined, 'packing-order-header')
    const identity = el('div')
    const sellerHeading = el('h2')
    sellerHeading.append(
      copyTextButton(
        source?.sellerName || draft.sellerId || t('Seller unavailable'),
        { label: uiMessage('Copy store name') }
      )
    )
    identity.append(sellerHeading)
    const orderNumber = el('span', undefined, 'packing-order-number')
    orderNumber.append(
      copyTextButton(draft.orderId, { label: uiMessage('Copy order number') })
    )
    identity.append(orderNumber)
    const restoreActions = el('div', undefined, 'packing-restore-actions')
    const reset = orderButton('Reset order and codes', () =>
      restorePacking(draft, false)
    )
    decorateIcon(reset, 'refresh')
    reset.disabled = !hasDefaultPackingChanges(draft)
    resetButtons.set(draft.orderId, reset)
    const previous = orderButton('Restore previous packing', () =>
      restorePacking(draft, true)
    )
    decorateIcon(previous, 'undo')
    previous.disabled = !draft.previousPacking
    restoreActions.append(reset, previous)
    orderHeader.append(
      identity,
      el(
        'span',
        uiMessage('{0} groups · {1}', {
          0: scopedGroups(draft).length,
          1: () =>
            [
              ...new Set(
                scopedGroups(draft).map((group) =>
                  groupPackingMonth(draft, group)
                )
              ),
            ]
              .map(monthLabel)
              .join(', '),
        }),
        'packing-help'
      ),
      restoreActions
    )
    host.append(orderHeader)
    if (source?.sellerUnavailable || !draft.sellerId) {
      const help = el(
        'p',
        uiMessage(
          'Seller unavailable on the source page. Enter the seller’s 1688 member login to assign label codes. Reuse the same login for this seller’s other orders.'
        ),
        'packing-help'
      )
      help.id = `preparation-seller-help-${draft.orderId}`
      const seller = field(
        uiMessage('Seller member login (required)'),
        draft.sellerId,
        (value) => {
          draft.sellerId = value
        }
      )
      const input = seller.querySelector('input')
      input.id = `preparation-seller-${draft.orderId}`
      seller.htmlFor = input.id
      input.required = true
      input.autocomplete = 'off'
      input.autocapitalize = 'off'
      input.setAttribute('autocorrect', 'off')
      input.spellcheck = false
      input.setAttribute('aria-describedby', help.id)
      host.append(help, seller)
    }
    const categories = new Set(
      scopedGroups(draft).map((group) => group.category)
    )
    const names = new Set(scopedGroups(draft).map((group) => group.spanishName))
    let categoryValue = categories.size === 1 ? [...categories][0] : ''
    let spanishValue = names.size === 1 ? [...names][0] : ''
    let categoryChanged = false,
      spanishChanged = false
    const orderTools = el('section', undefined, 'order-tools')
    bindAttribute(orderTools, 'aria-label', uiMessage('Order tools'))
    const orderSpanish = field(uiMessage('Spanish'), spanishValue, (value) => {
      spanishValue = value.toUpperCase()
      spanishChanged = true
    })
    bindAttribute(
      orderSpanish.querySelector('input'),
      'placeholder',
      names.size > 1 ? uiMessage('Mixed names') : uiMessage('Name all products')
    )
    const orderCategory = field(
      uiMessage('Chinese'),
      categoryValue,
      (value) => {
        categoryValue = value
        categoryChanged = true
      }
    )
    bindAttribute(
      orderCategory.querySelector('input'),
      'placeholder',
      categories.size > 1
        ? uiMessage('Mixed categories')
        : uiMessage('Add a category')
    )
    const applyCategory = orderButton('Apply to order', () => {
      for (const group of scopedGroups(draft)) {
        if (categoryChanged) group.category = categoryValue
        if (spanishChanged) {
          group.spanishName = spanishValue
          for (const variant of group.variants) variant.spanishName = ''
        }
      }
      renderPreparation()
    })
    bindAttribute(
      orderSpanish.querySelector('input'),
      'aria-label',
      uiMessage('Spanish category for order')
    )
    bindAttribute(
      orderCategory.querySelector('input'),
      'aria-label',
      uiMessage('Chinese category for order')
    )
    orderTools.append(
      el('span', uiMessage('For this order'), 'order-category-label'),
      preparationHelp(
        orderSpanish,
        uiMessage('Use one Spanish label name for every product in this order.')
      ),
      preparationHelp(
        orderCategory,
        uiMessage(
          'One Chinese name for all carton marks in this order. For example, 玻璃 means glass.'
        )
      ),
      preparationHelp(
        applyCategory,
        uiMessage(
          'Apply the names you changed to all products in this order. Other fields stay as they are.'
        )
      )
    )
    orderTools.append(
      materialControl(
        draft,
        scopedGroups(draft).flatMap((group) => scopedVariants(draft, group)),
        'Material for order',
        'Apply material to order'
      )
    )
    orderTools.append(
      preparationHelp(
        orderButton('Merge products', async () => {
          const ids = draft.groups
            .filter((group) => selection.groups.has(group.id))
            .map((group) => group.id)
          if (ids.length < 2)
            throw new Error('Select at least two product groups to merge.')
          requireCompleteGroups(
            draft,
            draft.groups.filter((group) => ids.includes(group.id))
          )
          const candidate = structuredClone(draft)
          const target = candidate.groups.find((g) => g.id === ids[0]),
            used = new Set(
              target.variants.map((v) => v.variantSuffix + v.sizeSuffix)
            )
          if (target.baseCode)
            for (const code of await repository.getReservedBarcodes(
              target.baseCode,
              { accountId: draft.accountId }
            ))
              used.add(code.slice(target.baseCode.length))
          for (const group of candidate.groups.filter(
            (g) => ids.includes(g.id) && g !== target
          ))
            for (const variant of group.variants) {
              if (used.has(variant.variantSuffix + variant.sizeSuffix))
                variant.variantSuffix = unusedSuffix(used, variant.sizeSuffix)
              used.add(variant.variantSuffix + variant.sizeSuffix)
              target.variants.push(variant)
            }
          candidate.groups = candidate.groups.filter(
            (g) => !ids.includes(g.id) || g === target
          )
          await reviewGroupEdit(
            draft,
            candidate,
            'Merge selected product groups?',
            uiMessage(
              '{count} product groups in this order will share {code}. Their barcode endings may change to remain unique. Old issued codes stay reserved.',
              { count: ids.length, code: target.baseCode }
            )
          )
        }),
        uiMessage(
          'Give selected products one product code and carton mark. Variants keep separate barcodes.'
        )
      )
    )
    host.append(orderTools)
    updateHistoryButtons()
    for (const group of pageGroups) {
      const card = el('section', undefined, 'preparation-group'),
        title = el('h3'),
        selectGroup = el('span', undefined, 'group-select')
      card.dataset.groupId = group.id
      selectGroup.setAttribute('role', 'button')
      bindAttribute(
        selectGroup,
        'aria-label',
        uiMessage('Select group {0}: {1}', {
          0: draft.groups.indexOf(group) + 1,
          1: group.title,
        })
      )
      selection.controller.bind(selectGroup, group.id, {
        attribute: 'aria-pressed',
      })
      selection.cards.set(group.id, card)
      card.classList.toggle('is-selected', selection.groups.has(group.id))
      const isCardTarget = (event) =>
        !event.target.closest(
          'button, a, input, select, textarea, label, [role="button"], [contenteditable]:not([contenteditable="false"]), .variants'
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
      bindAttribute(productInput, 'aria-label', uiMessage('Product code'))
      productInput.value = group.baseCode
      bindAttribute(productInput, 'placeholder', uiMessage('Assigning code…'))
      productInput.autocomplete = 'off'
      productInput.setAttribute('autocorrect', 'off')
      productInput.spellcheck = false
      productInput.size = 12
      productInput.addEventListener('input', () => {
        group.baseCode = productInput.value.toUpperCase()
      })
      codeFields.set(group.id, productInput)
      title.append(
        reorderHandle({
          key: group.id,
          label: uiMessage('group {0}', { 0: draft.groups.indexOf(group) + 1 }),
          items: () => scopedGroups(draft).map((entry) => entry.id),
          element: (id) => host.querySelector(`[data-group-id="${id}"]`),
          move: (key, target, after) => {
            void preparationAction(async () => {
              const live = drafts[index]
              const moved = reorderPreparationGroups(
                live,
                movedKeys(
                  live.groups.map((entry) => entry.id),
                  key,
                  target,
                  after
                )
              )
              drafts[index] = moved
              current = index
              renderPreparation()
              document
                .querySelector(`[data-group-id="${key}"] .reorder-handle`)
                ?.focus()
            }).catch((error) => showError(error.message))
          },
        }),
        selectGroup,
        preparationHelp(
          productInput,
          uiMessage(
            'Product code shared by all variants. Printed on its carton mark.'
          )
        )
      )
      const removeGroup = orderButton('Remove group', () =>
        removePackingProducts(
          draft,
          group.variants
            .flatMap((variant) => variant.entryIds)
            .filter((id) => scopeEntries.get(draft.orderId)?.has(id))
        )
      )
      decorateIcon(removeGroup, 'trash', {
        iconOnly: true,
        label: uiMessage('Remove group'),
      })
      title.append(
        preparationHelp(
          removeGroup,
          uiMessage(
            'Remove this group’s displayed products from packing. Original orders and issued codes are kept.'
          )
        )
      )
      const groupName = el('input')
      groupName.className = 'group-name-editor'
      bindAttribute(groupName, 'aria-label', uiMessage('Spanish short name'))
      bindAttribute(groupName, 'placeholder', uiMessage('Name product'))
      groupName.value = group.spanishName
      groupName.maxLength = 80
      groupName.size = Math.max(8, Math.min(24, group.spanishName.length))
      groupName.addEventListener('input', () => {
        group.spanishName = groupName.value.toUpperCase()
      })
      preparationHelp(
        selectGroup,
        uiMessage(
          'Click to select this group. Click again to deselect; Shift-click selects a range.'
        )
      )
      preparationHelp(
        title,
        uiMessage(
          'Click this header to select the group. Click again to deselect; Shift-click selects a range.'
        )
      )
      const originalTitle = el('div', undefined, 'original-product-name')
      originalTitle.append(
        el('span', uiMessage('Original product name')),
        el('p', group.title)
      )
      const summary = el('div', undefined, 'product-summary')
      summary.append(title)
      watchCodeFields([productInput], draft, summary)
      const fields = el('div', undefined, 'group-fields')
      fields.append(
        preparationHelp(
          groupName,
          uiMessage(
            'Edit the Spanish name printed on this product’s barcode labels.'
          )
        ),
        preparationHelp(
          inlineField(
            uiMessage('Chinese category'),
            group.category,
            (v) => {
              group.category = v
            },
            'Add a category'
          ),
          uiMessage('Printed on the carton mark, for example 玻璃 for glass.')
        )
      )
      fields.append(
        materialControl(
          draft,
          scopedVariants(draft, group),
          'Material for group',
          'Apply material to group'
        )
      )
      const overview = el('div', undefined, 'product-overview')
      const carton = el('div', undefined, 'carton-preview')
      carton.append(
        el('strong', uiMessage('Carton mark')),
        media.label(
          () => outputModel(draft, group, null, 'mark'),
          () =>
            preparationAction(async () => {
              await saveDraft(index)
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
      bindAttribute(
        table,
        'aria-label',
        uiMessage('Variants for {0}', { 0: group.spanishName || group.title })
      )
      table.setAttribute('aria-multiselectable', 'true')
      for (const label of ['#', 'Photo', 'Product variant', 'Barcode']) {
        const column = el('th', uiMessage(label))
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
        Math.max(0, Math.ceil(scopedVariants(draft, group).length / 50) - 1)
      )
      for (const variant of scopedVariants(draft, group).slice(
        variantPage * 50,
        (variantPage + 1) * 50
      )) {
        const row = el('tr')
        row.dataset.variantId = variant.id
        variantSelection.controller.bind(row, variant.id)
        const td = el(
          'td',
          String(group.variants.indexOf(variant) + 1),
          'variant-index'
        )
        row.append(td)
        td.append(
          reorderHandle({
            key: variant.id,
            label: uiMessage('product {0}', {
              0: group.variants.indexOf(variant) + 1,
            }),
            items: () => scopedVariants(draft, group).map((entry) => entry.id),
            element: (id) => card.querySelector(`[data-variant-id="${id}"]`),
            move: (key, target, after) => {
              void preparationAction(async () => {
                const live = drafts[index],
                  liveGroup = live.groups.find((entry) => entry.id === group.id)
                drafts[index] = reorderPreparationVariants(
                  live,
                  group.id,
                  movedKeys(
                    liveGroup.variants.map((entry) => entry.id),
                    key,
                    target,
                    after
                  )
                )
                current = index
                renderPreparation()
                document
                  .querySelector(`[data-variant-id="${key}"] .reorder-handle`)
                  ?.focus()
              }).catch((error) => showError(error.message))
            },
          })
        )
        const photoCell = el('td', undefined, 'variant-photos')
        const items = variant.entryIds
          .filter((id) => scopeEntries.get(draft.orderId)?.has(id))
          .map((id) => sourceItems.get(id))
          .filter(Boolean)
        const sourceDetailItems = items.map((item) => ({
          ...item,
          orderId: draft.orderId,
          sellerName: source?.sellerName,
        }))
        const ownsDetailsEvent = (event) =>
          event.target.closest('[data-variant-id]') === row &&
          !event.target.closest(
            'button, a, input, select, textarea, label, [contenteditable]:not([contenteditable="false"])'
          )
        let beforeClick
        row.addEventListener(
          'click',
          (event) => {
            if (event.detail === 1 && ownsDetailsEvent(event))
              beforeClick = {
                groups: [...selection.groups],
                variants: [...variantSelection.selected],
              }
          },
          true
        )
        const openDetails = () => {
          if (sourceDetailItems.length)
            onProductDetails(sourceDetailItems[0], {
              sourceItems: sourceDetailItems,
            })
        }
        row.addEventListener(
          'dblclick',
          (event) => {
            if (
              !ownsDetailsEvent(event) ||
              event.ctrlKey ||
              event.metaKey ||
              event.shiftKey
            )
              return
            event.preventDefault()
            event.stopPropagation()
            if (beforeClick) {
              selection.groups.clear()
              for (const id of beforeClick.groups) selection.groups.add(id)
              variantSelection.selected.clear()
              for (const id of beforeClick.variants)
                variantSelection.selected.add(id)
              selection.controller.paint()
              variantSelection.controller.paint()
              card.classList.toggle(
                'is-selected',
                selection.groups.has(group.id)
              )
              updatePreparationCopyScope()
            }
            openDetails()
          },
          true
        )
        row.addEventListener(
          'keydown',
          (event) => {
            if (
              event.key !== 'Enter' ||
              event.ctrlKey ||
              event.metaKey ||
              event.altKey ||
              event.shiftKey ||
              !ownsDetailsEvent(event)
            )
              return
            event.preventDefault()
            event.stopPropagation()
            openDetails()
          },
          true
        )
        if (items.length > 1)
          td.append(
            el('small', uiMessage('{0} source rows', { 0: items.length }))
          )
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
          const previous = orderButton('Previous photos', () => {
              photoPage--
              showPhotos()
            }),
            next = orderButton('Next photos', () => {
              photoPage++
              showPhotos()
            })
          previous.textContent = '‹'
          bindAttribute(previous, 'aria-label', uiMessage('Previous photos'))
          next.textContent = '›'
          bindAttribute(next, 'aria-label', uiMessage('Next photos'))
          if (pages > 1) navigation.append(previous, pageLabel, next)
          otherPhotos.append(gallery, navigation)
          showPhotos()
          photoCell.append(otherPhotos)
        }
        const option = el('td', undefined, 'variant-option'),
          details = el('div', undefined, 'variant-details'),
          description = el('div', undefined, 'variant-description'),
          note = inlineField(
            uiMessage('Product variant'),
            variant.variant,
            (value) => {
              variant.variant = value
            },
            'Describe this variant',
            true
          )
        note.classList.add('variant-note')
        note.firstChild.replaceWith(
          el('span', uiMessage('Product variant'), 'visually-hidden')
        )
        description.append(
          preparationHelp(
            note,
            uiMessage(
              'Describe what differs, such as color or scent. This note is not printed.'
            )
          )
        )
        const colors = colorHints(items)
        if (colors.childElementCount) description.append(colors)
        description.append(materialControl(draft, [variant], 'Material'))
        if (variant.size)
          description.append(
            preparationHelp(
              el(
                'small',
                uiMessage('Order size: {0}', { 0: variant.size }),
                'source-size'
              ),
              uiMessage(
                'From the order. Helps you choose a size code; this measurement is not printed.'
              )
            )
          )
        const facts = el('dl', undefined, 'variant-order-facts')
        const prices = [
          ...new Set(items.map((item) => normalizePrice(item.price))),
        ]
        const quantity = items.reduce(
          (sum, item) => sum + BigInt(item.quantity),
          0n
        )
        for (const [label, value, className] of [
          [
            prices.length > 1 ? 'Unit prices' : 'Unit price',
            prices.map((price) => `¥ ${price}`).join(' / ') || '—',
            'variant-price',
          ],
          [
            'Quantity',
            items.length ? () => quantity.toLocaleString(getLocale()) : '—',
            'variant-quantity',
          ],
        ]) {
          const fact = el('div', undefined, className)
          const amount = el('dd')
          if (typeof value === 'function') bindText(amount, value)
          else amount.textContent = value
          fact.append(el('dt', uiMessage(label)), amount)
          facts.append(fact)
        }
        description.append(
          preparationHelp(
            facts,
            items.length > 1
              ? uiMessage(
                  'Source unit prices and combined quantity from {0} order rows. Discounts are not subtracted here.',
                  { 0: items.length }
                )
              : uiMessage(
                  'Source unit price and ordered quantity. Discounts are not subtracted here.'
                )
          )
        )
        const codeOptions = el('fieldset', undefined, 'variant-code-options')
        bindAttribute(codeOptions, 'aria-label', uiMessage('Code options'))
        const codeReadout = el(
          'output',
          undefined,
          'variant-code-readout visually-hidden'
        )
        bindAttribute(codeReadout, 'aria-label', uiMessage('Full barcode'))
        const codeDesign = el('div', undefined, 'variant-code-design')
        const codeBasePart = el('div', undefined, 'code-base-part')
        const codeBase = el('code', undefined, 'variant-code-base')
        codeBasePart.append(codeBase)
        codeDesign.append(
          preparationHelp(
            codeBasePart,
            uiMessage(
              'Shared product code. Edit the title above to change it for every variant.'
            )
          )
        )
        const updateCodeReadout = () => {
          bindText(
            codeReadout,
            () =>
              `${group.baseCode || t('Product code')}${variant.variantSuffix}${variant.sizeSuffix}`
          )
          bindText(codeBase, () => group.baseCode || t('Assigning code…'))
        }
        updateCodeReadout()
        productInput.addEventListener('input', updateCodeReadout)
        productInput.addEventListener('change', updateCodeReadout)
        const codeInputs = []
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
            el('span', uiMessage(label), 'visually-hidden')
          )
          const codeInput = labelField.querySelector('input')
          bindAttribute(
            codeInput,
            'aria-label',
            uiMessage('{0} {1}', { 0: uiMessage(label), 1: variant.id })
          )
          codeInput.autocomplete = 'off'
          codeInput.setAttribute('autocorrect', 'off')
          codeInput.spellcheck = false
          codeInput.maxLength = 30
          codeInput.size = Math.max(1, codeInput.value.length)
          codeInput.addEventListener('input', () => {
            codeInput.size = Math.max(1, codeInput.value.length)
          })
          codeInputs.push(codeInput)
          codeDesign.append(
            preparationHelp(
              labelField,
              key === 'variantSuffix'
                ? uiMessage(
                    'Identifies the color or style: A, B, C. Leave blank when not needed.'
                  )
                : uiMessage(
                    'Identifies the size: S, M, L. Leave blank when not needed.'
                  )
            )
          )
        }
        codeOptions.append(codeDesign, codeReadout)
        watchCodeFields(codeInputs, draft, codeOptions)
        if (variant.needsSizeMapping)
          codeOptions.append(
            el('small', uiMessage('Choose a size code'), 'needs-preparation')
          )
        details.append(description, codeOptions)
        option.append(details)
        row.append(photoCell, option)
        const output = el('td')
        if (!variant.entryIds.some((id) => live.has(id)))
          output.append(
            el('span', uiMessage('Removed from order'), 'packing-help')
          )
        else
          output.append(
            media.label(
              () => outputModel(draft, group, variant, 'barcode'),
              () =>
                preparationAction(async () => {
                  await saveDraft(index)
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
        const removeProduct = orderButton('Remove product', () =>
          removePackingProducts(
            draft,
            variant.entryIds.filter((id) =>
              scopeEntries.get(draft.orderId)?.has(id)
            )
          )
        )
        decorateIcon(removeProduct, 'trash', {
          iconOnly: true,
          label: uiMessage('Remove product'),
        })
        td.append(
          preparationHelp(
            removeProduct,
            uiMessage(
              'Remove this product from packing. Original order data and issued codes are kept.'
            )
          )
        )
        row.append(output)
        body.append(row)
      }
      table.append(body)
      scroll.append(table)
      card.append(scroll)
      if (scopedVariants(draft, group).length > 50) {
        const navigation = el('div', undefined, 'dialog-actions')
        const previous = orderButton('Previous variants', () => {
            variantPages.set(group.id, variantPage - 1)
            renderPreparation()
          }),
          next = orderButton('Next variants', () => {
            variantPages.set(group.id, variantPage + 1)
            renderPreparation()
          })
        previous.disabled = variantPage === 0
        next.disabled =
          (variantPage + 1) * 50 >= scopedVariants(draft, group).length
        navigation.append(
          previous,
          el(
            'span',
            `${variantPage + 1} / ${Math.ceil(scopedVariants(draft, group).length / 50)}`
          ),
          next
        )
        card.append(navigation)
      }
      const groupTools = el('section', undefined, 'group-tools')
      bindAttribute(groupTools, 'aria-label', uiMessage('Grouping tools'))
      groupTools.append(el('h4', uiMessage('Grouping tools')))
      const groupActions = el('div', undefined, 'dialog-actions')
      groupActions.append(
        preparationHelp(
          orderButton('Share one barcode', async () => {
            const ids = [...variantSelection.selected]
            if (ids.length < 2)
              throw new Error('Select at least two matching product variants.')
            requireCompleteGroups(draft, [group])
            const candidate = structuredClone(draft),
              edited = candidate.groups.find((entry) => entry.id === group.id)
            const target = edited.variants.find((v) => ids.includes(v.id))
            const materialSources = edited.variants
              .filter((v) => ids.includes(v.id))
              .map((variant) => structuredClone(variant))
            for (const variant of edited.variants.filter(
              (v) => ids.includes(v.id) && v !== target
            ))
              target.entryIds.push(...variant.entryIds)
            mergeVariantMaterials(target, materialSources)
            edited.variants = edited.variants.filter(
              (v) => !ids.includes(v.id) || v === target
            )
            await reviewGroupEdit(
              draft,
              candidate,
              'Share one barcode?',
              uiMessage(
                '{count} selected variants will use {code}. Their original prices and quantities remain separate. Previous barcode reservations remain.',
                {
                  count: ids.length,
                  code: `${group.baseCode}${target.variantSuffix}${target.sizeSuffix}`,
                }
              )
            )
          }),
          uiMessage(
            'Give matching variants one barcode. Original prices and quantities stay separate.'
          )
        ),
        preparationHelp(
          orderButton('Give rows separate barcodes', async () => {
            requireCompleteGroups(draft, [group])
            const candidate = structuredClone(draft),
              edited = candidate.groups.find((entry) => entry.id === group.id)
            const ids = variantSelection.selected
            const selected = edited.variants.filter(
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
                edited.variants.push({
                  ...structuredClone(variant),
                  id: crypto.randomUUID(),
                  entryIds: [entryId],
                  variantSuffix: suffix,
                })
              }
              variant.entryIds = variant.entryIds.slice(0, 1)
            }
            await reviewGroupEdit(
              draft,
              candidate,
              'Separate the original product rows?',
              uiMessage(
                '{count} combined variants will be split into one barcode per original order row. New endings will be assigned; existing reservations remain.',
                { count: selected.length }
              )
            )
          }),
          uiMessage(
            'Split a combined variant back into one barcode per original order row.'
          )
        ),
        preparationHelp(
          orderButton('Move to new product', async () => {
            const ids = [...variantSelection.selected]
            if (!ids.length || ids.length === group.variants.length)
              throw new Error(
                'Select some, but not all, variants to split into a new product group.'
              )
            requireCompleteGroups(draft, [group])
            const candidate = structuredClone(draft),
              edited = candidate.groups.find((entry) => entry.id === group.id)
            const separated = {
              ...structuredClone(group),
              id: crypto.randomUUID(),
              baseCode: '',
              variants: edited.variants.filter((v) => ids.includes(v.id)),
            }
            edited.variants = edited.variants.filter((v) => !ids.includes(v.id))
            candidate.groups.push(separated)
            await reviewGroupEdit(
              draft,
              candidate,
              'Move variants to a new product group?',
              uiMessage(
                '{count} variants will receive a new shared product code. The other variants keep {code}. Old issued codes stay reserved.',
                { count: ids.length, code: group.baseCode }
              )
            )
          }),
          uiMessage(
            'Give selected variants their own product code and carton mark.'
          )
        )
      )
      groupTools.append(groupActions)
      card.append(groupTools)
      host.append(card)
    }
  }

  async function bulkLabels(kind, selectedRows) {
    const selected = new Set(
      selectedRows.map((row) => `${row.orderId}/${row.entryId}`)
    )
    if (!selected.size) return
    await flushSaves()
    const models = []
    for (const orderId of new Set(selectedRows.map((row) => row.orderId))) {
      const record = getRecords().find(
        (record) => record.snapshot.orderId === orderId
      )
      const prep = preparations.get(orderId)
      if (!prep) continue
      for (const group of activeGroups(prep, record.snapshot)) {
        const variants = group.variants.filter((variant) =>
          variant.entryIds.some((id) => selected.has(`${orderId}/${id}`))
        )
        if (!variants.length) continue
        if (kind === 'mark') models.push(outputModel(prep, group, null, kind))
        else
          for (const variant of variants)
            models.push(outputModel(prep, group, variant, kind))
      }
    }
    if (!models.length) throw new Error('No active labels to copy.')
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
    return openImageCopyDialog({
      title: 'Prepare label images',
      count: models.length,
      plan: () =>
        imageBatchPlans(
          models.length,
          Math.min(budgetCount, kind === 'mark' ? 4 : 20)
        ),
      prepare: async ({ start, end }, { signal, onProgress }) => {
        const results = []
        const images = []
        for (const [index, model] of models.slice(start, end).entries()) {
          signal.throwIfAborted()
          onProgress(
            uiMessage('Preparing {0} of {1}', { 0: index + 1, 1: end - start })
          )
          const result = await renderLabel({
            ...model,
            settings: frozenSettings,
            logoUrl: frozenLogo,
            signal,
          })
          results.push(result)
          images.push({
            blob: result.blob,
            label: model.code,
          })
          await yieldUI()
        }
        return { images, payload: results }
      },
      write: labelClipboard,
    })
  }
  function orderRows(rows) {
    const ranks = new Map()
    for (const [orderId, prep] of preparations) {
      let index = 0
      for (const group of prep.groups)
        for (const variant of group.variants)
          for (const id of variant.entryIds)
            ranks.set(`${orderId}/${id}`, index++)
    }
    const orderRanks = new Map(
      [...new Set(rows.map((row) => row.orderId))].map((id, index) => [
        id,
        index,
      ])
    )
    return [...rows].sort(
      (a, b) =>
        orderRanks.get(a.orderId) - orderRanks.get(b.orderId) ||
        (ranks.get(`${a.orderId}/${a.entryId}`) ?? Number.MAX_SAFE_INTEGER) -
          (ranks.get(`${b.orderId}/${b.entryId}`) ?? Number.MAX_SAFE_INTEGER)
    )
  }
  function preparedRows(rows = getRows()) {
    return orderRows(rows).map((row) => {
      const match = membership.get(`${row.orderId}/${row.entryId}`)
      if (!match) {
        const suggestion = suggestions.get(`${row.orderId}/${row.entryId}`)
        return {
          ...row,
          baseCode: '',
          barcode: '',
          spanishName: suggestion?.spanishName || '',
          chineseCategory: suggestion?.category || '',
          material: suggestMaterial(row),
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
        material: variantMaterial(match.variant, row.entryId).value,
        manualReordered: Boolean(
          match.group.manualReordered || match.variant.manualReordered
        ),
      }
    })
  }
  function preparationCopyRows(draft) {
    const record = getRecords().find(
      (entry) => entry.snapshot.orderId === draft.orderId
    )
    if (!record) throw new Error('This order is no longer available.')
    const state = preparationSelection(draft)
    const entryIds = new Set()
    const scope = scopeEntries.get(draft.orderId) || new Set()
    for (const group of activeGroups(draft, record.snapshot)) {
      const variants = state.variants.get(group.id)?.selected
      for (const variant of group.variants) {
        const include = variants?.size
          ? variants.has(variant.id)
          : state.groups.has(group.id)
        if (include)
          for (const id of variant.entryIds) if (scope.has(id)) entryIds.add(id)
      }
    }
    return preparedRows(
      record.snapshot.items
        .filter((item) => entryIds.has(item.entryId))
        .map((item) => ({ ...item, orderId: draft.orderId }))
    )
  }
  async function copyPreparation(rows = preparedRows()) {
    if (!rows.length) throw new Error('Select product rows to copy.')
    const modal = el('dialog', undefined, 'packing-column-dialog')
    bindAttribute(modal, 'aria-label', uiMessage('Copy preparation columns'))
    modal.append(
      el('h2', uiMessage('Copy {0} product rows', { 0: rows.length }))
    )
    const fields = el('div', undefined, 'column-options')
    const preferenceKey = '1688-packing-copy-columns'
    let selectedColumns = preparationColumns.map(([key]) => key)
    try {
      const stored = JSON.parse(localStorage.getItem(preferenceKey))
      if (Array.isArray(stored)) selectedColumns = stored
    } catch {}
    for (const [key, title] of preparationColumns) {
      const label = el('label', uiMessage(title)),
        check = el('input')
      check.type = 'checkbox'
      check.value = key
      check.checked = selectedColumns.includes(key)
      label.prepend(check)
      fields.append(label)
    }
    const copy = button(
        uiMessage('Copy chosen columns'),
        async (b) =>
          copied(b, async () => {
            const columns = [...fields.querySelectorAll('input:checked')].map(
              (check) => check.value
            )
            if (!columns.length)
              throw new Error('Select at least one column to copy.')
            try {
              localStorage.setItem(preferenceKey, JSON.stringify(columns))
            } catch {}
            await writeTable(preparationTable(rows, columns, headers()))
          }),
        'primary'
      ),
      close = el('button', uiMessage('Close'))
    close.onclick = () => modal.close()
    const headerChoice = el(
        'label',
        uiMessage('Headers'),
        'column-header-choice'
      ),
      headerCheck = el('input')
    headerCheck.type = 'checkbox'
    headerCheck.checked = headers()
    headerCheck.addEventListener('change', () => {
      $('include-headers').checked = headerCheck.checked
      $('include-headers').dispatchEvent(new Event('change'))
    })
    headerChoice.prepend(headerCheck)
    fields.addEventListener('change', () => {
      copy.disabled = !fields.querySelector('input:checked')
    })
    copy.disabled = !fields.querySelector('input:checked')
    const actions = el('div', undefined, 'dialog-actions')
    actions.append(headerChoice, close, copy)
    modal.append(
      fields,
      el('p', uiMessage('Product codes appear only once per group.')),
      actions
    )
    document.body.append(modal)
    modal.onclose = () => modal.remove()
    enableLightDismiss(modal)
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
    host.replaceChildren(el('h2', uiMessage('Settings')), tabs)
    tabs.setAttribute('role', 'tablist')
    bindAttribute(tabs, 'aria-label', uiMessage('Settings sections'))
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
      ['sizes', 'Size codes', 'packing'],
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
        heading = el('h3', isMessage(title) ? title : uiMessage(title))
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
    const shared = card(
      uiMessage('Shared label text'),
      'text',
      'settings-shared'
    )
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
                ? uiMessage('Printed on every barcode label.')
                : uiMessage('Destination printed on every barcode label.'),
          }
        )
      )
    shared.append(
      settingField(
        uiMessage('Output DPI'),
        value.settings.dpi,
        (v) => (value.settings.dpi = Number(v)),
        {
          min: 150,
          max: 600,
          help: uiMessage(
            'Image detail for copying and printing. 300 DPI is the default; physical dimensions stay the same.'
          ),
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
          uiMessage('{0} (mm)', {
            0: label === 'width' ? uiMessage('Width') : uiMessage('Height'),
          }),
          value.settings[kind][key] ?? 1,
          (v) => (value.settings[kind][key] = Number(v)),
          {
            min: minimum,
            max: 300,
            step: 0.1,
            help: uiMessage(
              '{0} {1} in millimetres. Saved images carry this physical size.',
              { 0: uiMessage(title), 1: uiMessage(label) }
            ),
          }
        )
        bindAttribute(
          size.querySelector('input'),
          'aria-label',
          uiMessage('{0} {1} (mm)', {
            0: uiMessage(title),
            1: uiMessage(label),
          })
        )
        dimensions.append(size)
      }
      const scale = settingField(
          uiMessage('Text size'),
          value.settings[kind].textScale ?? 1,
          (v) => {
            value.settings[kind].textScale = Number(v)
            scaleValue.value = `${Math.round(Number(v) * 100)}%`
          },
          {
            min: 0.75,
            max: 1.25,
            step: 0.05,
            help: uiMessage(
              'Resize label text from 75% to 125%. The layout and barcode bars keep their proportions.'
            ),
          }
        ),
        scaleValue = el(
          'output',
          `${Math.round((value.settings[kind].textScale ?? 1) * 100)}%`
        ),
        scaleInput = scale.querySelector('input')
      scale.className = 'settings-scale'
      scaleInput.type = 'range'
      bindAttribute(
        scaleInput,
        'aria-label',
        uiMessage('{0} text scale (0.75–1.25)', { 0: uiMessage(title) })
      )
      scaleValue.htmlFor = scaleInput.id
      scale.append(scaleValue)
      section.append(dimensions, scale)
    }
    const logoCard = card(uiMessage('Label logo'), 'image', 'settings-logo'),
      logo = el('input'),
      logoPreview = el('img'),
      logoControls = el('div'),
      logoStatus = el(
        'span',
        uiMessage('PNG, JPG or WebP · up to 2 MB'),
        'packing-help'
      )
    logo.type = 'file'
    logo.className = 'settings-logo-file'
    logo.accept = 'image/png,image/jpeg,image/webp'
    bindAttribute(logo, 'aria-label', uiMessage('Replace label logo'))
    logoPreview.src = value.logoDataUrl || logoUrl()
    bindAttribute(logoPreview, 'alt', uiMessage('Current label logo'))
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
        button(uiMessage('Replace logo'), () => logo.click()),
        'upload'
      ),
      logoStatus,
      logo
    )
    logoCard.append(logoPreview, logoControls)
    labels.append(grid)
    names.append(
      el('h3', uiMessage('Automatic product names')),
      el(
        'p',
        uiMessage(
          'Fill names from product titles. Your edits stay unchanged; unknown products stay unnamed.'
        ),
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
      const th = el('th', uiMessage(name))
      th.scope = 'col'
      head.append(th)
    }
    thead.append(head)
    table.append(thead, body)
    let vocabularyPage = 0
    const pageSize = 12
    const vocabularySearch = field(
      uiMessage('Search naming rules'),
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
    const previousRules = button(uiMessage('Previous rules'), () => {
      vocabularyPage--
      renderVocabulary()
    })
    const nextRules = button(uiMessage('Next rules'), () => {
      vocabularyPage++
      renderVocabulary()
    })
    decorateIcon(previousRules, 'previous', { iconOnly: true })
    decorateIcon(nextRules, 'next', { iconOnly: true })
    preparationHelp(previousRules, uiMessage('Previous page of naming rules.'))
    preparationHelp(nextRules, uiMessage('Next page of naming rules.'))
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
        bindAttribute(input, 'aria-label', uiMessage(name))
        input.oninput = () =>
          (entry[key] =
            key === 'spanishName' ? input.value.toUpperCase() : input.value)
        preparationHelp(
          input,
          key === 'match'
            ? uiMessage(
                'Words to match in the original title. Separate alternatives with |.'
              )
            : key === 'exclude'
              ? uiMessage(
                  'Ignore this rule if the title includes any of these words. Separate alternatives with |.'
                )
              : key === 'spanishName'
                ? uiMessage('Short uppercase name printed on the barcode.')
                : uiMessage('Chinese category printed on the carton mark.')
        )
        td.append(input)
        row.append(td)
      }
      const td = el('td')
      const remove = decorateIcon(
        button(uiMessage('Remove naming rule'), () => {
          value.vocabulary = value.vocabulary.filter((item) => item !== entry)
          renderVocabulary()
        }),
        'trash',
        { iconOnly: true }
      )
      preparationHelp(
        remove,
        uiMessage('Remove this naming rule when you save Settings.')
      )
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
      bindText(
        vocabularyCount,
        uiMessage('{0}–{1} of {2} rules', {
          0: start,
          1: end,
          2: matching.length,
        })
      )
      if (!matching.length) {
        const row = el('tr'),
          cell = el('td', uiMessage('No matching rules.'), 'vocabulary-empty')
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
    bindAttribute(scroll, 'aria-label', uiMessage('Naming rules'))
    toolbar.append(
      vocabularySearch,
      decorateIcon(
        button(uiMessage('Add rule'), () => {
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
    const sizeRules = mountSizeVocabulary(
      panels.get('settings-panel-sizes'),
      value
    )
    panels.get('settings-panel-data').append(data)
    const footer = el('div', undefined, 'settings-footer')
    footer.append(
      el(
        'span',
        uiMessage('Save label settings, product names and size rules.'),
        'packing-help'
      ),
      button(
        uiMessage('Save settings'),
        async (save) => {
          save.disabled = true
          clearErrorNotices($('settings-dialog'))
          try {
            await flushSaves()
            try {
              value.sizeVocabulary = sizeRules.validate()
            } catch (error) {
              selectTab('settings-panel-sizes')
              throw error
            }
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
            if (!$('packing-view').hidden) {
              for (const draft of drafts) {
                const latest = preparations.get(draft.orderId)
                if (latest) acceptDraft(latest)
              }
              renderPreparation()
            }
            channel?.postMessage('preferences')
            $('settings-dialog').close()
            feedback(uiMessage('Settings saved.'))
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
  function updateLaunchActions() {
    const rows = launchRows()
    const selected = getSelectedRows().length
    $('prepare-orders').disabled = opening || !rows.length
    bindText(
      $('packing-scope'),
      selected
        ? uiMessage('{0} selected products · {1} orders → {2}', {
            0: () => selected.toLocaleString(),
            1: new Set(rows.map((row) => row.orderId)).size,
            2: () => monthLabel(monthInput.value),
          })
        : rows.length
          ? uiMessage('Reopen {0} products already in {1}', {
              0: () => rows.length.toLocaleString(),
              1: () => monthLabel(monthInput.value),
            })
          : uiMessage(
              'Select products first. Ctrl+A selects all filtered products.'
            )
    )
  }
  monthInput.addEventListener('change', updateLaunchActions)
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
      feedback(uiMessage('Prepare product codes first.'), true)
      return
    }
    await copied($('copy-group-codes'), () =>
      navigator.clipboard.writeText(codes.join('\r\n'))
    )
  }
  return {
    reload,
    preparedRows,
    createCartonMarkRenderer,
    orderRows,
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
    updateActions: updateLaunchActions,
    decorateRow(host, row) {
      const matched = membership.get(`${row.orderId}/${row.entryId}`),
        bar = el('div', undefined, 'row-preparation')
      if (matched) {
        const copy = copyTextButton(matched.group.baseCode, {
          label: uiMessage('Copy code'),
          className: 'row-code-copy',
        })
        bindAttribute(copy, 'aria-label', uiMessage('Copy code'))
        bar.append(copy)
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
              uiMessage('Name'),
              () => openPreparation(row.orderId, row.entryId),
              'needs-preparation name-product'
            )
          )
        const { prep, group, variant } = matched
        for (const [label, symbol, kind, variantId] of [
          ['Barcode', 'barcode', 'barcode', variant.id],
          ['Carton mark', 'carton', 'mark', null],
        ]) {
          const open = button(uiMessage(label), () =>
            openLabel(prep.orderId, group.id, variantId, kind)
          )
          decorateIcon(open, symbol, { iconOnly: true, label })
          preparationHelp(open, uiMessage(label))
          bar.append(open)
        }
      } else {
        const suggestion = suggestions.get(`${row.orderId}/${row.entryId}`)
        if (suggestion?.spanishName)
          bar.append(el('span', suggestion.spanishName))
        if (suggestion?.category)
          bar.append(el('span', suggestion.category, 'category-name'))
        bar.append(
          button(
            uiMessage('Prepare'),
            () => openPreparation(row.orderId, row.entryId),
            'needs-preparation name-product'
          )
        )
      }
      host.append(bar)
    },
  }
}
