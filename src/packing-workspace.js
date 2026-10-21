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
  validatePreparation,
  validatePreparationSuffixEdits,
  groupPackingMonth,
  planSelectedPreparations,
  reorderPreparationGroups,
  reorderPreparationVariants,
  restoreDefaultPacking,
  restorePreviousPacking,
  regeneratePreparationCode,
  hasDefaultPackingChanges,
  defaultPackingChanges,
  variantMaterial,
  setVariantMaterial,
  refreshPreparationMaterials,
  setGroupSizeMode,
} from './packing-model.js'
import {
  groupingAvailability,
  groupingReviewChanges,
  regroupSelection,
  unusedSuffix,
} from './packing-grouping.js'
import {
  createNameSuggester,
  refreshPreparationNames,
} from './product-vocabulary.js'
import {
  suggestMaterial,
  translateMaterial,
  configureMaterialVocabulary,
} from './material-vocabulary.js'
import { mountMaterialVocabulary } from './material-vocabulary-settings.js'
import { openStoreSpreadsheetGuide } from './store-spreadsheet-guide.js'
import {
  mountCartonCapacity,
  cartonCapacityReadout,
} from './carton-packing-ui.js'
import { mountCartonMeasurement } from './carton-measurements-ui.js'
import { popupLanguageToggle } from './popup-language-toggle.js'
import { createProductDescription } from './product-details.js'
import {
  setCodeText,
  decorateCodeInput,
  refreshCodeInput,
} from './code-display.js'
import {
  getItemColorHints,
  configureColorVocabulary,
} from './color-vocabulary.js'
import { mountColorVocabulary } from './color-vocabulary-settings.js'
import { mountAppearanceSettings } from './appearance-settings.js'
import { downloadBackup, readBackupFile } from './backup-file.js'
import { applyAppearance, labelColorKey } from './appearance.js'
import { openImageCopyDialog, imageBatchPlans } from './image-copy-dialog.js'
import {
  mountCopyActions,
  mountProductCopyActions,
  dismissCopyActionsOnEscape,
} from './copy-actions.js'
import { copyTable } from './clipboard.js'
import { copySourceImages } from './source-image-copy.js'
import { reorderHandle, movedKeys } from './packing-reorder.js'
import {
  orderedPreparations,
  arrangePreparations,
  arrangeOrderPositions,
} from './packing-arrangement.js'
import {
  reviewPackingChanges as showPackingChanges,
  packingValueComparison,
} from './packing-review.js'
import {
  createSizeClassifier,
  resolvePendingSizeMappings,
  suggestPriceSizeMappings,
} from './size-vocabulary.js'
import { mountSizeVocabulary } from './size-vocabulary-settings.js'
import { mountRepeatProductControl } from './repeat-products-ui.js'
import {
  mountOperationsStrip,
  openOperationsDialog,
  openOperationsMigrationDialog,
} from './operations-ui.js'
import { paymentCostAdjustments } from './payment-links.js'
import { hasProductFeatureCosts } from './product-features.js'
import {
  combineRepeatCartonPacking,
  sharedVariantSources,
} from './repeat-products.js'
import { attachSearchSuggestions, searchMatcher } from './search-assistance.js'
import { DEFAULT_LABEL_SETTINGS, renderLabel } from './labels.js'
import { openPrintDialog, openRecentPrintJobs } from './print-dialog.js'
import { restoreJob } from './print-store.js'
import { mountLabelEditor } from './label-editor.js'
import {
  createPreparationHistory,
  preparationHistorySnapshot,
  restorePreparationHistory,
} from './preparation-history.js'
import { acknowledgePreparation, samePreparation } from './preparation-save.js'
import {
  discardPreparationProducts,
  preparationProducts,
} from './preparation-removal.js'
import { createPreparationMedia, preparationHelp } from './preparation-media.js'
import { createRowSelection } from './row-selection.js'
import { copyExcelImage } from './excel-image-copy.js'
import {
  createExcelImageBadges,
  currentExcelImageMode,
} from './excel-image-badges.js'
import { decorateIcon } from './icons.js'
import {
  showErrorNotice,
  clearErrorNotice,
  clearErrorNotices,
} from './error-notice.js'
import { validateBackup, mergeProductAnnotations } from './database.js'
import { createPackingBackup } from './packing-backup.js'
import { normalizePrice } from './money.js'
import {
  element as el,
  copied,
  yieldUI,
  enableLightDismiss,
  copyTextButton,
  orderReference,
  pinDialogActions,
} from './ui.js'
import {
  preparationTable,
  preparationCopyFields,
  preparationOrderFields,
  writeTable,
  labelClipboard,
  preparationGrid,
  selectedPreparationColumns,
  PREPARATION_COLUMN_PREFERENCE,
} from './preparation-clipboard.js'
import { createXlsx } from './xlsx-writer.js'
import { saveFile, announceExport, uniqueFileName } from './save-file.js'
import {
  packingListFileName,
  packingSummary,
  summaryFileName,
} from './export-summary.js'
import { createPreparationColumnPicker } from './preparation-column-picker.js'
import {
  cartonPackingForItems,
  productCartonDetails,
  cartonVolume,
  formatCartonMeasurement,
} from './carton-details.js'
import { presentOrderStatus } from './order-presentation.js'
import { orderTagBadge } from './tag-picker.js'
import { assignedTagNames, reconcileTagCatalog } from './order-tags.js'
import { mountOrderTagSettings, mountTagSettings } from './order-tags-ui.js'

const $ = (id) => document.getElementById(id)
const monthLabel = (month) =>
  new Date(`${month}-01T12:00:00Z`).toLocaleDateString(getLocale(), {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
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
      showError(error)
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
  setPackingExcluded,
  onProductDetails = () => {},
  onRefreshOrder,
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
    arrangementPanel,
    groupingPanel,
    printPanel,
    selectionToolbar,
    toolbarResize,
    backupButton,
    opening = false,
    labelOrderId
  let packingExclusionSaving = false
  const variantPages = new Map()
  const materialFields = new Set()
  const sourceAttributeFields = new Set()
  const cartonFields = new Map()
  const measurementFields = new Map()
  let rowFieldCleanupPending = false
  function scheduleRowFieldCleanup() {
    if (rowFieldCleanupPending) return
    rowFieldCleanupPending = true
    queueMicrotask(() => {
      rowFieldCleanupPending = false
      // Virtual rows are built as one detached batch, then mounted together.
      // Only prune after mounting so later rows cannot evict earlier editors.
      for (const fields of [cartonFields, measurementFields])
        for (const [key, entry] of fields)
          if (!entry.input.isConnected && !entry.dirty()) fields.delete(key)
    })
  }
  function renderSourceAttributes(host, items, titles) {
    host.replaceChildren()
    titles.replaceChildren()
    for (const item of [
      ...new Map(items.map((item) => [item.description, item])).values(),
    ]) {
      const source = createProductDescription(item)
      const title = source.querySelector('.product-title')
      // Spreadsheet descriptions belong to their own products, above the
      // compact attributes/cost row rather than repeated in the group heading.
      if (item.sourceType === 'spreadsheet') titles.append(title)
      else title.remove()
      for (const field of source.querySelectorAll(
        '[data-attribute="material"], [data-attribute="size"]'
      ))
        field.remove()
      source.querySelector('.product-attributes:empty')?.remove()
      host.append(source)
    }
    host.hidden = !host.hasChildNodes()
    titles.hidden = !titles.hasChildNodes()
  }
  function packingItemActions(label, grip, remove) {
    const host = el('div', undefined, 'packing-item-actions')
    host.setAttribute('role', 'group')
    bindAttribute(host, 'aria-label', uiMessage(label))
    remove.classList.add('packing-remove-button')
    host.append(grip, remove)
    return host
  }
  let syncPackingOrderPicker = () => {}
  onLanguageChange(() => {
    for (const entry of sourceAttributeFields) {
      if (!entry.host.isConnected) sourceAttributeFields.delete(entry)
      else renderSourceAttributes(entry.host, entry.items, entry.titles)
    }
    for (const entry of materialFields) {
      if (!entry.input.isConnected) materialFields.delete(entry)
      else if (entry.input !== document.activeElement && !entry.dirty())
        entry.input.value = translateMaterial(entry.value(), getLanguage())
    }
    syncPackingOrderPicker()
  })
  const selectionStates = new Map()
  const groupingButtons = new Map()
  let copyScope, preparationImageAbort, selectedOrderTabId, selectedOrderOpening
  function visibleDrafts() {
    return scopedDrafts().filter(
      (draft) => !packingOrders.size || packingOrders.has(draft.orderId)
    )
  }
  function scopedDrafts() {
    return drafts.filter((draft) => scopedGroups(draft).length)
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
  async function applyOrderArrangement(next, manual = false) {
    arrangementSaving = true
    updateSaveStatus()
    try {
      const activeId = drafts[current]?.orderId
      const before = globalPackingOrder()
      const arranged = arrangeOrderPositions(before, next, manual)
      const writes = arranged.filter(
        (draft) => !samePreparation(draft, preparations.get(draft.orderId))
      )
      // Ranks are a single arrangement: a revision conflict must not save half a swap.
      const results = writes.length
        ? await repository.savePreparations(writes)
        : []
      rememberSavedPreparations(before, results)
      const savedById = new Map(results.map((draft) => [draft.orderId, draft]))
      drafts = next.map((draft) =>
        structuredClone(savedById.get(draft.orderId) || draft)
      )
      for (const result of results) acceptDraft(result)
      await reload()
      current = Math.max(
        0,
        drafts.findIndex((draft) => draft.orderId === activeId)
      )
      groupPage = 0
      renderPreparation()
      changed()
      channel?.postMessage('changed')
    } catch (error) {
      error.arrangementRecovery = true
      if (error.packingIssue?.orderId)
        saveErrors.set(error.packingIssue.orderId, error)
      throw error
    } finally {
      arrangementSaving = false
      updateSaveStatus()
    }
  }
  function globalPackingOrder(candidates = drafts) {
    const live = new Map(candidates.map((draft) => [draft.orderId, draft]))
    return orderedPreparations(
      getRecords().flatMap(
        ({ snapshot }) =>
          live.get(snapshot.orderId) || preparations.get(snapshot.orderId) || []
      )
    )
  }
  function arrangeOpenedDrafts(candidates) {
    const selected = new Set(candidates.map((draft) => draft.orderId))
    return globalPackingOrder(candidates).filter((draft) =>
      selected.has(draft.orderId)
    )
  }
  function packingCopyRows() {
    return visibleDrafts().flatMap((draft) => preparationCopyRows(draft))
  }
  function selectedGroupingEntries() {
    return visibleDrafts().flatMap((draft) => {
      const state = preparationSelection(draft)
      const scope = scopeEntries.get(draft.orderId) || new Set()
      return scopedGroups(draft).flatMap((group) => {
        const variants = scopedVariants(draft, group).filter(
          (variant) =>
            state.groups.has(group.id) ||
            state.variants.get(group.id)?.selected.has(variant.id)
        )
        return variants.length
          ? [
              {
                draft,
                group,
                variants,
                complete: group.variants.every((variant) =>
                  variant.entryIds.every((id) => scope.has(id))
                ),
              },
            ]
          : []
      })
    })
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
    for (const target of copyButtons)
      target.disabled =
        !rows.length ||
        Boolean(preparationImageAbort) ||
        target.getAttribute('aria-busy') === 'true'
    if (backupButton)
      backupButton.disabled =
        !scopedDrafts().length || Boolean(preparationImageAbort)
    const grouping = groupingAvailability(selectedGroupingEntries())
    for (const [operation, { target, help }] of groupingButtons) {
      const reason = grouping[operation].reason
      target.setAttribute('aria-disabled', String(Boolean(reason)))
      preparationHelp(target, uiMessage(reason || help))
    }
    if (groupingPanel) groupingPanel.trigger.disabled = !rows.length
    if (copyActionPanel)
      copyActionPanel.trigger.disabled = !scopedDrafts().length
    const clear = selectionToolbar?.querySelector(
      '[data-clear-packing-selection]'
    )
    if (clear) clear.disabled = !rows.length
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
    checkpoints = new Map(),
    sessionBaselines = new Map(),
    sessionCartons = new Map(),
    sessionCartonValues = new Map(),
    historySaved = new Map(),
    historyRestores = new Map()
  function rememberSessionBaseline(orderId) {
    if (!sessionBaselines.has(orderId))
      sessionBaselines.set(orderId, structuredClone(preparations.get(orderId)))
    rememberCartonBaseline(orderId)
  }
  function rememberCartonBaseline(orderId) {
    if (sessionCartons.has(orderId)) return
    const record = getRecords().find(
      ({ snapshot }) => snapshot.orderId === orderId
    )
    if (record)
      sessionCartons.set(
        orderId,
        Object.fromEntries(
          record.snapshot.items.map((item) => [
            item.entryId,
            structuredClone(productCartonDetails(item, record)),
          ])
        )
      )
  }
  function measurementChanges(before, after) {
    return Object.entries(after).map(([entryId, values]) => ({
      entryId,
      before: before[entryId],
      after: values,
    }))
  }
  function recordCartonHistory(draft, before, after) {
    const snapshot = preparationHistorySnapshot(draft)
    history.recordBatch([
      {
        orderId: draft.orderId,
        before: snapshot,
        after: snapshot,
        beforeCartons: JSON.stringify(before),
        afterCartons: JSON.stringify(after),
      },
    ])
    updateHistoryButtons()
  }
  function mountMeasurements(hosts, item, record, draft) {
    for (const field of ['kg', 'cbm']) {
      const key = `${draft ? 'packing' : 'orders'}/${record.snapshot.accountId}/${record.snapshot.orderId}/${item.entryId}/${field}`
      const currentValue = () => {
        const details = productCartonDetails(
          item,
          packingRecord({ orderId: record.snapshot.orderId }) || record
        )
        return field === 'cbm' ? cartonVolume(details) : details.kg
      }
      let editor = measurementFields.get(key)
      if (editor) {
        if (editor.update({ value: currentValue() }))
          editor.cartonBaseline = structuredClone(
            productCartonDetails(
              item,
              packingRecord({ orderId: record.snapshot.orderId }) || record
            )
          )
        hosts[field].append(editor.control)
      } else {
        editor = mountCartonMeasurement(hosts[field], {
          field,
          value: currentValue(),
          onSave: async (value) => {
            const live =
              packingRecord({ orderId: record.snapshot.orderId }) || record
            const carton = editor.cartonBaseline
            const keys =
              field === 'cbm' &&
              ['len', 'wid', 'ht'].some((key) => carton[key] !== undefined)
                ? ['cbm', 'len', 'wid', 'ht']
                : [field]
            const before = {
              [item.entryId]: Object.fromEntries(
                keys.map((key) => [key, carton[key] ?? ''])
              ),
            }
            const after = {
              [item.entryId]: Object.fromEntries(
                keys.map((key) => [key, key === field ? value : ''])
              ),
            }
            const result = await repository.setCartonMeasurements(
              record.snapshot.orderId,
              measurementChanges(before, after),
              { accountId: record.snapshot.accountId }
            )
            Object.assign(live, mergeProductAnnotations(live, result))
            editor.cartonBaseline = structuredClone(
              productCartonDetails(item, result)
            )
            if (field === 'cbm') updateVolumeHelp(editor, editor.cartonBaseline)
            if (draft) {
              rememberSessionCartonValues(draft.orderId, after)
              const currentDraft = drafts.find(
                (entry) => entry.orderId === draft.orderId
              )
              if (currentDraft) recordCartonHistory(currentDraft, before, after)
            }
            channel?.postMessage('carton-capacity')
          },
        })
        editor.cartonBaseline = structuredClone(
          productCartonDetails(item, record)
        )
        measurementFields.set(key, editor)
      }
      if (field === 'cbm')
        updateVolumeHelp(editor, productCartonDetails(item, record))
    }
  }
  function updateVolumeHelp(editor, details) {
    const derived = ['len', 'wid', 'ht'].every(
      (key) => Number(details[key]) > 0
    )
    editor.control.classList.toggle('is-calculated', derived)
    preparationHelp(
      editor.input,
      derived
        ? uiMessage(
            'Calculated from {0} × {1} × {2} cm. Editing CBM replaces these dimensions with the entered volume per carton.',
            { 0: details.len, 1: details.wid, 2: details.ht }
          )
        : uiMessage(
            'Volume of one carton in m³. Leave blank if unknown. Decimals may use a dot or comma. Saves automatically.'
          )
    )
  }
  function rememberSessionCartonValues(orderId, values) {
    if (!sessionCartonValues.has(orderId)) sessionCartonValues.set(orderId, {})
    const previous = sessionCartonValues.get(orderId)
    for (const [id, fields] of Object.entries(values))
      previous[id] = { ...previous[id], ...fields }
  }
  let undoButton,
    redoButton,
    preparationBusy = false
  let saveTimer,
    saveWork,
    saveStatus,
    reloadPreparationButton,
    resolveButton,
    arrangementSaving = false,
    preparationIdle = Promise.resolve()
  const pendingSaves = new Set(),
    saveErrors = new Map(),
    codeFields = new Map(),
    resetButtons = new Map()
  const codePreviewStates = new WeakMap()
  function codePreviewSignature(draft) {
    return JSON.stringify([
      draft.accountId,
      draft.orderId,
      draft.sellerId,
      draft.month,
      draft.groups.map((group) => [
        group.id,
        group.month,
        group.baseCode,
        group.variants.map((variant) => [
          variant.id,
          variant.variantSuffix,
          variant.sizeSuffix,
          variant.needsSizeMapping,
        ]),
      ]),
    ])
  }
  function codePreviewState(draft) {
    let state = codePreviewStates.get(draft)
    if (!state) {
      state = { version: 0, scopes: new Map(), watchers: new Set() }
      codePreviewStates.set(draft, state)
    }
    const signature = codePreviewSignature(draft)
    if (state.signature !== signature) {
      clearTimeout(state.timer)
      state.version++
      state.signature = signature
      state.pending = false
      state.error = null
      try {
        validatePreparation(draft)
      } catch (error) {
        state.error = error
      }
    }
    return state
  }
  function codeIssueTargets(error, draft, group, variant, kind) {
    if (!error) return false
    if (error.conflict) {
      const { code, kind: codeKind } = error.conflict
      return codeKind === 'base'
        ? group.baseCode === code
        : kind === 'barcode' &&
            `${group.baseCode}${variant.variantSuffix}${variant.sizeSuffix}` ===
              code
    }
    const issue = error.packingIssue
    return (
      issue?.orderId === draft.orderId &&
      issue.groupId === group.id &&
      (!issue.variantId ||
        (kind === 'barcode' && issue.variantId === variant?.id))
    )
  }
  function codePreviewIssue(draft, group, variant, kind) {
    const state = codePreviewState(draft)
    if (codeIssueTargets(state.error, draft, group, variant, kind))
      return state.error
    const changed = [...state.scopes.values()].some(
      (scope) =>
        scope.groupId === group.id &&
        (!scope.variantId ||
          (kind === 'barcode' && scope.variantId === variant?.id))
    )
    if (!changed) return null
    if (state.error) return state.error
    return state.pending
      ? Object.assign(new Error('Checking product code…'), {
          previewPending: true,
        })
      : null
  }
  function refreshCodePreviews(draft, state) {
    for (const watcher of state.watchers) {
      if (!watcher.connected()) state.watchers.delete(watcher)
      else watcher.show(state.error)
    }
    if (!state.error)
      clearErrorNotice({
        scope: $('packing-view'),
        key: `packing:${draft.orderId}`,
      })
    media.refresh()
  }
  function issueLocation(error) {
    const issue = error.packingIssue || error.conflict?.requestedOwner || {}
    const row = issue.row || {}
    const orderId = issue.orderId || row.orderId || drafts[current]?.orderId
    const draft =
      drafts.find((entry) => entry.orderId === orderId) ||
      preparations.get(orderId)
    const group = draft?.groups.find(
      (entry) =>
        entry.id === (issue.groupId || row.groupId) ||
        entry.variants.some((variant) => variant.entryIds.includes(row.entryId))
    )
    const variant = group?.variants.find(
      (entry) =>
        entry.id === issue.variantId || entry.entryIds.includes(row.entryId)
    )
    const source = getRecords().find(
      (entry) => entry.snapshot.orderId === orderId
    )?.snapshot
    const item = source?.items.find(
      (entry) =>
        entry.entryId === row.entryId ||
        variant?.entryIds.includes(entry.entryId) ||
        (!variant &&
          group?.variants.some((variant) =>
            variant.entryIds.includes(entry.entryId)
          ))
    )
    return { ...issue, orderId, row, draft, group, variant, source, item }
  }
  async function revealPackingIssue(issue) {
    let draft = drafts.find((entry) => entry.orderId === issue.orderId)
    if (!draft && issue.draft) {
      draft = structuredClone(issue.draft)
      rememberSessionBaseline(draft.orderId)
      drafts.push(draft)
      checkpoints.set(draft.orderId, preparationHistorySnapshot(draft))
      historySaved.set(draft.orderId, draft)
    }
    if (!draft) return
    const entries = scopeEntries.get(draft.orderId) || new Set()
    for (const variant of (issue.group ? [issue.group] : draft.groups).flatMap(
      (group) => group.variants
    ))
      for (const id of variant.entryIds) entries.add(id)
    scopeEntries.set(draft.orderId, entries)
    packingOrders.clear()
    packingOrders.add(draft.orderId)
    current = drafts.indexOf(draft)
    groupPage = Math.max(
      0,
      Math.floor(
        scopedGroups(draft).findIndex((group) => group.id === issue.group?.id) /
          20
      )
    )
    if (issue.variant)
      variantPages.set(
        issue.group.id,
        Math.floor(
          scopedVariants(draft, issue.group).findIndex(
            (variant) => variant.id === issue.variant.id
          ) / 50
        )
      )
    $('orders-view').hidden = true
    $('packing-view').hidden = false
    document.body.classList.add('packing-active')
    renderPreparation()
    const host = document.querySelector(
      `[data-packing-order="${CSS.escape(draft.orderId)}"]`
    )
    const groupHost = issue.group
      ? host?.querySelector(`[data-group-id="${CSS.escape(issue.group.id)}"]`)
      : host
    const variantHost = issue.variant
      ? groupHost?.querySelector(
          `[data-variant-id="${CSS.escape(issue.variant.id)}"]`
        )
      : groupHost
    const field =
      issue.field === 'recovery'
        ? reloadPreparationButton
        : issue.field === 'seller'
          ? document.getElementById(`preparation-seller-${draft.orderId}`)
          : (issue.field === 'size' || issue.field === 'variant'
              ? variantHost
              : groupHost
            )?.querySelector(`[data-packing-field="${issue.field || 'code'}"]`)
    const target =
      field ||
      groupHost?.querySelector('input,button') ||
      host?.querySelector('button')
    if (target) {
      target.scrollIntoView({
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
        block: 'center',
      })
      target.focus({ preventScroll: true })
      target.classList.add('resolution-highlight')
      const remove = () => target.classList.remove('resolution-highlight')
      target.addEventListener('input', remove, { once: true })
      setTimeout(remove, 5000)
    }
  }
  function reviewPackingChanges(options) {
    return showPackingChanges({
      ...options,
      changes: options.changes.map((change) => ({
        ...change,
        sourceType: getRecords().find(
          ({ snapshot }) => snapshot.orderId === change.orderId
        )?.snapshot.sourceType,
      })),
    })
  }
  function packingErrorOptions(error, modal) {
    if (!error.packingIssue && !error.conflict && !error.focusId) return {}
    const issue = issueLocation(error)
    const context = {
      seller: issue.source?.sellerName,
      orderId: issue.orderId,
      sourceType: issue.source?.sourceType,
      code: issue.group?.baseCode || issue.row.baseCode,
      variant: issue.variant?.variant || issue.item?.title,
      thumbnail: issue.item?.thumbnail
        ? () => loadImage(issue.item.thumbnail)
        : undefined,
    }
    let action
    const closeForRecovery = async () => {
      if (!modal) return
      modal.close()
      // The originating copy action releases its disabled fieldset after close.
      await preparationIdle
    }
    if (
      issue.field === 'photo' &&
      issue.orderId &&
      onRefreshOrder &&
      issue.source?.sourceType !== 'spreadsheet'
    )
      action = {
        label: 'Refresh this order',
        onClick: async () => {
          await closeForRecovery()
          await onRefreshOrder(issue.orderId)
        },
      }
    else if (issue.field === 'labelSettings')
      action = {
        label: 'Review label settings',
        onClick: async () => {
          await closeForRecovery()
          return openSettings()
        },
      }
    else if (issue.field === 'name' && issue.labelKind && issue.variant)
      action = {
        label: 'Edit barcode',
        onClick: async () => {
          await closeForRecovery()
          return openLabel(
            issue.orderId,
            issue.group.id,
            issue.variant.id,
            'barcode'
          )
        },
      }
    else if (error.code === 'PACKING_REVISION_CONFLICT')
      action = {
        label: 'Reload saved version',
        onClick: async () => {
          await closeForRecovery()
          return reloadSavedOrder(issue.orderId)
        },
      }
    else if (error.conflict || error.code === 'PACKING_CODE_CONFLICT')
      action = {
        label: 'Resolve code',
        onClick: async () => {
          await closeForRecovery()
          return resolveConflict(issue.orderId, { error })
        },
      }
    else if (
      issue.draft &&
      ((issue.group && issue.field) || issue.field === 'seller')
    )
      action = {
        label:
          issue.field === 'size'
            ? 'Map size code'
            : issue.field === 'category' && !issue.value
              ? 'Add Chinese category'
              : 'Show affected field',
        onClick: async () => {
          await closeForRecovery()
          return revealPackingIssue(issue)
        },
      }
    else if (saveErrors.has(issue.orderId))
      action = {
        label: 'Review unsaved changes',
        onClick: async () => {
          await closeForRecovery()
          return revealPackingIssue({ ...issue, field: 'recovery' })
        },
      }
    return {
      context,
      action,
      detail: issue.value
        ? uiMessage('Value to review: {0}', { 0: issue.value })
        : '',
    }
  }
  function showSaveError(orderId, error) {
    error.packingIssue ||= {
      ...error.conflict?.requestedOwner,
      orderId,
      field: error.focusId ? 'seller' : undefined,
    }
    showErrorNotice(error.message || error, {
      ...packingErrorOptions(error),
      scope: $('packing-view'),
      key: `packing:${orderId}`,
      deduplicate: true,
      title: 'Not saved',
      detail: 'Your edits are still here.',
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
        : pendingSaves.has(id) || saveWork || arrangementSaving
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
    await flushMeasurements()
    for (const [key, entry] of cartonFields) {
      await entry.flush()
      if (!entry.input.isConnected) cartonFields.delete(key)
    }
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
        const codeSignature = codePreviewSignature(drafts[index])
        try {
          await saveDraft(index)
          saveErrors.delete(id)
          clearErrorNotice({ scope: $('packing-view'), key: `packing:${id}` })
        } catch (error) {
          pendingSaves.add(id)
          saveErrors.set(id, error)
          if (codeSignature === codePreviewSignature(drafts[index])) {
            const state = codePreviewState(drafts[index])
            state.error = error
            state.pending = false
            refreshCodePreviews(drafts[index], state)
          }
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
  async function flushMeasurements() {
    for (const [key, entry] of measurementFields) {
      await entry.flush()
      if (!entry.input.isConnected) measurementFields.delete(key)
    }
  }
  async function preparationAction(action) {
    if (preparationBusy) return
    preparationBusy = true
    let release
    preparationIdle = new Promise((resolve) => {
      release = resolve
    })
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
      release()
      if (focusId && !$('packing-view').hidden) $(focusId)?.focus()
    }
  }
  function prepButton(text, action, className) {
    return button(
      text,
      async () => {
        try {
          return await preparationAction(action)
        } catch (error) {
          error.noticeOptions = packingErrorOptions(error)
          throw error
        }
      },
      className
    )
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
  const getImageBadges = () =>
    createExcelImageBadges(preferences, currentExcelImageMode())
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
  const photoOwners = new WeakMap()
  function photoContext(item) {
    const owner = photoOwners.get(item)
    const record = getRecords().find(({ snapshot }) =>
      owner
        ? snapshot.orderId === owner.orderId &&
          snapshot.accountId === owner.accountId
        : item.orderId
          ? snapshot.orderId === item.orderId
          : snapshot.items.includes(item)
    )
    const orderId = record?.snapshot.orderId || item.orderId
    let match = membership.get(`${orderId}/${item.entryId}`)
    if (!$('packing-view').hidden) {
      const draft = drafts.find((entry) => entry.orderId === orderId)
      for (const group of draft?.groups || []) {
        const variant = group.variants.find((entry) =>
          entry.entryIds.includes(item.entryId)
        )
        if (variant) {
          match = { group, variant }
          break
        }
      }
    }
    let code = ''
    if (match) {
      try {
        code = barcodeValue(match.group, {
          ...match.variant,
          needsSizeMapping: false,
        })
      } catch {}
    }
    return {
      code,
      sellerName: record?.snapshot.sellerName || item.sellerName || '',
      spanishName: match?.variant.spanishName || match?.group.spanishName || '',
      quantity: item.quantity,
    }
  }
  const media = createPreparationMedia({
    container: null,
    loadImage,
    settings,
    logoUrl,
    getPhotoContext: photoContext,
    onPhotoEdit: async (item, edit) => {
      const owner = photoOwners.get(item)
      const record = getRecords().find(({ snapshot }) =>
        owner
          ? snapshot.orderId === owner.orderId &&
            snapshot.accountId === owner.accountId
          : snapshot.items.some((sourceItem) => sourceItem === item)
      )
      if (!record) throw new Error('Product photo was not found')
      photoOwners.set(item, {
        orderId: record.snapshot.orderId,
        accountId: record.snapshot.accountId,
      })
      await flushSaves()
      await repository.setProductPhoto(
        record.snapshot.orderId,
        item.entryId,
        edit,
        { accountId: record.accountId }
      )
      if (edit.photoIndex === 0) media.updatePhoto(item, edit.thumbnail)
      await changed({ reload: true })
    },
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
              .map((id) => {
                const item = items.get(id)
                if (item)
                  photoOwners.set(item, {
                    orderId: source.orderId,
                    accountId: source.accountId,
                  })
                return item
              })
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
    const next = preparationHistorySnapshot(draft),
      before = checkpoints.get(draft.orderId)
    if (before !== undefined)
      if (history.record(draft.orderId, before, next, mergeKey)) {
        scheduleSave(draft)
      }
    checkpoints.set(draft.orderId, next)
    updateHistoryButtons()
    const reset = resetButtons.get(draft.orderId)
    if (reset) reset.disabled = !hasDefaultPackingChanges(draft)
  }
  function rememberSavedPreparations(before, results) {
    const previous = new Map(before.map((draft) => [draft.orderId, draft]))
    const changes = results.flatMap((result) => {
      const old = previous.get(result.orderId)
      return old
        ? [
            {
              orderId: result.orderId,
              before: preparationHistorySnapshot(old),
              after: preparationHistorySnapshot(result),
            },
          ]
        : []
    })
    // Saved operations restore through the repository, including a single
    // hidden order whose rank was normalized while arranging the open packing.
    history.recordBatch(changes)
    for (const result of results) historySaved.set(result.orderId, result)
    updateHistoryButtons()
  }
  async function travel(direction) {
    await flushMeasurements()
    const result = history.peek(direction)
    if (!result) return
    const previousSaving = arrangementSaving
    if (result.changes) {
      arrangementSaving = true
      updateSaveStatus()
    }
    try {
      const changes = result.changes || [result]
      const candidates = changes.map(({ orderId, value }) => {
        const current =
          drafts.find((draft) => draft.orderId === orderId) ||
          historySaved.get(orderId)
        return restorePreparationHistory(value, current)
      })
      let restored = candidates
      if (result.changes) {
        // Reversing a saved operation must be just as atomic as the operation
        // itself. Never restore allocations, reservations or source data.
        try {
          restored = await repository.savePreparations(candidates, {
            preserveNaming: true,
            suffixBaselines: candidates,
            cartonMeasurements: changes
              .filter((change) => change.cartons)
              .map((change) => ({
                orderId: change.orderId,
                accountId: candidates.find(
                  (draft) => draft.orderId === change.orderId
                ).accountId,
                edits: measurementChanges(
                  change.expectedCartons,
                  change.cartons
                ),
              })),
          })
        } catch (error) {
          error.arrangementRecovery = true
          const orderId = error.packingIssue?.orderId || changes[0].orderId
          saveErrors.set(orderId, error)
          throw error
        }
        for (const draft of restored) {
          preparations.set(draft.orderId, draft)
          historySaved.set(draft.orderId, draft)
        }
      }
      history[direction]()
      for (const change of changes)
        if (change.cartons)
          rememberSessionCartonValues(change.orderId, change.cartons)
      for (const draft of restored) {
        const index = drafts.findIndex(
          (entry) => entry.orderId === draft.orderId
        )
        if (index < 0) continue
        const existing = new Set(
          drafts[index].groups.flatMap((group) =>
            group.variants.flatMap((variant) => variant.entryIds)
          )
        )
        drafts[index] = draft
        const restoredScope = changes.find(
          (change) => change.orderId === draft.orderId
        )?.scope
        const scope =
          restoredScope === undefined
            ? scopeEntries.get(draft.orderId) || new Set()
            : new Set(restoredScope)
        if (restoredScope === undefined)
          for (const group of draft.groups)
            for (const variant of group.variants)
              for (const id of variant.entryIds)
                if (!existing.has(id)) scope.add(id)
        const restoredIds = new Set(
          draft.groups.flatMap((group) =>
            group.variants.flatMap((variant) => variant.entryIds)
          )
        )
        for (const id of scope) if (!restoredIds.has(id)) scope.delete(id)
        scopeEntries.set(draft.orderId, scope)
        selectionStates.delete(draft.orderId)
        checkpoints.set(draft.orderId, preparationHistorySnapshot(draft))
        if (result.changes) acceptDraft(draft)
        else {
          historyRestores.set(draft.orderId, preparationHistorySnapshot(draft))
          scheduleSave(draft)
        }
      }
      drafts = arrangeOpenedDrafts(drafts)
      current = Math.max(
        0,
        drafts.findIndex((draft) => draft.orderId === changes[0].orderId)
      )
      const scopeChange = changes.find((change) => change.scope?.length)
      if (scopeChange) {
        packingOrders.clear()
        packingOrders.add(scopeChange.orderId)
      }
      if (result.changes) {
        await reload()
        await changed({ reload: true })
        channel?.postMessage('changed')
      }
      groupPage = 0
      renderPreparation()
    } finally {
      arrangementSaving = previousSaving
      updateSaveStatus()
    }
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
    arrangementPanel?.destroy()
    arrangementPanel = null
    printPanel?.destroy()
    printPanel = null
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
  document.addEventListener(
    'keydown',
    (event) => {
      if (
        $('packing-view').hidden ||
        event.isComposing ||
        event.defaultPrevented
      )
        return
      if (document.querySelector('dialog[open]')) return
      if (dismissCopyActionsOnEscape(event)) return
      // Let the notice's Escape handler dismiss feedback before leaving packing.
      if (
        event.key === 'Escape' &&
        $('packing-view').querySelector('.error-notice')
      )
        return
      if (
        event.key === 'Escape' &&
        !document.querySelector('dialog[open]') &&
        !(
          CSS.supports('selector(select:open)') &&
          document.querySelector('select:open')
        )
      ) {
        event.preventDefault()
        event.stopPropagation()
        void showOrders()
        return
      }
      if (
        !(event.ctrlKey || event.metaKey) ||
        !['a', 'd'].includes(event.key.toLowerCase()) ||
        event.altKey ||
        event.target.closest('input, textarea, select, [contenteditable]')
      )
        return
      event.preventDefault()
      event.stopPropagation()
      selectPackingRows(event.key.toLowerCase() === 'a')
    },
    true
  )
  addEventListener('beforeunload', (event) => {
    if (
      !pendingSaves.size &&
      !saveWork &&
      ![...cartonFields.values(), ...measurementFields.values()].some((field) =>
        field.dirty()
      )
    )
      return
    event.preventDefault()
    event.returnValue = ''
  })
  async function reload() {
    preparations = new Map(
      (await repository.listPreparations()).map((item) => [item.orderId, item])
    )
    preferences = await repository.getPackingPreferences()
    configureColorVocabulary(preferences.colorVocabulary)
    configureMaterialVocabulary(preferences.materialVocabulary)
    applyAppearance(preferences.appearance)
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
      if (data === 'preferences' || data === 'carton-capacity') {
        await changed({ reload: true })
        if (data === 'carton-capacity' && !$('packing-view').hidden)
          renderPreparation()
      } else {
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
    const { recordHistory = true, ...saveOptions } = options
    const before =
      drafts.find((entry) => entry.orderId === draft.orderId) ||
      preparations.get(draft.orderId)
    const result = await repository.savePreparation(draft, {
      expectedRevision: draft.revision,
      ...saveOptions,
    })
    if (recordHistory && before) rememberSavedPreparations([before], [result])
    else historySaved.set(result.orderId, result)
    rememberPreparation(result)
    changed()
    channel?.postMessage('changed')
    return result
  }
  function rememberPreparation(result) {
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
  }
  function outputModel(
    prep,
    group,
    variant,
    kind,
    editing = false,
    validate = false
  ) {
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
    if (
      !editing &&
      (validate || (kind === 'barcode' && variant?.needsSizeMapping))
    ) {
      const field =
        kind === 'barcode' && variant?.needsSizeMapping
          ? 'size'
          : kind === 'mark' && !group.category.trim()
            ? 'category'
            : kind === 'barcode' &&
                !(variant?.spanishName || group.spanishName)?.trim()
              ? 'name'
              : ''
      if (field) {
        const error = new Error(
          field === 'size'
            ? 'Map this variant size before generating labels'
            : field === 'category'
              ? 'Add a Chinese category before generating this carton mark.'
              : 'Add a Spanish name before generating this barcode.'
        )
        error.packingIssue = {
          orderId: prep.orderId,
          groupId: group.id,
          variantId: variant?.id,
          field,
          value: field === 'size' ? variant.size : '',
        }
        error.noticeOptions = packingErrorOptions(error)
        throw error
      }
    }
    if (!editing && !validate) {
      const error = codePreviewIssue(prep, group, variant, kind)
      if (error) {
        error.noticeOptions = packingErrorOptions(error)
        throw error
      }
    }
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
        if (variant.sizeSuffix) delete group.sizeMode
        variant.needsSizeMapping = next.needsSizeMapping
        variant.spanishName = next.spanishName.toUpperCase()
      }
      return draft
    }
    function acceptedModel(result) {
      prep = result
      acceptDraft(result)
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
        checkpoints.set(latest.orderId, preparationHistorySnapshot(latest))
      }
      renderPreparation()
    }
  })

  function packingRecord(row) {
    return getRecords().find(
      (record) =>
        record.snapshot.orderId === row.orderId &&
        (!row.record || record.accountId === row.record.accountId)
    )
  }
  let linkedPaymentRecords,
    linkedPaymentRows = new Set()
  function isLinkedPaymentSource(row) {
    const records = getRecords()
    if (linkedPaymentRecords !== records) {
      linkedPaymentRecords = records
      linkedPaymentRows = new Set()
      const sources = new Map(
        records.map((record) => [
          JSON.stringify([
            record.snapshot.accountId || 'local',
            record.snapshot.orderId,
          ]),
          record,
        ])
      )
      for (const record of records)
        for (const link of record.paymentLinks || []) {
          const accountId = record.snapshot.accountId || 'local'
          const source = sources.get(
            JSON.stringify([accountId, link.sourceOrderId])
          )
          const ids =
            link.sourceEntryId === undefined
              ? (source?.snapshot.items || []).map((item) => item.entryId)
              : [link.sourceEntryId]
          for (const id of ids)
            linkedPaymentRows.add(
              JSON.stringify([accountId, link.sourceOrderId, id])
            )
        }
    }
    return linkedPaymentRows.has(
      JSON.stringify([
        packingRecord(row)?.snapshot.accountId || 'local',
        row.orderId,
        row.entryId,
      ])
    )
  }
  function isPackingExcluded(row) {
    return Boolean(
      packingRecord(row)?.packingExcludedEntryIds?.includes(row.entryId) ||
      isLinkedPaymentSource(row)
    )
  }
  // `monthOnly` (the Packing list tab) reopens the packing month without
  // using the Orders selection; every other caller keeps the selection.
  function launchCandidates(orderId, entryId, { monthOnly = false } = {}) {
    if (orderId) {
      const source = getRecords().find(
        (record) => record.snapshot.orderId === orderId
      )?.snapshot
      return (source?.items || [])
        .filter((item) => !entryId || item.entryId === entryId)
        .map((item) => ({ ...item, orderId }))
    }
    const selected = monthOnly ? [] : getSelectedRows()
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
  function launchRows(orderId, entryId, options) {
    return launchCandidates(orderId, entryId, options).filter(
      (row) => !isPackingExcluded(row)
    )
  }
  async function changePackingExclusion(row, excluded, control) {
    if (opening || packingExclusionSaving) return
    const record = packingRecord(row)
    if (!record) return
    const keyboardFocus = control.matches(':focus-visible')
    packingExclusionSaving = true
    control.classList.add('is-saving')
    control.setAttribute('aria-busy', 'true')
    updateLaunchActions()
    try {
      // The callback saves before refreshing records. Never show an unsaved
      // exclusion or let preparation start against the previous record.
      await setPackingExcluded(
        row.orderId,
        [row.entryId],
        excluded,
        record.accountId || 'local'
      )
      feedback(
        uiMessage(
          excluded
            ? 'Product skipped for future packing. Saved codes are kept.'
            : 'Product included in future packing.'
        )
      )
    } finally {
      packingExclusionSaving = false
      control.classList.remove('is-saving')
      control.removeAttribute('aria-busy')
      updateLaunchActions()
      if (keyboardFocus && !control.isConnected) {
        const replacement = [
          ...document.querySelectorAll('.packing-exclusion-toggle'),
        ].find(
          (button) =>
            button.dataset.orderId === row.orderId &&
            button.dataset.entryId === row.entryId
        )
        if (document.activeElement === document.body)
          replacement?.focus({ preventScroll: true })
      }
    }
  }
  function packingExclusionAction(row, excluded) {
    const linkedPayment = isLinkedPaymentSource(row)
    const toggle = button(
      uiMessage(excluded ? 'Skipped' : 'Skip packing'),
      (control) => changePackingExclusion(row, !excluded, control),
      `packing-exclusion-toggle ${excluded ? 'packing-include-button' : 'packing-skip-button'}`
    )
    toggle.type = 'button'
    toggle.dataset.orderId = row.orderId
    toggle.dataset.entryId = row.entryId
    toggle.dataset.linkedPayment = String(linkedPayment)
    toggle.disabled = opening || packingExclusionSaving || linkedPayment
    if (linkedPayment)
      bindAttribute(
        toggle,
        'aria-label',
        uiMessage(
          'Linked payment source. Unlink the payment before including this row in packing.'
        )
      )
    else if (excluded)
      bindAttribute(
        toggle,
        'aria-label',
        uiMessage('Skipped — include in packing')
      )
    else decorateIcon(toggle, 'skip', { iconOnly: true, label: 'Skip packing' })
    preparationHelp(
      toggle,
      uiMessage(
        linkedPayment
          ? 'Linked payment source. Unlink the payment before including this row in packing.'
          : excluded
            ? 'Skipped when preparing packing. Click to include this product again; saved codes and product data are kept.'
            : 'Skip this product whenever packing is prepared. Saved codes and product data are kept. You can include it again here.'
      )
    )
    toggle.addEventListener('click', (event) => event.stopPropagation())
    toggle.addEventListener('dblclick', (event) => event.stopPropagation())
    return toggle
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
        const values = [
          {
            label: uiMessage('Product code'),
            before: old?.baseCode || uiMessage('Not prepared'),
            after: group.baseCode,
            kind: 'code',
          },
        ]
        for (const variant of group.variants) {
          const saved = old?.variants.find((entry) =>
            entry.entryIds.some((id) => variant.entryIds.includes(id))
          )
          const beforeCode =
            saved && old.baseCode
              ? `${old.baseCode}${saved.variantSuffix}${saved.sizeSuffix}`
              : ''
          const afterCode = `${group.baseCode}${variant.variantSuffix}${variant.sizeSuffix}`
          if (beforeCode !== afterCode)
            values.push({
              label:
                [variant.variant, variant.size].filter(Boolean).join(' · ') ||
                uiMessage('Barcode'),
              before: beforeCode || uiMessage('Not prepared'),
              after: afterCode,
              kind: 'code',
            })
          for (const id of variant.entryIds) {
            const beforeMaterial = saved ? variantMaterial(saved, id).value : ''
            const afterMaterial = variantMaterial(variant, id).value
            if (beforeMaterial !== afterMaterial)
              values.push({
                label: uiMessage('Material'),
                before: beforeMaterial,
                after: afterMaterial,
              })
          }
        }
        for (const [key, label] of [
          ['spanishName', 'Spanish short name'],
          ['category', 'Chinese category'],
        ])
          if ((old?.[key] || '') !== (group[key] || ''))
            values.push({
              label: uiMessage(label),
              before: old?.[key],
              after: group[key],
            })
        return {
          name: group.spanishName || group.title,
          order: source?.sellerName || draft.sellerId,
          orderId: draft.orderId,
          before: old?.baseCode,
          after: group.baseCode,
          values,
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
      checkpoints.set(draft.orderId, preparationHistorySnapshot(draft))
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
  async function openPreparation(orderId, entryId, launch = {}) {
    if (opening || packingExclusionSaving) return
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
      const rows = launchRows(orderId, entryId, launch)
      if (!rows.length && launchCandidates(orderId, entryId, launch).length)
        throw new Error(
          'All these products are skipped for packing. Choose Skipped on a product to include it.'
        )
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
      const openingBaselines = new Map(
        sourceOrders.map(({ snapshot }) => [
          snapshot.orderId,
          structuredClone(preparations.get(snapshot.orderId)),
        ])
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
          const named = refreshPreparationNames(draft, suggestNames, {
            replaceAutomatic: false,
          })
          const resolved = resolvePendingSizeMappings(
            named,
            preferences.sizeVocabulary,
            { snapshot, entryIds: ids.get(snapshot.orderId) }
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
      let assignOnly = false
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
      const reviewEntries = new Map(
        plan.scope.map(({ orderId, entryIds }) => {
          const assigned = new Set(
            (preparations.get(orderId)?.groups || [])
              .filter(
                (group) =>
                  group.baseCode &&
                  groupPackingMonth(preparations.get(orderId), group) === month
              )
              .flatMap((group) =>
                group.variants.flatMap((variant) => variant.entryIds)
              )
          )
          return [orderId, new Set(entryIds.filter((id) => !assigned.has(id)))]
        })
      )
      for (const change of plan.changes)
        for (const id of change.entryIds)
          reviewEntries.get(change.orderId).add(id)
      const reviewRowCount = [...reviewEntries.values()].reduce(
        (count, entries) => count + entries.size,
        0
      )
      if (reviewRowCount) {
        progress.update(
          'Review changes to continue',
          undefined,
          undefined,
          counts
        )
        const after = candidates
          .map((draft) => ({
            ...draft,
            groups: draft.groups
              .map((group) => ({
                ...group,
                variants: group.variants
                  .map((variant) => ({
                    ...variant,
                    entryIds: variant.entryIds.filter((id) =>
                      reviewEntries.get(draft.orderId).has(id)
                    ),
                  }))
                  .filter((variant) => variant.entryIds.length),
              }))
              .filter((group) => group.variants.length),
          }))
          .filter((draft) => draft.groups.length)
        const uniqueValues = (values) =>
          [...new Set(values.filter(Boolean))].join(' / ') || '—'
        const changes = after.flatMap((draft) => {
          const source = sourceOrders.find(
            ({ snapshot }) => snapshot.orderId === draft.orderId
          ).snapshot
          return reviewChanges([...preparations.values()], [draft]).map(
            (change, index) => {
              const group = draft.groups[index]
              const entryIds = new Set(
                group.variants.flatMap((variant) => variant.entryIds)
              )
              const items = source.items.filter((item) =>
                entryIds.has(item.entryId)
              )
              return {
                ...change,
                after: draft.sellerId.trim()
                  ? change.after
                  : uiMessage('Seller login required before assigning codes'),
                values: change.values.map((value, index) =>
                  !index && !draft.sellerId.trim()
                    ? {
                        ...value,
                        after: uiMessage(
                          'Seller login required before assigning codes'
                        ),
                      }
                    : value
                ),
                detail: uiMessage(
                  '{scope} · Packing month: {month}. Spanish: {spanish} · Chinese: {category}. Size codes: {sizes} · Colors: {colors} · Materials: {materials}.',
                  {
                    scope: change.detail,
                    month: () => monthLabel(month),
                    spanish: group.spanishName || '—',
                    category: group.category || '—',
                    sizes: () =>
                      uniqueValues(
                        group.variants.map((variant) =>
                          variant.needsSizeMapping
                            ? t('Choose a size code')
                            : variant.sizeSuffix
                        )
                      ),
                    colors: () =>
                      uniqueValues(
                        items.flatMap((item) =>
                          getItemColorHints(item, getLanguage()).map(
                            (hint) => hint.label
                          )
                        )
                      ),
                    materials: () =>
                      uniqueValues(
                        group.variants.flatMap((variant) =>
                          variant.entryIds.map((id) =>
                            translateMaterial(
                              variantMaterial(variant, id).value,
                              getLanguage()
                            )
                          )
                        )
                      ),
                  }
                ),
              }
            }
          )
        })
        const reviewResult = await reviewPackingChanges({
          title: hasMove
            ? uiMessage('Move selected products to this packing month?')
            : uiMessage('Assign product codes?'),
          explanation: uiMessage(
            '{rows} selected product rows from {orders} orders will be prepared for {month}. {detail}',
            {
              rows: reviewRowCount,
              orders: after.length,
              month: () => monthLabel(month),
              detail: hasMove
                ? uiMessage(
                    '{codes} group codes and their barcodes will change. {splits} partial groups will be split; unselected products keep their month and codes. Codes no longer in use become available. You can restore the previous packing later if its codes are available.',
                    {
                      codes: plan.changedCodeCount,
                      splits: plan.splitGroupCount,
                    }
                  )
                : uiMessage(
                    'Review the new or unassigned products below before opening packing. Names, sizes, colors and materials use saved edits or available suggestions. Orders without a seller remain editable and receive codes after you identify the seller.'
                  ),
            }
          ),
          changes,
          proceed: hasMove
            ? uiMessage('Change codes and prepare')
            : uiMessage('Assign codes and prepare'),
          alternate:
            !hasMove && eligible.length === candidates.length
              ? {
                  label: uiMessage('Assign only'),
                  value: 'assign-only',
                  help: uiMessage(
                    'Save the proposed codes and product helpers, then stay in Orders with your selection unchanged.'
                  ),
                }
              : undefined,
          media,
        })
        if (!reviewResult) return
        assignOnly = reviewResult === 'assign-only'
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
      if (assignOnly) {
        feedback(
          uiMessage(
            'Codes assigned to {0} products. Your selection stays in Orders.',
            {
              0: reviewRowCount,
            }
          )
        )
        return
      }
      drafts = arrangeOpenedDrafts(candidates)
      scopeEntries.clear()
      for (const scope of plan.scope)
        scopeEntries.set(scope.orderId, new Set(scope.entryIds))
      packingOrders.clear()
      if (drafts.length === 1) packingOrders.add(drafts[0].orderId)
      current = 0
      groupPage = 0
      history.clear()
      checkpoints.clear()
      historySaved.clear()
      historyRestores.clear()
      sessionBaselines.clear()
      sessionCartons.clear()
      sessionCartonValues.clear()
      for (const [orderId, baseline] of openingBaselines) {
        sessionBaselines.set(orderId, baseline)
        rememberCartonBaseline(orderId)
      }
      for (const draft of drafts) historySaved.set(draft.orderId, draft)
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
    function approveCodePreviews() {
      const state = codePreviewState(draft)
      clearTimeout(state.timer)
      state.version++
      state.error = null
      state.pending = false
      state.scopes.clear()
      refreshCodePreviews(draft, state)
    }
    if (samePreparation(draft, preparations.get(draft.orderId))) {
      // A reverted edit already matches saved ownership, even if a rerender
      // disconnected its field before the deferred validator could run.
      approveCodePreviews()
      historyRestores.delete(draft.orderId)
      updateHistoryButtons()
      return draft
    }
    const previous = preparations.get(draft.orderId)
    const clearedGroup = draft.groups.find(
      (group) =>
        !group.baseCode &&
        previous?.groups.some((old) => old.id === group.id && old.baseCode)
    )
    if (clearedGroup)
      throw Object.assign(
        new Error(
          'Enter a complete product code. Clearing an assigned code cannot create a new one.'
        ),
        {
          packingIssue: {
            orderId: draft.orderId,
            groupId: clearedGroup.id,
            field: 'code',
          },
        }
      )
    const submitted = structuredClone(draft)
    const result = await saved(submitted, {
      recordHistory: false,
      suffixBaselines: [restoredSuffixBaseline(submitted)].filter(Boolean),
      preserveNaming:
        historyRestores.get(draft.orderId) ===
        preparationHistorySnapshot(submitted),
    })
    historyRestores.delete(draft.orderId)
    history.breakGroup()
    acknowledgePreparation(draft, submitted, result)
    // Only the exact code values accepted by this write can become previewable.
    if (codePreviewSignature(submitted) === codePreviewSignature(draft))
      approveCodePreviews()
    const next = preparationHistorySnapshot(draft)
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
  function restoredSuffixBaseline(draft) {
    const value = historyRestores.get(draft.orderId)
    return value ? restorePreparationHistory(JSON.parse(value), draft) : null
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
    if (!source || source.sourceType === 'spreadsheet') return
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
    const recoverArrangement = saveErrors.get(orderId)?.arrangementRecovery
    const activeId = drafts[current]?.orderId
    await reload()
    const index = drafts.findIndex((draft) => draft.orderId === orderId)
    const latest = preparations.get(orderId)
    if (index >= 0 && latest) drafts[index] = structuredClone(latest)
    else if (index >= 0) {
      drafts.splice(index, 1)
      scopeEntries.delete(orderId)
      packingOrders.delete(orderId)
      selectionStates.delete(orderId)
    }
    pendingSaves.delete(orderId)
    saveErrors.delete(orderId)
    clearErrorNotice({ scope: $('packing-view'), key: `packing:${orderId}` })
    history.clear(orderId)
    historyRestores.delete(orderId)
    if (latest) {
      checkpoints.set(orderId, preparationHistorySnapshot(latest))
      historySaved.set(orderId, latest)
    } else checkpoints.delete(orderId)
    if (recoverArrangement) {
      // An external arrangement may change several ranks in one transaction.
      // Refresh all clean drafts together, retaining unrelated pending edits.
      for (const draft of [...drafts]) {
        if (pendingSaves.has(draft.orderId) || saveErrors.has(draft.orderId))
          continue
        const saved = preparations.get(draft.orderId)
        if (saved) {
          history.clear(saved.orderId)
          acceptDraft(saved)
        }
      }
      drafts = arrangeOpenedDrafts(drafts)
      current = Math.max(
        0,
        drafts.findIndex((draft) => draft.orderId === activeId)
      )
    }
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
    historySaved.set(result.orderId, result)
    historyRestores.delete(result.orderId)
    checkpoints.set(result.orderId, preparationHistorySnapshot(result))
  }
  function repeatProductControl(host, prep, group) {
    if (!group.baseCode || !repository.getRepeatProductCandidates) return
    mountRepeatProductControl(host, {
      source: {
        accountId: prep.accountId,
        orderId: prep.orderId,
        groupId: group.id,
      },
      linked: Boolean(group.sharedProductId),
      repository,
      media,
      beforeOpen: flushSaves,
      onSaved: async (results) => {
        for (const result of results) {
          acceptDraft(result)
          // Linking changes several orders; older per-order Undo cannot split it.
          history.clear(result.orderId)
        }
        await reload()
        if (!$('packing-view').hidden) renderPreparation()
        await changed()
        channel?.postMessage('changed')
      },
      onError: (error) => feedback(error.message, true),
    })
  }
  function operationsStrip(host, record, entryId) {
    if (!record) return
    mountOperationsStrip(host, {
      record,
      entryId,
      onEdit: () => {
        void (async () => {
          await flushSaves()
          await openOperationsDialog({
            record,
            entryId,
            records: getRecords(),
            repository,
            onSaved: async () => {
              await changed({ reload: true })
              if (!$('packing-view').hidden) renderPreparation()
              channel?.postMessage('changed')
            },
          })
        })().catch((error) => feedback(error.message, true))
      },
    })
  }
  async function reviewPriceSizes(orderId, groupId) {
    await flushSaves()
    const draft = drafts.find((entry) => entry.orderId === orderId)
    const group = draft?.groups.find((entry) => entry.id === groupId)
    const source = getRecords().find(
      (record) => record.snapshot.orderId === orderId
    )?.snapshot
    if (!group || !source) return
    const suggestions = suggestPriceSizeMappings(
      group,
      source,
      preferences.sizeVocabulary
    )
    if (!suggestions.length) return
    const scope = scopeEntries.get(orderId)
    if (
      suggestions.some((suggestion) =>
        group.variants
          .find((variant) => variant.id === suggestion.variantId)
          .entryIds.some((id) => !scope?.has(id))
      )
    )
      return
    const changes = suggestions.map(({ variantId, sizeSuffix, price }) => {
      const variant = group.variants.find((entry) => entry.id === variantId)
      const item = source.items.find((entry) =>
        variant.entryIds.includes(entry.entryId)
      )
      return {
        name: variant.size || item?.description || group.title,
        photo: item,
        order: source.sellerName,
        orderId,
        before: `${group.baseCode}${variant.variantSuffix}${variant.sizeSuffix}`,
        after: `${group.baseCode}${variant.variantSuffix}${sizeSuffix}`,
        detail: uiMessage('Unit price ¥{price} · Suggested size {size}', {
          price: normalizePrice(price),
          size: sizeSuffix,
        }),
      }
    })
    if (
      !(await reviewPackingChanges({
        title: uiMessage('Review size suggestions'),
        explanation: uiMessage(
          'Price is only a clue. These matching variants have no reliable measurements. Confirm that the cheaper one is smaller (S) and the more expensive one is larger (L). Only the two size endings shown below will change.'
        ),
        changes,
        proceed: uiMessage('Apply these size codes'),
        media,
      }))
    )
      return
    const candidate = structuredClone(draft)
    const target = candidate.groups.find((entry) => entry.id === groupId)
    for (const suggestion of suggestions) {
      const variant = target.variants.find(
        (entry) => entry.id === suggestion.variantId
      )
      variant.sizeSuffix = suggestion.sizeSuffix
      variant.needsSizeMapping = false
    }
    let result
    try {
      result = await saved(candidate)
    } catch (error) {
      if (!error.conflict) throw error
      error.packingIssue = {
        ...error.conflict.requestedOwner,
        orderId,
        groupId: error.conflict.requestedOwner?.groupId || groupId,
        field: 'size',
      }
      // The proposed endings exist only in this reviewed candidate. Resolve
      // against it so a reserved barcode changes its variant, not the base code.
      result = await resolveConflict(orderId, { candidate, error })
    }
    if (!result) return
    acceptDraft(result)
    renderPreparation()
  }
  async function changeGroupSizeMode(orderId, groupId, mode) {
    await flushSaves()
    const draft = drafts.find((entry) => entry.orderId === orderId)
    const group = draft?.groups.find((entry) => entry.id === groupId)
    if (!group || (group.sizeMode || 'automatic') === mode) return
    const snapshot = getRecords().find(
      (record) => record.snapshot.orderId === orderId
    )?.snapshot
    const candidate = setGroupSizeMode(draft, groupId, mode, {
      snapshot,
      sizeVocabulary: preferences.sizeVocabulary,
    })
    const nextGroup = candidate.groups.find((entry) => entry.id === groupId)
    const nextVariants = new Map(
      nextGroup.variants.map((variant) => [variant.id, variant])
    )
    const items = new Map(
      snapshot?.items.map((item) => [item.entryId, item]) || []
    )
    const changes = group.variants.flatMap((variant) => {
      const next = nextVariants.get(variant.id)
      // Recognition flags can change without changing any printed code.
      const before = `${group.baseCode}${variant.variantSuffix}${variant.sizeSuffix}`
      const after = `${nextGroup.baseCode}${next.variantSuffix}${next.sizeSuffix}`
      if (before === after) return []
      const item = variant.entryIds.map((id) => items.get(id)).find(Boolean)
      return [
        {
          name:
            item?.description || item?.title || variant.variant || group.title,
          photo: item,
          order: snapshot?.sellerName || draft.sellerId,
          orderId,
          before,
          after,
        },
      ]
    })
    if (
      changes.length &&
      !(await reviewPackingChanges({
        title: uiMessage('Change size handling?'),
        explanation: uiMessage(
          mode === 'none'
            ? 'These variants have no size difference. Remove only their size endings and keep their variant letters, source descriptions and other products unchanged. This choice is remembered for this product.'
            : 'Use automatic size recognition for this product again. Blank size endings will be checked against its source descriptions; unclear sizes remain for review.'
        ),
        changes,
        itemKind: 'products',
        proceed: uiMessage('Apply size handling'),
        media,
      }))
    )
      return
    let result
    try {
      result = await saved(candidate)
    } catch (error) {
      if (!error.conflict) throw error
      result = await resolveConflict(orderId, { candidate, error })
    }
    if (!result) return
    acceptDraft(result)
    renderPreparation()
  }
  async function restorePacking(draft, previous) {
    if (!previous && !hasDefaultPackingChanges(draft)) return
    const restore = previous ? restorePreviousPacking : restoreDefaultPacking
    const restoring = restore(draft)
    const [candidate] = await repository.previewPreparations([restoring], {
      preserveNaming: true,
      suffixBaselines: [restoring],
    })
    if (
      !(await reviewPackingChanges({
        title: previous
          ? uiMessage('Restore previous packing?')
          : uiMessage('Reset order and codes?'),
        explanation: previous
          ? uiMessage(
              'This replaces this order’s current grouping, codes, names and variant settings with the setup saved before its last month move. Later edits will be lost. Other orders are unchanged. Restoration checks for codes currently used by other products.'
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
    const beforeScope = JSON.stringify([
      ...(scopeEntries.get(draft.orderId) || []),
    ])
    const result = await saved(candidate, {
      expectedRevision: draft.revision,
      preserveNaming: true,
      recordHistory: false,
      suffixBaselines: [restoring],
    })
    acceptDraft(result)
    const source = getRecords().find(
      (record) => record.snapshot.orderId === result.orderId
    )?.snapshot
    const activeIds = new Set(
      activeGroups(result, source).flatMap((group) =>
        group.variants.flatMap((variant) => variant.entryIds)
      )
    )
    // Reset and previous-packing restore alter authoring, not the products the
    // user chose to keep in this session. Never resurrect excluded products.
    const afterScope = JSON.stringify(
      JSON.parse(beforeScope).filter((id) => activeIds.has(id))
    )
    scopeEntries.set(result.orderId, new Set(JSON.parse(afterScope)))
    history.recordBatch([
      {
        orderId: draft.orderId,
        before: preparationHistorySnapshot(draft),
        after: preparationHistorySnapshot(result),
        beforeScope,
        afterScope,
      },
    ])
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
      const values = [
        ...(card.values || [
          {
            label: uiMessage('Product code'),
            before: change.before?.baseCode,
            after: change.after?.baseCode,
            kind: 'code',
          },
        ]),
      ]
      if (change.orderChanged)
        values.push({
          label: uiMessage('Position'),
          before: change.beforePosition,
          after: change.afterPosition,
        })
      if (change.variantOrderChanged)
        values.push({
          label: uiMessage('Product order'),
          before: change.before.variants.map(
            (variant) =>
              variant.variant ||
              variant.size ||
              `${change.before.baseCode}${variant.variantSuffix}${variant.sizeSuffix}`
          ),
          after: change.after.variants.map(
            (variant) =>
              variant.variant ||
              variant.size ||
              `${change.after.baseCode}${variant.variantSuffix}${variant.sizeSuffix}`
          ),
        })
      if (change.groupingChanged)
        details.push(uiMessage('Restore original grouping'))
      if (change.clearedManualOrdering)
        details.push(uiMessage('Clear manual sorting'))
      if (change.sizeModeChanged)
        values.push({
          label: uiMessage('Size handling'),
          before: uiMessage(
            change.before?.sizeMode === 'none'
              ? 'No size difference'
              : 'Automatic sizes'
          ),
          after: uiMessage(
            change.after?.sizeMode === 'none'
              ? 'No size difference'
              : 'Automatic sizes'
          ),
        })
      for (const code of change.barcodeChanges)
        if (
          !values.some(
            (value) =>
              value.before === code.before && value.after === code.after
          )
        )
          values.push({
            label: uiMessage('Barcode'),
            before: code.before,
            after: code.after,
            kind: 'code',
          })
      return {
        ...card,
        values,
        detail: uiMessage('{0}', { 0: () => details.map(String).join(' · ') }),
      }
    })
  }
  async function removePackingProducts(draft, entryIds) {
    await flushSaves()
    const ids = [...new Set(entryIds)]
    if (!ids.length) return
    const record = getRecords().find(
      (record) => record.snapshot.orderId === draft.orderId
    )
    const source = record?.snapshot
    const beforeCartons = {},
      afterCartons = {}
    for (const id of ids) {
      const expected = sessionCartonValues.get(draft.orderId)?.[id] || {}
      const keys = Object.keys(expected)
      const item = source?.items.find((item) => item.entryId === id)
      if (!keys.length || !item) continue
      const current = productCartonDetails(item, record),
        baseline = sessionCartons.get(draft.orderId)?.[id] || {}
      if (
        [...keys].some((key) => (current[key] ?? '') !== (expected[key] ?? ''))
      )
        throw new Error(
          'Carton measurements changed in another tab. Reload before saving your edits.'
        )
      if (
        [...keys].every((key) => (current[key] ?? '') === (baseline[key] ?? ''))
      )
        continue
      beforeCartons[id] = Object.fromEntries(
        [...keys].map((key) => [key, current[key] ?? ''])
      )
      afterCartons[id] = Object.fromEntries(
        [...keys].map((key) => [key, baseline[key] ?? ''])
      )
    }
    const candidate = discardPreparationProducts(
      draft,
      sessionBaselines.get(draft.orderId),
      ids
    )
    const beforeProducts = preparationProducts(draft)
    const afterProducts = preparationProducts(candidate)
    const removed = new Set(ids)
    const changes = [...beforeProducts].flatMap(([id, before]) => {
      const item = source?.items.find((item) => item.entryId === id)
      const after = afterProducts.get(id)
      const code = (product) =>
        product?.group.baseCode
          ? `${product.group.baseCode}${product.variant.variantSuffix}${product.variant.sizeSuffix}`
          : ''
      const grouping = (product) =>
        product
          ? uiMessage('{0} product rows · {1} variants', {
              0: product.group.variants.reduce(
                (sum, variant) => sum + variant.entryIds.length,
                0
              ),
              1: product.group.variants.length,
            })
          : ''
      const values = [
        [
          'Product code',
          before.group.baseCode,
          after?.group.baseCode || '',
          'code',
        ],
        ['Barcode', code(before), code(after), 'code'],
        [
          'Spanish name',
          before.variant.spanishName ?? before.group.spanishName,
          after ? (after.variant.spanishName ?? after.group.spanishName) : '',
        ],
        [
          'Chinese category',
          before.group.category,
          after?.group.category || '',
        ],
        [
          'Material',
          translateMaterial(
            variantMaterial(before.variant, id).value,
            getLanguage()
          ),
          after
            ? translateMaterial(
                variantMaterial(after.variant, id).value,
                getLanguage()
              )
            : '',
        ],
        [
          'Size handling',
          uiMessage(
            before.group.sizeMode === 'none'
              ? 'No size difference'
              : 'Automatic sizes'
          ),
          after
            ? uiMessage(
                after.group.sizeMode === 'none'
                  ? 'No size difference'
                  : 'Automatic sizes'
              )
            : '',
        ],
        [
          'Packing month',
          monthLabel(groupPackingMonth(draft, before.group)),
          after ? monthLabel(groupPackingMonth(candidate, after.group)) : '',
        ],
        ['Variant', before.variant.variant, after?.variant.variant || ''],
        ['Size', before.variant.size, after?.variant.size || ''],
        ['Grouping', grouping(before), grouping(after)],
        ...['kg', 'cbm'].flatMap((field) => {
          if (!beforeCartons[id] || !Object.hasOwn(beforeCartons[id], field))
            return []
          const current = productCartonDetails(item, record),
            baseline = { ...current, ...afterCartons[id] }
          return [
            [
              field === 'kg' ? 'Weight (kg/box)' : 'Volume (m³/box)',
              formatCartonMeasurement(
                field === 'kg' ? current.kg : cartonVolume(current),
                field
              ),
              formatCartonMeasurement(
                field === 'kg' ? baseline.kg : cartonVolume(baseline),
                field
              ),
            ],
          ]
        }),
        [
          'Product rows',
          before.variant.entryIds.length,
          after?.variant.entryIds.length || '',
        ],
        ...(after
          ? [
              [
                'Group position',
                draft.groups.indexOf(before.group) + 1,
                candidate.groups.indexOf(after.group) + 1,
              ],
              [
                'Product position',
                before.group.variants.indexOf(before.variant) + 1,
                after.group.variants.indexOf(after.variant) + 1,
              ],
            ]
          : []),
      ]
        .filter(([, before, after]) => String(before) !== String(after))
        .map(([label, before, after, kind]) => ({
          label: uiMessage(label),
          before,
          after,
          kind,
        }))
      if (!removed.has(id) && !values.length) return []
      if (removed.has(id))
        values.unshift({
          label: uiMessage('Packing'),
          before: uiMessage('In this packing'),
          after: uiMessage('Removed from packing'),
        })
      return [
        {
          name: item?.description || before.group.title,
          photo: item,
          values,
          detail: uiMessage(
            removed.has(id)
              ? after
                ? 'Saved values from before this preparation session will be restored.'
                : 'Newly prepared product: returns to unassigned.'
              : scopeEntries.get(draft.orderId)?.has(id)
                ? 'This product stays in packing. Its shared group or position will also change.'
                : 'This product is outside this packing. Its shared group or position will also change.'
          ),
          order: source?.sellerName,
          orderId: draft.orderId,
        },
      ]
    })
    if (
      !(await reviewPackingChanges({
        title: uiMessage('Remove from packing?'),
        explanation: uiMessage(
          '{count} selected products will leave this packing. Their preparation edits from this session will be discarded, including saved edits. Previously prepared products return to their earlier values; newly prepared products become unassigned. Review any shared group changes below. Original order data is kept.',
          { count: ids.length }
        ),
        changes,
        itemKind: 'products',
        proceed: uiMessage('Remove from packing'),
        media,
      }))
    )
      return
    const beforeScope = JSON.stringify([
      ...(scopeEntries.get(draft.orderId) || []),
    ])
    const afterScope = JSON.stringify(
      JSON.parse(beforeScope).filter((id) => !removed.has(id))
    )
    const saveOptions = {
      recordHistory: false,
      preserveNaming: true,
      suffixBaselines: [sessionBaselines.get(draft.orderId)].filter(Boolean),
      cartonMeasurements: Object.keys(beforeCartons).length
        ? [
            {
              orderId: draft.orderId,
              accountId: draft.accountId,
              edits: measurementChanges(beforeCartons, afterCartons),
            },
          ]
        : [],
    }
    let result
    const relatedCorrections = []
    try {
      result = await saved(candidate, saveOptions)
    } catch (error) {
      if (!error.conflict) throw error
      result = await resolveConflict(draft.orderId, {
        candidate,
        error,
        saveOptions,
        discard: true,
        onRelatedSaved(before, results) {
          for (const result of results) {
            const old = before.find((entry) => entry.orderId === result.orderId)
            if (old)
              relatedCorrections.push({
                orderId: result.orderId,
                before: preparationHistorySnapshot(old),
                after: preparationHistorySnapshot(result),
              })
          }
        },
      })
    }
    if (!result) return
    history.recordBatch([
      ...relatedCorrections,
      {
        orderId: draft.orderId,
        before: preparationHistorySnapshot(draft),
        after: preparationHistorySnapshot(result),
        beforeScope,
        afterScope,
        ...(Object.keys(beforeCartons).length
          ? {
              beforeCartons: JSON.stringify(beforeCartons),
              afterCartons: JSON.stringify(afterCartons),
            }
          : {}),
      },
    ])
    acceptDraft(result)
    rememberSessionCartonValues(draft.orderId, afterCartons)
    if (Object.keys(beforeCartons).length) await changed({ reload: true })
    const scope = scopeEntries.get(draft.orderId)
    for (const id of ids) scope?.delete(id)
    selectionStates.delete(draft.orderId)
    renderPreparation()
    updateLaunchActions()
  }
  async function applySelectedGrouping(operation) {
    await flushSaves()
    const entries = selectedGroupingEntries()
    const availability = groupingAvailability(entries)[operation]
    if (availability.reason) return
    groupingPanel?.panel.hidePopover()
    const candidates = await regroupSelection(entries, operation, {
      getReservedBarcodes: (...args) => repository.getReservedBarcodes(...args),
      sizeVocabulary: preferences.sizeVocabulary,
    })
    const before = candidates.map((candidate) =>
      drafts.find((draft) => draft.orderId === candidate.orderId)
    )
    const preview = await repository.previewPreparations(candidates)
    const titles = {
      share: 'Share one barcode?',
      separate: 'Separate the original product rows?',
      split: 'Move variants to a new product group?',
      merge: 'Merge selected product groups?',
    }
    const explanations = {
      share:
        'Selected variants share one barcode within each affected group. Different groups and orders remain separate. Original prices and quantities are kept. Codes no longer in use become available.',
      separate:
        'Each selected combined variant becomes one barcode per original source row. New endings avoid codes currently used by other products. Other variants stay unchanged.',
      split:
        'Selected variants move into a new product group within each source order. Unselected variants keep their product code. Codes no longer in use become available.',
      merge:
        'Selected groups in this order share the first product code and carton mark. Barcode endings may change to stay unique. Codes no longer in use become available.',
    }
    if (
      !(await reviewPackingChanges({
        title: uiMessage(titles[operation]),
        explanation: uiMessage(explanations[operation]),
        changes: groupingReviewChanges(
          availability.entries,
          preview,
          getRecords()
        ),
        itemKind: 'products',
        proceed: uiMessage('Apply changes'),
        media,
      }))
    )
      return
    const selected = new Map(
      entries.map(({ draft }) => [draft.orderId, new Set()])
    )
    for (const { draft, variants } of entries)
      for (const variant of variants)
        for (const id of variant.entryIds) selected.get(draft.orderId).add(id)
    const results = await repository.savePreparations(preview, {
      expectedRevisions: before.map((draft) => draft.revision),
    })
    rememberSavedPreparations(before, results)
    for (const result of results) {
      acceptDraft(result)
      selectionStates.delete(result.orderId)
      const state = preparationSelection(result)
      const ids = selected.get(result.orderId)
      for (const group of scopedGroups(result)) {
        const variants = scopedVariants(result, group)
        const chosen = variants.filter((variant) =>
          variant.entryIds.some((id) => ids.has(id))
        )
        if (chosen.length === variants.length) state.groups.add(group.id)
        else
          for (const variant of chosen)
            state.variants.get(group.id).selected.add(variant.id)
      }
    }
    await reload()
    renderPreparation()
    changed()
    channel?.postMessage('changed')
  }
  async function resolveConflict(orderId, options = {}) {
    if (saveWork) await saveWork.catch(() => {})
    clearErrorNotice({ scope: $('packing-view'), key: `packing:${orderId}` })
    const index = drafts.findIndex((draft) => draft.orderId === orderId),
      sourceDraft = options.candidate || drafts[index]
    const draft = sourceDraft && structuredClone(sourceDraft)
    if (!draft) return
    const error = options.error || saveErrors.get(orderId)
    let resolved = null
    const code =
      error?.conflict?.code || error?.message?.match(/CE\d{8}[A-Z0-9]*/)?.[0]
    const previous = preparations.get(orderId)
    // Keep corrections isolated until the complete final ownership set can be
    // checked and committed together. The same order shares one proposal.
    const proposals = new Map([[orderId, draft]])
    const baselines = new Map([[orderId, previous]])
    const initialProposals = new Map([[orderId, structuredClone(draft)]])
    const editorKey = (id, groupId) => JSON.stringify([id, groupId])
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
          ? undefined
          : uiMessage(
              error?.message || 'Review the product codes in this order.'
            ),
        'conflict-explanation'
      )
    )
    if (code)
      modal.lastChild.append(
        el('code', code, 'ce-code'),
        el(
          'span',
          uiMessage(
            "Edit either product's codes. Apply saves both corrections together."
          )
        )
      )
    if (options.discard)
      modal.append(
        el(
          'p',
          uiMessage(
            'Removing these products would restore a code now assigned elsewhere. Choose a free code for the restored product, then apply to finish removing it from this packing. Cancel keeps the current packing unchanged.'
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
    const editFields = new Map(),
      editorReads = new Map()
    const previewUpdates = new Map()
    const editorStatus = el('p', '', 'conflict-editor-status')
    editorStatus.id = `conflict-feedback-${crypto.randomUUID()}`
    editorStatus.setAttribute('role', 'status')
    editorStatus.hidden = true
    let saving = false,
      lastCodeInput
    function showProposal(message) {
      for (const [input, read] of editorReads) {
        input.value = read()
        refreshCodeInput(input)
        input.removeAttribute('aria-invalid')
        input.removeAttribute('aria-errormessage')
      }
      for (const update of previewUpdates.values()) update()
      bindText(editorStatus, uiMessage(message))
      editorStatus.dataset.state = 'proposal'
      editorStatus.hidden = false
    }
    const complete = async () => {
      if (saving) return
      saving = true
      const controls = [...modal.querySelectorAll('button,input,select')]
      const disabled = controls.map((control) => control.disabled)
      controls.forEach((control) => {
        control.disabled = true
      })
      try {
        if (saveWork) await saveWork.catch(() => {})
        clearTimeout(saveTimer)
        const candidates = [...proposals.values()].filter(
          (proposal) =>
            proposal.orderId === orderId ||
            !samePreparation(proposal, initialProposals.get(proposal.orderId))
        )
        const { recordHistory = true, ...saveOptions } =
          options.saveOptions || {}
        // Check every revision and reserve the final code set in one existing
        // repository transaction, allowing corrections and swaps on both sides.
        const results = await repository.savePreparations(candidates, {
          ...saveOptions,
          suffixBaselines: candidates
            .map(
              (proposal) =>
                saveOptions.suffixBaselines?.find(
                  (baseline) =>
                    baseline.orderId === proposal.orderId &&
                    baseline.accountId === proposal.accountId
                ) || restoredSuffixBaseline(proposal)
            )
            .filter(Boolean),
          ...Object.fromEntries(
            ['capturePrevious', 'resetDefaults'].flatMap((key) =>
              saveOptions[key] === true ? [[key, [orderId]]] : []
            )
          ),
        })
        const before = candidates
          .map((proposal) => baselines.get(proposal.orderId))
          .filter(Boolean)
        if (recordHistory) rememberSavedPreparations(before, results)
        else
          options.onRelatedSaved?.(
            before,
            results.filter((result) => result.orderId !== orderId)
          )
        const result = results.find((result) => result.orderId === orderId)
        for (const saved of results) {
          rememberPreparation(saved)
          if (saved.orderId !== orderId || !options.candidate)
            acceptDraft(saved)
        }
        changed()
        channel?.postMessage('changed')
        resolved = result
        modal.close()
        if (!options.candidate) renderPreparation()
      } catch (failure) {
        bindText(editorStatus, uiMessage(failure.message))
        editorStatus.dataset.state = 'error'
        editorStatus.hidden = false
        const issue =
          failure.packingIssue || failure.conflict?.requestedOwner || {}
        const targetId = issue.groupId || group?.id
        const fields =
          editFields.get(editorKey(issue.orderId || orderId, targetId)) ||
          editFields.get(editorKey(orderId, group?.id))
        const part =
          issue.field === 'size'
            ? 'sizeSuffix'
            : issue.field === 'variant' || failure.conflict?.kind === 'barcode'
              ? 'variantSuffix'
              : 'baseCode'
        const input =
          ((failure.conflict || (!issue.orderId && !issue.groupId)) &&
            lastCodeInput) ||
          fields?.find(
            (field) =>
              field.dataset.codePart === part &&
              (!issue.variantId || field.dataset.variantId === issue.variantId)
          ) ||
          fields?.[0]
        if (input) {
          input.setAttribute('aria-invalid', 'true')
          input.setAttribute('aria-errormessage', editorStatus.id)
          queueMicrotask(() => input.focus())
        }
      } finally {
        saving = false
        controls.forEach((control, index) => {
          control.disabled = disabled[index]
        })
        if (pendingSaves.size) {
          clearTimeout(saveTimer)
          saveTimer = setTimeout(() => {
            void flushSaves().catch(() => {})
          }, 800)
        }
      }
    }
    const codeChanged = (entry) => {
      const old = previous?.groups.find((saved) => saved.id === entry.id)
      return (
        old &&
        (old.baseCode !== entry.baseCode ||
          entry.variants.some((variant) => {
            const before = old.variants.find((item) => item.id === variant.id)
            return (
              before &&
              ['variantSuffix', 'sizeSuffix', 'needsSizeMapping'].some(
                (key) => before[key] !== variant[key]
              )
            )
          }))
      )
    }
    const editableGroups = draft.groups.filter((entry) => {
      const old = previous?.groups.find((saved) => saved.id === entry.id)
      return (
        entry === group ||
        codeChanged(entry) ||
        (old &&
          (['spanishName', 'category'].some((key) => entry[key] !== old[key]) ||
            entry.variants.some((variant) => {
              const saved = old.variants.find(
                (value) => value.id === variant.id
              )
              return (
                saved &&
                variant.entryIds.some(
                  (id) =>
                    variantMaterial(variant, id).value !==
                    variantMaterial(saved, id).value
                )
              )
            })))
      )
    })
    const restoreCode = (entry, baseline = previous) => {
      const old = baseline?.groups.find((saved) => saved.id === entry.id)
      if (!old) return
      entry.baseCode = old.baseCode
      for (const variant of entry.variants) {
        const before = old.variants.find((item) => item.id === variant.id)
        if (!before) continue
        for (const key of ['variantSuffix', 'sizeSuffix', 'needsSizeMapping'])
          variant[key] = before[key]
      }
      if (old.sizeMode === undefined) delete entry.sizeMode
      else entry.sizeMode = old.sizeMode
    }
    async function appendCodeEditor(
      description,
      entry,
      proposal = draft,
      editedVariant = conflictingVariant,
      ownerEditor = false
    ) {
      const fields = []
      const key = editorKey(proposal.orderId, entry.id)
      const existingFields = editFields.get(key) || []
      editFields.set(key, [...existingFields, ...fields])
      const editor = el('div', undefined, 'conflict-code-editor')
      const old = baselines
        .get(proposal.orderId)
        ?.groups.find((saved) => saved.id === entry.id)
      const comparison = el('div', undefined, 'conflict-code-impact')
      const updatePreview = () => {
        const values = [
          {
            label: uiMessage('Carton mark'),
            before: old?.baseCode || uiMessage('Not prepared'),
            after: entry.baseCode,
            kind: 'code',
          },
        ]
        for (const variant of entry.variants) {
          const before = old?.variants.find((saved) => saved.id === variant.id)
          values.push({
            label:
              [variant.variant, variant.size].filter(Boolean).join(' · ') ||
              uiMessage('Barcode'),
            before:
              before && old.baseCode
                ? `${old.baseCode}${before.variantSuffix}${before.sizeSuffix}`
                : uiMessage('Not prepared'),
            after: `${entry.baseCode}${variant.variantSuffix}${variant.sizeSuffix}`,
            kind: 'code',
          })
          for (const id of variant.entryIds) {
            const oldMaterial = before ? variantMaterial(before, id).value : ''
            const proposedMaterial = variantMaterial(variant, id).value
            if (oldMaterial !== proposedMaterial)
              values.push({
                label: uiMessage('Material'),
                before: oldMaterial,
                after: proposedMaterial,
              })
          }
        }
        for (const [key, label] of [
          ['spanishName', 'Spanish short name'],
          ['category', 'Chinese category'],
        ])
          if ((old?.[key] || '') !== (entry[key] || ''))
            values.push({
              label: uiMessage(label),
              before: old?.[key],
              after: entry[key],
            })
        comparison.replaceChildren(
          packingValueComparison(values, { hideUnchanged: true })
        )
      }
      previewUpdates.set(editor, updatePreview)
      function addField(label, value, key, change, read, host = editor) {
        const wrapper = field(uiMessage(label), value, (value) => {
          lastCodeInput = input
          change(value.trim().toUpperCase())
          input.removeAttribute('aria-invalid')
          input.removeAttribute('aria-errormessage')
          editorStatus.hidden = true
          for (const [other, read] of editorReads) {
            if (other === input) continue
            other.value = read()
            refreshCodeInput(other)
          }
          for (const update of previewUpdates.values()) update()
          try {
            validatePreparationSuffixEdits(
              proposal,
              baselines.get(proposal.orderId),
              {
                snapshot: getRecords().find(
                  (record) => record.snapshot.orderId === proposal.orderId
                )?.snapshot,
                sizeVocabulary: preferences.sizeVocabulary,
                restored:
                  options.saveOptions?.suffixBaselines?.find(
                    (baseline) =>
                      baseline.orderId === proposal.orderId &&
                      baseline.accountId === proposal.accountId
                  ) || restoredSuffixBaseline(proposal),
              }
            )
          } catch (error) {
            bindText(editorStatus, uiMessage(error.message))
            editorStatus.dataset.state = 'error'
            editorStatus.hidden = false
            const issue = error.packingIssue
            const part = issue.field === 'size' ? 'sizeSuffix' : 'variantSuffix'
            for (const field of editFields.get(
              editorKey(proposal.orderId, issue.groupId)
            ) || [])
              if (
                field.dataset.codePart === part &&
                field.dataset.variantId === issue.variantId
              ) {
                field.setAttribute('aria-invalid', 'true')
                field.setAttribute('aria-errormessage', editorStatus.id)
              }
          }
        })
        const input = wrapper.querySelector('input')
        input.dataset.codePart = key
        input.autocomplete = 'off'
        input.spellcheck = false
        input.maxLength = key === 'baseCode' ? 10 : 30
        editorReads.set(input, read)
        fields.push(input)
        editFields.set(editorKey(proposal.orderId, entry.id), [
          ...existingFields,
          ...fields,
        ])
        host.append(wrapper)
        return input
      }
      const baseInput = addField(
        'Product code',
        entry.baseCode,
        'baseCode',
        (value) => {
          entry.baseCode = value
        },
        () => entry.baseCode
      )
      baseInput.classList.add('ce-code')
      decorateCodeInput(baseInput)
      for (const variant of entry.variants) {
        if (ownerEditor && variant !== editedVariant) continue
        const before = old?.variants.find((item) => item.id === variant.id)
        if (
          variant !== editedVariant &&
          (!before ||
            ['variantSuffix', 'sizeSuffix', 'needsSizeMapping'].every(
              (key) => before[key] === variant[key]
            ))
        )
          continue
        const variantFields = el('div', undefined, 'conflict-variant-fields')
        const identity = el(
          'p',
          [variant.variant, variant.size].filter(Boolean).join(' · '),
          'conflict-variant-name'
        )
        variantFields.append(identity)
        editor.append(variantFields)
        for (const [key, label] of [
          ['variantSuffix', 'Variant code'],
          ['sizeSuffix', 'Size code'],
        ]) {
          const input = addField(
            label,
            variant[key],
            key,
            (value) => {
              variant[key] = value
              if (key === 'sizeSuffix') {
                variant.needsSizeMapping = false
                if (value) delete entry.sizeMode
              }
            },
            () => variant[key],
            variantFields
          )
          input.dataset.variantId = variant.id
        }
      }
      updatePreview()
      description.append(editor)
      description.parentElement.append(comparison)
      editor.addEventListener('keydown', (event) => {
        if (
          event.key !== 'Enter' ||
          event.isComposing ||
          event.target.tagName === 'SELECT'
        )
          return
        event.preventDefault()
        void complete()
      })
    }
    function appendIdentity(host, id, sellerName) {
      const snapshot = getRecords().find(
        (record) => record.snapshot.orderId === id
      )?.snapshot
      const identity = el('div', undefined, 'conflict-product-identity')
      identity.append(el('span', sellerName || snapshot?.sellerName || ''))
      if (snapshot?.purchasedAt)
        identity.append(
          el(
            'span',
            new Date(snapshot.purchasedAt).toLocaleDateString(getLocale())
          )
        )
      host.append(identity)
    }
    for (const owner of ownership.owners.filter(
      (entry) => entry.kind === (error?.conflict?.kind || 'base')
    )) {
      const card = el(
        'article',
        undefined,
        'packing-review-item conflict-owner-card'
      )
      if (owner.photos[0])
        card.append(
          media.photo({
            thumbnail: owner.photos[0],
            description: owner.groupTitle || owner.spanishName,
          })
        )
      const details = el('div', undefined, 'conflict-product-details')
      details.append(
        el('span', uiMessage('Current assignment'), 'conflict-role-label'),
        el(
          'strong',
          owner.spanishName || owner.groupTitle || uiMessage('Original product')
        )
      )
      appendIdentity(details, owner.orderId, owner.sellerName)
      if (owner.variant) details.append(el('p', owner.variant))
      details.append(el('code', code, 'ce-code conflict-occupied-code'))
      const owningGroupId =
        owner.currentGroupId || (owner.groupExists ? owner.groupId : null)
      card.append(details)
      if (owner.orderExists && owningGroupId) {
        let proposal = proposals.get(owner.orderId)
        if (!proposal) {
          const source =
            drafts.find((entry) => entry.orderId === owner.orderId) ||
            preparations.get(owner.orderId)
          if (source) {
            proposal = structuredClone(source)
            proposals.set(owner.orderId, proposal)
            baselines.set(owner.orderId, preparations.get(owner.orderId))
            initialProposals.set(owner.orderId, structuredClone(proposal))
          }
        }
        const owningGroup = proposal?.groups.find(
          (entry) => entry.id === owningGroupId
        )
        const owningVariant =
          owningGroup?.variants.find((entry) => entry.id === owner.variantId) ||
          owningGroup?.variants.find((entry) =>
            entry.entryIds.some((id) => owner.entryIds.includes(id))
          )
        if (owningGroup) {
          if (owner.kind === 'base')
            details.querySelector('.conflict-occupied-code')?.remove()
          await appendCodeEditor(
            details,
            owningGroup,
            proposal,
            owner.kind === 'barcode' ? owningVariant : undefined,
            true
          )
        }
      }
      if (owner.orderExists && owningGroupId && !options.candidate)
        details.append(
          button(uiMessage('Show owning product'), async () => {
            modal.close()
            // Keep pending edits while revealing the owner; no reload or restore.
            let ownerDraft = drafts.find(
              (entry) => entry.orderId === owner.orderId
            )
            if (!ownerDraft) {
              ownerDraft = structuredClone(preparations.get(owner.orderId))
              if (ownerDraft) {
                rememberSessionBaseline(ownerDraft.orderId)
                drafts.push(ownerDraft)
                checkpoints.set(
                  ownerDraft.orderId,
                  preparationHistorySnapshot(ownerDraft)
                )
                historySaved.set(ownerDraft.orderId, ownerDraft)
              }
            }
            if (!ownerDraft) return
            const ownerGroup = ownerDraft.groups.find(
              (entry) => entry.id === owningGroupId
            )
            const entries = scopeEntries.get(owner.orderId) || new Set()
            for (const variant of ownerGroup?.variants || [])
              for (const id of variant.entryIds) entries.add(id)
            scopeEntries.set(owner.orderId, entries)
            packingOrders.clear()
            packingOrders.add(owner.orderId)
            groupPage = Math.floor(
              scopedGroups(ownerDraft).findIndex(
                (entry) => entry.id === owningGroupId
              ) / 20
            )
            renderPreparation()
            document
              .querySelector(`[data-group-id="${CSS.escape(owningGroupId)}"]`)
              ?.scrollIntoView({ block: 'center' })
          })
        )
      evidence.append(card)
    }
    for (const entry of editableGroups) {
      const source = getRecords().find(
        (record) => record.snapshot.orderId === orderId
      )?.snapshot
      const target = el(
        'article',
        undefined,
        'packing-review-item conflict-edit-card'
      )
      const item = source?.items.find((item) =>
        (entry === group && conflictingVariant
          ? [conflictingVariant]
          : entry.variants
        ).some((variant) => variant.entryIds.includes(item.entryId))
      )
      if (item) target.append(media.photo(item))
      const description = el('div', undefined, 'conflict-product-details')
      description.append(
        el('span', uiMessage('Product you are editing'), 'conflict-role-label'),
        el('strong', entry.spanishName || entry.title)
      )
      appendIdentity(description, orderId)
      if (entry === group && conflictingVariant)
        description.append(
          el(
            'p',
            [conflictingVariant.variant, conflictingVariant.size]
              .filter(Boolean)
              .join(' · ')
          )
        )
      target.append(description)
      await appendCodeEditor(description, entry)
      evidence.append(target)
    }
    const recovery = el('div', undefined, 'conflict-recovery-actions')
    const actions = el(
      'div',
      undefined,
      'dialog-actions conflict-apply-actions'
    )
    if (group) {
      actions.append(
        button(uiMessage('Apply corrections'), () => complete(), 'primary')
      )
      if (previous?.groups.some((entry) => entry.id === group.id))
        recovery.append(
          preparationHelp(
            button(uiMessage('Undo code edits'), () => {
              for (const proposal of proposals.values())
                for (const entry of proposal.groups)
                  restoreCode(entry, baselines.get(proposal.orderId))
              showProposal(
                'Saved codes restored in the proposal. Review the changes and choose Apply corrections.'
              )
            }),
            uiMessage(
              'Restore saved codes on both sides. Keep names, materials and other edits.'
            )
          )
        )
    }
    if (group)
      recovery.append(
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
                editedVariant.sizeSuffix,
                preferences.sizeVocabulary
              )
            } else {
              candidate = regeneratePreparationCode(draft, group.id)
              ;[candidate] = await repository.previewPreparations([candidate], {
                preserveNaming: true,
                suffixBaselines:
                  options.saveOptions?.suffixBaselines ||
                  [restoredSuffixBaseline(candidate)].filter(Boolean),
              })
            }
            for (const entry of editableGroups) {
              const proposed = candidate.groups.find(
                (item) => item.id === entry.id
              )
              if (!proposed) continue
              entry.baseCode = proposed.baseCode
              for (const variant of entry.variants) {
                const next = proposed.variants.find(
                  (item) => item.id === variant.id
                )
                if (next) {
                  variant.variantSuffix = next.variantSuffix
                  variant.sizeSuffix = next.sizeSuffix
                  variant.needsSizeMapping = next.needsSizeMapping
                }
              }
            }
            showProposal(
              'A free code is proposed below. Review the changes and choose Apply corrections.'
            )
          },
          'secondary'
        )
      )
    if (previous && !options.discard)
      recovery.append(
        button(uiMessage('Keep saved version'), async () => {
          if (options.candidate) resolved = previous
          else await reloadSavedOrder(orderId)
          modal.close()
        })
      )
    actions.prepend(
      button(
        uiMessage(options.discard ? 'Cancel removal' : 'Continue editing'),
        () => modal.close()
      )
    )
    const recoveryPanel = el('section', undefined, 'conflict-recovery-panel')
    recoveryPanel.append(recovery)
    modal.append(recoveryPanel, evidence, editorStatus, actions)
    pinDialogActions(modal, actions)
    modal.addEventListener('cancel', (event) => {
      if (saving) event.preventDefault()
    })
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
  function watchCodeFields(inputs, draft, host, scope) {
    const notice = el('div', undefined, 'code-field-error')
    notice.hidden = true
    const text = el('span', undefined, 'code-error-description')
    const summary = el('span')
    text.id = `code-error-${crypto.randomUUID()}`
    let issue = null
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
      }
      for (const input of inputs)
        if (
          error &&
          (!error.packingIssue?.field ||
            !['variant', 'size'].includes(error.packingIssue.field) ||
            input.dataset.packingField === error.packingIssue.field)
        ) {
          input.setAttribute('aria-invalid', 'true')
          input.setAttribute('aria-errormessage', text.id)
        } else {
          input.removeAttribute('aria-invalid')
          input.removeAttribute('aria-errormessage')
        }
    }
    const state = codePreviewState(draft)
    state.watchers.add({
      connected: () => inputs.some((input) => input.isConnected),
      show(error) {
        const group = draft.groups.find((group) => group.id === scope.groupId)
        const variant = group?.variants.find(
          (variant) => variant.id === scope.variantId
        )
        show(
          group &&
            codeIssueTargets(
              error,
              draft,
              group,
              variant,
              scope.variantId ? 'barcode' : 'mark'
            )
            ? error
            : null
        )
      },
    })
    const validate = () => {
      const state = codePreviewState(draft)
      clearTimeout(state.timer)
      const current = ++state.version
      state.scopes.set(`${scope.groupId}/${scope.variantId || ''}`, scope)
      state.pending = !state.error
      refreshCodePreviews(draft, state)
      if (state.error) return
      state.timer = setTimeout(async () => {
        if (!inputs.some((input) => input.isConnected)) return
        const snapshot = JSON.stringify(draft)
        const signature = state.signature
        let failure = null
        try {
          await repository.previewPreparations([JSON.parse(snapshot)], {
            suffixBaselines: [restoredSuffixBaseline(draft)].filter(Boolean),
          })
        } catch (error) {
          failure = error
        }
        if (
          current !== state.version ||
          signature !== codePreviewSignature(draft)
        )
          return
        state.error = failure
        state.pending = false
        if (!failure) state.scopes.clear()
        refreshCodePreviews(draft, state)
      }, 180)
    }
    for (const input of inputs) input.addEventListener('input', validate)
  }
  function renderPackingHeader(host) {
    const header = el('header', undefined, 'packing-view-header')
    const heading = el('div', undefined, 'packing-title')
    const months = currentPackingMonths()
    heading.append(
      el('h1', uiMessage('Prepare packing list')),
      el(
        'p',
        uiMessage('{0} · {1} orders · {2} products', {
          0: () => months.map(monthLabel).join(' · '),
          1: scopedDrafts().length,
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
    header.append(heading, actions)
    const commandBar = el('div', undefined, 'packing-command-bar')
    commandBar.append(header)
    const toolbar = el('div', undefined, 'packing-top-tools')
    const filter = el('select')
    bindAttribute(filter, 'aria-label', uiMessage('Show packing orders'))
    filter.name = 'packing-order'
    filter.className = 'packing-order-picker'
    preparationHelp(
      filter,
      uiMessage(
        'Filter the packing orders shown below. Copy uses selected products in these orders; backup includes the whole open preparation.'
      )
    )
    const richPicker = CSS.supports('appearance', 'base-select')
    syncPackingOrderPicker = () => {}
    if (richPicker) {
      const selected = el('button')
      selected.type = 'button'
      selected.append(el('selectedcontent'))
      filter.append(selected)
      syncPackingOrderPicker = () => {
        const option = filter.selectedOptions[0]
        if (!option) return
        selected
          .querySelector('selectedcontent')
          .replaceChildren(
            ...Array.from(option.childNodes, (node) => node.cloneNode(true))
          )
      }
      // Native selectedcontent snapshots the option before cached photos resolve.
      // Refresh that snapshot when the selected option's own image is ready.
      filter.addEventListener(
        'load',
        (event) => {
          const option = event.target.closest?.('option')
          if (option?.selected) syncPackingOrderPicker()
        },
        true
      )
    }
    const records = new Map(
      getRecords().map((record) => [record.snapshot.orderId, record])
    )
    const choices = scopedDrafts().map((draft) => {
      const record = records.get(draft.orderId)
      const source = record?.snapshot
      const groups = scopedGroups(draft)
      const ids = new Set(
        groups.flatMap((group) =>
          scopedVariants(draft, group)
            .flatMap((variant) => variant.entryIds)
            .filter((id) => scopeEntries.get(draft.orderId)?.has(id))
        )
      )
      return {
        draft,
        record,
        source,
        groups,
        items: source?.items.filter((item) => ids.has(item.entryId)) || [],
      }
    })
    const allProducts = choices.reduce(
      (sum, choice) => sum + choice.items.length,
      0
    )
    const allGroups = choices.reduce(
      (sum, choice) => sum + choice.groups.length,
      0
    )
    const photosFor = (items) =>
      [
        ...new Map(
          items
            .filter((item) => item.thumbnail)
            .map((item) => [item.thumbnail, item])
        ).values(),
      ].slice(0, 6)
    function addChoice({
      value,
      title,
      items,
      products,
      groups,
      names,
      context,
      metadata,
    }) {
      const option = new Option('', value)
      const counts = uiMessage('{0} · {1}', {
        0: uiMessage(products === 1 ? '{0} product' : '{0} products', {
          0: products,
        }),
        1: uiMessage(groups === 1 ? '{0} group' : '{0} groups', {
          0: groups,
        }),
      })
      if (richPicker) {
        const photos = el('span', undefined, 'packing-order-photos')
        for (const item of photosFor(items))
          photos.append(media.photo(item, { interactive: false }))
        const text = el('span', undefined, 'packing-order-caption')
        const heading = el('strong')
        bindText(heading, title)
        text.append(heading)
        const details = el('span', undefined, 'packing-order-details')
        if (names) {
          const labels = el('small', undefined, 'packing-order-names')
          bindText(labels, names)
          details.append(labels)
        }
        details.append(el('small', counts, 'packing-order-counts'))
        text.append(details)
        if (metadata) text.append(metadata)
        option.replaceChildren(photos, text)
      } else {
        bindText(option, () =>
          [
            typeof title === 'function' ? title() : t(title),
            names?.(),
            t(counts),
            context?.(),
          ]
            .filter(Boolean)
            .join(' · ')
        )
      }
      filter.append(option)
    }
    addChoice({
      value: '',
      title: uiMessage('All {0} orders', { 0: choices.length }),
      // Sample different orders first so the summary represents the full scope.
      items: [
        ...choices.flatMap(({ items }) => photosFor(items).slice(0, 1)),
        ...choices.flatMap(({ items }) => items),
      ],
      products: allProducts,
      groups: allGroups,
    })
    for (const { draft, record, source, groups, items } of choices) {
      const sellerName = () =>
        source?.sellerName || draft.sellerId || t('Seller unavailable')
      const names = () =>
        [
          ...new Set(
            groups.map((group) =>
              getLanguage() === 'zh' ? group.category : group.spanishName
            )
          ),
        ]
          .filter(Boolean)
          .join(' · ')
      const day = source?.purchasedAt?.slice(0, 10)
      const date = day && new Date(`${day}T12:00:00Z`)
      const dateLabel = () =>
        date && !Number.isNaN(date.getTime())
          ? date.toLocaleDateString(getLocale(), {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
              timeZone: 'UTC',
            })
          : t('Date unavailable')
      const status = presentOrderStatus(source?.status)
      const metadata = el('span', undefined, 'packing-order-context')
      const purchase = el('time', undefined, 'purchase-date')
      purchase.dataset.uiLabel = 'dates'
      if (day) purchase.dateTime = day
      bindText(purchase, dateLabel)
      bindAttribute(purchase, 'title', uiMessage('Purchase date'))
      const state = el('span', uiMessage(status.label), 'order-status')
      state.dataset.tone = status.tone
      state.dataset.uiLabel = labelColorKey(status.label)
      state.title = source?.status || ''
      metadata.append(
        purchase,
        state,
        ...(record?.tags || []).map((name) =>
          orderTagBadge(name, preferences.orderTags)
        )
      )
      const context = () =>
        [dateLabel(), t(status.label), ...(record?.tags || [])]
          .filter(Boolean)
          .join(' · ')
      addChoice({
        value: draft.orderId,
        title: sellerName,
        items,
        products: items.length,
        groups: groups.length,
        names,
        context,
        metadata,
      })
    }
    filter.value = packingOrders.size === 1 ? [...packingOrders][0] : ''
    filter.disabled = !choices.length
    syncPackingOrderPicker()
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
    open.disabled =
      packingOrders.size !== 1 ||
      getRecords().some(
        ({ snapshot }) =>
          packingOrders.has(snapshot.orderId) &&
          snapshot.sourceType === 'spreadsheet'
      )
    const selectAll = button(uiMessage('Select all'), () =>
        selectPackingRows(true)
      ),
      clear = button(uiMessage('Clear selection'), () =>
        selectPackingRows(false)
      )
    const arrange = el('div', undefined, 'packing-arrange')
    const arrangeActions = [
      ['store', 'Store'],
      ['code', 'Group code'],
      ['store-code', 'Store, then group code'],
    ].map(([mode, label]) =>
      prepButton(label, async () => {
        await flushSaves()
        const sources = new Map(
          getRecords().map(({ snapshot }) => [snapshot.orderId, snapshot])
        )
        const groupScope = new Map(
          visibleDrafts().map((draft) => [
            draft.orderId,
            scopedGroups(draft).map((group) => group.id),
          ])
        )
        await applyOrderArrangement(
          arrangePreparations(
            drafts,
            visibleDrafts().map((draft) => draft.orderId),
            mode,
            sources,
            groupScope
          )
        )
        await flushSaves()
      })
    )
    arrangementPanel = mountCopyActions(arrange, {
      label: 'Arrange',
      ariaLabel: 'Arrange packing',
      panelLabel: 'Arrange packing',
      symbol: 'packing',
      groups: [{ label: 'Arrange displayed orders', actions: arrangeActions }],
    })
    toolbar.append(filter, open, arrange)
    commandBar.append(toolbar)
    const output = el(
      'div',
      undefined,
      'preparation-output packing-selection-toolbar'
    )
    selectionToolbar = output
    output.setAttribute('role', 'group')
    bindAttribute(output, 'aria-label', uiMessage('Selection tools'))
    decorateIcon(selectAll, 'check', {
      iconOnly: true,
      label: uiMessage('Select all'),
    })
    decorateIcon(clear, 'close', {
      iconOnly: true,
      label: uiMessage('Clear selection'),
    })
    clear.dataset.clearPackingSelection = ''
    preparationHelp(
      selectAll,
      uiMessage(
        'Select every displayed packing product across all pages. Ctrl+A does the same outside text fields.'
      )
    )
    preparationHelp(
      clear,
      uiMessage(
        'Clear the packing selection without changing any products. Ctrl+D does the same outside text fields.'
      )
    )
    const selectionActions = el('div', undefined, 'packing-selection-actions')
    selectAll.dataset.action = 'select-all-rows'
    clear.dataset.action = 'clear-selection'
    selectionActions.append(selectAll, clear)
    copyScope = el('span', '', 'packing-help preparation-copy-scope')
    const imageCopy = button(uiMessage('Copy Excel image'), async (target) => {
      if (preparationImageAbort) return
      const selectedRows = packingCopyRows()
      if (!selectedRows.length) return
      const badges = getImageBadges()
      const abort = new AbortController()
      try {
        await copied(target, async () => {
          preparationImageAbort = abort
          updatePreparationCopyScope()
          await flushSaves()
          if (abort.signal.aborted) return false
          const rows = preparedRows(selectedRows)
          return await copyExcelImage(rows, {
            badges,
            loadImage,
            renderCartonMark: createCartonMarkRenderer(),
            signal: abort.signal,
            errorOptions: packingErrorOptions,
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
    const sourceCopies = [
      ['Copy values', 'Values', 'copy', 'values'],
      ['Copy images', 'Product photos', 'image', 'images'],
      ['Copy to Excel', 'Excel cells', 'table', 'cells'],
    ].map(([full, short, symbol, mode]) => {
      const target = button(uiMessage(short), async (control) => {
        const rows = packingCopyRows()
        if (!rows.length) return
        await copied(control, async () => {
          await flushSaves()
          if (mode === 'values') return copyTable(rows, { headers: headers() })
          return copySourceImages(rows, {
            imagesOnly: mode === 'images',
            headers: headers(),
            loadImage,
          })
        })
      })
      bindAttribute(target, 'aria-label', uiMessage(full))
      decorateIcon(target, symbol)
      return target
    })
    copyButtons.push(...sourceCopies)
    const headerChoice = el('label', undefined, 'check')
    const headerCheck = el('input')
    headerCheck.type = 'checkbox'
    headerCheck.checked = headers()
    headerCheck.onchange = () => {
      $('include-headers').checked = headerCheck.checked
      $('include-headers').dispatchEvent(new Event('change'))
    }
    headerChoice.append(headerCheck, el('span', uiMessage('Headers')))
    const backup = button(uiMessage('Back up packing'), async (target) => {
      const rows = scopedDrafts().flatMap((draft) =>
        preparationCopyRows(draft, { selectedOnly: false })
      )
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
      await downloadBackup(
        backup,
        `1688-packing-${months.length === 1 ? months[0] : 'mixed-months'}`
      )
      feedback(uiMessage('Packing backup saved'))
    })
    backupButton = backup
    decorateIcon(backup, 'download')
    preparationHelp(
      backup,
      uiMessage(
        'Back up every group and product in this preparation, including other pages and orders. Selection does not limit the backup; removed products and unrelated library data are excluded.'
      )
    )
    const exportList = button(
      uiMessage('Export packing list'),
      async (target) => {
        const rows = scopedDrafts().flatMap((draft) =>
          preparationCopyRows(draft, { selectedOnly: false })
        )
        if (!rows.length) return
        await flushSaves()
        exportPackingList(rows)
      }
    )
    exportList.dataset.action = 'export-packing-list'
    decorateIcon(exportList, 'download')
    preparationHelp(
      exportList,
      uiMessage(
        'Save the whole open packing list as an Excel file with your chosen columns, plus a small JSON summary of its orders, products and quantities.'
      )
    )
    const copyActions = el('div', undefined, 'packing-copy-actions')
    copyActionPanel = mountProductCopyActions(copyActions, {
      exportList,
      image: imageCopy,
      values: sourceCopies[0],
      photos: sourceCopies[1],
      cells: sourceCopies[2],
      columns,
      codes,
      barcodes: copyButtons[3],
      marks: copyButtons[4],
      headers: headerChoice,
      backup,
    })
    copyActionPanel.trigger.dataset.action = 'open-copy-menu'
    const grouping = el('div', undefined, 'packing-grouping-actions')
    const groupingDefinitions = [
      [
        'share',
        'Share one barcode',
        'Share within groups',
        'barcode',
        'Give the selected variants one barcode per product group. Groups with one selected variant stay unchanged; different groups and orders stay separate.',
      ],
      [
        'separate',
        'Give rows separate barcodes',
        'Separate barcodes',
        'barcode',
        'Split every selected combined variant into one barcode per original source row, independently in each product group.',
      ],
      [
        'split',
        'Move to new product',
        'Move to new product',
        'packing',
        'Move selected variants into a new product group within each source order. Select only part of each source group.',
      ],
      [
        'merge',
        'Merge products',
        'Merge product groups',
        'packing',
        'Merge complete selected product groups from one order and packing month. Their variants keep separate barcodes.',
      ],
    ]
    const groupingActions = groupingDefinitions.map(
      ([operation, label, short, symbol, help]) => {
        const target = prepButton(label, async () => {
          if (target.getAttribute('aria-disabled') === 'true') return
          await applySelectedGrouping(operation)
        })
        bindText(target, uiMessage(short))
        bindAttribute(target, 'aria-label', uiMessage(label))
        decorateIcon(target, symbol)
        groupingButtons.set(operation, { target, help })
        return target
      }
    )
    groupingPanel = mountCopyActions(grouping, {
      label: 'Grouping',
      ariaLabel: 'Grouping tools',
      panelLabel: 'Selected product grouping',
      symbol: 'packing',
      groups: [{ label: 'Selected products', actions: groupingActions }],
    })
    groupingPanel.trigger.dataset.action = 'open-grouping-menu'
    groupingPanel.panel.classList.add('packing-grouping-panel')
    preparationHelp(
      groupingPanel.trigger,
      uiMessage(
        'Change grouping for selected products. Review affected photos and codes before applying. Orders are never merged together.'
      )
    )
    const printing = el('div', undefined, 'packing-print-actions')
    const printButtons = [
      ['Print labels…', 'barcode', 'barcode'],
      ['Print carton marks…', 'carton', 'mark'],
    ].map(([label, symbol, kind]) => {
      const target = button(uiMessage(label), () =>
        preparationAction(() => openPrint(kind, packingCopyRows()))
      )
      target.dataset.action =
        kind === 'mark' ? 'print-carton-marks' : 'print-labels'
      decorateIcon(target, symbol)
      return target
    })
    const recentPrints = button(uiMessage('Recent print jobs…'), () =>
      openRecentPrints()
    )
    recentPrints.classList.add('packing-recent-prints')
    recentPrints.dataset.action = 'print-recent'
    decorateIcon(recentPrints, 'undo')
    printButtons.push(recentPrints)
    printPanel = mountCopyActions(printing, {
      label: 'Print…',
      ariaLabel: 'More print formats',
      panelLabel: 'Print formats',
      symbol: 'barcode',
      groups: [{ label: 'Print', actions: printButtons }],
    })
    printPanel.trigger.dataset.action = 'open-print-menu'
    preparationHelp(
      printPanel.trigger,
      uiMessage(
        'Export print-ready A4 PDFs of labels or carton marks for the selected products.'
      )
    )
    output.append(copyScope, selectionActions, copyActions, printing, grouping)
    host.append(commandBar, output)
    toolbarResize = new ResizeObserver(() => {
      document.documentElement.style.setProperty(
        '--packing-selection-height',
        `${output.getBoundingClientRect().height}px`
      )
    })
    toolbarResize.observe(output)
  }
  async function restorePackingFile(file) {
    await flushSaves()
    const input = await readBackupFile(file)
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
          orderId: order.orderId,
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
          '{0} products from {1} orders will reopen. {2} orders can receive selected packing edits from this file. Unselected products, newer local edits and existing settings stay unchanged. Source orders and current code assignments are included; restoration checks for current code conflicts.',
          { 0: count, 1: scope.orders.length, 2: newer.length }
        ),
        changes,
        proceed: uiMessage('Restore packing'),
        media,
      }))
    )
      return
    const before = new Map(preparations)
    await repository.restoreBackup(input)
    await changed({ reload: true })
    await reload()
    drafts = arrangeOpenedDrafts(
      scope.orders
        .map((order) => preparations.get(order.orderId))
        .filter(Boolean)
        .map((draft) => structuredClone(draft))
    )
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
    historySaved.clear()
    historyRestores.clear()
    sessionBaselines.clear()
    sessionCartons.clear()
    sessionCartonValues.clear()
    for (const draft of drafts) {
      sessionBaselines.set(
        draft.orderId,
        structuredClone(before.get(draft.orderId))
      )
      rememberCartonBaseline(draft.orderId)
    }
    rememberSavedPreparations(
      drafts.map(
        (draft) => before.get(draft.orderId) || { ...draft, groups: [] }
      ),
      drafts
    )
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
    const available = new Set(scopedDrafts().map((draft) => draft.orderId))
    for (const id of packingOrders)
      if (!available.has(id)) packingOrders.delete(id)
    if (!packingOrders.size && available.size === 1)
      packingOrders.add([...available][0])
    preparationImageAbort?.abort()
    clearErrorNotices($('packing-view'))
    copyActionPanel?.destroy()
    copyActionPanel = null
    arrangementPanel?.destroy()
    arrangementPanel = null
    groupingPanel?.destroy()
    groupingPanel = null
    printPanel?.destroy()
    printPanel = null
    groupingButtons.clear()
    toolbarResize?.disconnect()
    for (const draft of drafts) checkpoint(null, draft)
    media.reset()
    codeFields.clear()
    resetButtons.clear()
    detachPreparationSelection()
    materialFields.clear()
    sourceAttributeFields.clear()
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
    const costRecords = getRecords(),
      affectedCostOrders = costAffectedOrderIds(costRecords),
      costByOrder = new Map()
    function itemCost(item, orderId) {
      if (!affectedCostOrders.has(orderId)) return undefined
      if (!costByOrder.has(orderId)) {
        const record = costRecords.find(
          ({ snapshot }) => snapshot.orderId === orderId
        )
        costByOrder.set(orderId, paymentCostAdjustments(record, costRecords))
      }
      return costByOrder.get(orderId).get(item.entryId)
    }
    function orderButton(text, action, className) {
      return prepButton(
        text,
        async () => {
          current = index
          try {
            return await action()
          } catch (error) {
            error.packingIssue ||= { orderId: draft.orderId }
            throw error
          }
        },
        className
      )
    }
    const orderRecord = getRecords().find(
      ({ snapshot }) => snapshot.orderId === draft.orderId
    )
    const source = orderRecord?.snapshot
    const orderHeader = el('header', undefined, 'packing-order-header')
    orderHeader.append(
      reorderHandle({
        key: draft.orderId,
        label: source?.sellerName || draft.orderId,
        items: () => visibleDrafts().map((entry) => entry.orderId),
        element: (id) =>
          document.querySelector(`[data-packing-order="${CSS.escape(id)}"]`),
        move: (key, target, after) => {
          void preparationAction(async () => {
            await flushSaves()
            const positions = movedKeys(
              drafts.map((entry) => entry.orderId),
              key,
              target,
              after
            )
            await applyOrderArrangement(
              positions.map((id) =>
                drafts.find((entry) => entry.orderId === id)
              ),
              true
            )
            await flushSaves()
            document
              .querySelector(
                `[data-packing-order="${CSS.escape(key)}"] .reorder-handle`
              )
              ?.focus()
          }).catch((error) => showError(error))
        },
      })
    )
    const identity = el('div')
    const sellerHeading = el('h2')
    sellerHeading.append(
      copyTextButton(
        source?.sellerName || draft.sellerId || t('Seller unavailable'),
        { label: uiMessage('Copy store name') }
      )
    )
    operationsStrip(sellerHeading, orderRecord)
    identity.append(sellerHeading)
    const orderNumber = el('span', undefined, 'packing-order-number')
    orderNumber.append(
      orderReference(draft.orderId, { sourceType: source?.sourceType })
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
    orderSpanish.querySelector('input').dataset.packingField = 'spanishName'
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
    orderCategory.querySelector('input').dataset.packingField = 'category'
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
    host.append(orderTools)
    updateHistoryButtons()
    for (const group of pageGroups) {
      const card = el('section', undefined, 'preparation-group'),
        title = el('h3'),
        selectGroup = el('span', undefined, 'group-select')
      card.dataset.groupId = group.id
      if (source?.sourceType === 'spreadsheet')
        card.classList.add('spreadsheet-group')
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
      productInput.className = 'group-code-editor ce-code'
      productInput.dataset.packingField = 'code'
      bindAttribute(productInput, 'aria-label', uiMessage('Product code'))
      productInput.value = group.baseCode
      bindAttribute(productInput, 'placeholder', uiMessage('Assigning code…'))
      productInput.autocomplete = 'off'
      productInput.setAttribute('autocorrect', 'off')
      productInput.spellcheck = false
      productInput.size = 12
      decorateCodeInput(productInput)
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
      repeatProductControl(title, draft, group)
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
      const groupActions = packingItemActions(
        'Group actions',
        title.querySelector('.reorder-handle'),
        preparationHelp(
          removeGroup,
          uiMessage(
            'Remove this group’s displayed products from packing and discard their preparation edits from this session. Original order data is kept.'
          )
        )
      )
      const groupName = el('input')
      groupName.className = 'group-name-editor'
      groupName.dataset.packingField = 'name'
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
      const summary = el('div', undefined, 'product-summary')
      summary.append(title)
      watchCodeFields([productInput], draft, summary, { groupId: group.id })
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
      const sizeHandling = el('label', undefined, 'group-size-handling')
      const sizeMode = el('select')
      bindAttribute(sizeMode, 'aria-label', uiMessage('Size handling'))
      for (const [value, label] of [
        ['automatic', 'Automatic sizes'],
        ['none', 'No size difference'],
      ]) {
        const option = el('option', uiMessage(label))
        option.value = value
        sizeMode.append(option)
      }
      sizeMode.value = group.sizeMode || 'automatic'
      sizeMode.disabled = group.variants.some((variant) =>
        variant.entryIds.some((id) => !scopeEntries.get(draft.orderId)?.has(id))
      )
      preparationHelp(
        sizeMode,
        uiMessage(
          sizeMode.disabled
            ? 'Select all products in this group in Orders before changing its size handling.'
            : 'Use No size difference when the seller used a size field for colors or styles. Variant letters remain distinct; automatic size recognition stays active for other products. Entering a size ending switches this product back to Automatic sizes and keeps your typed ending.'
        )
      )
      sizeMode.addEventListener('change', () => {
        const mode = sizeMode.value
        sizeMode.value = group.sizeMode || 'automatic'
        void preparationAction(() =>
          changeGroupSizeMode(draft.orderId, group.id, mode)
        ).catch((error) => showSaveError(draft.orderId, error))
      })
      sizeHandling.append(el('span', uiMessage('Sizes')), sizeMode)
      fields.append(sizeHandling)
      fields.querySelector(
        '.preparation-inline-field input'
      ).dataset.packingField = 'category'
      const overview = el('div', undefined, 'product-overview')
      const carton = el('div', undefined, 'carton-preview')
      carton.append(
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
      summary.append(fields)
      if (source?.sourceType !== 'spreadsheet') {
        const originalTitle = el('div', undefined, 'original-product-name')
        originalTitle.append(el('p', group.title))
        summary.append(originalTitle)
      }
      overview.append(groupActions, summary, carton)
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
      const columns = el('colgroup')
      for (let column = 0; column < 5; column++) columns.append(el('col'))
      table.append(columns)
      for (const label of [
        'Product actions',
        'Photo',
        'Product variant',
        'Carton details',
        'Barcode',
      ]) {
        const column = el('th', uiMessage(label))
        column.scope = 'col'
        head.append(column)
      }
      const variantSelection = selection.variants.get(group.id)
      const thead = el('thead', undefined, 'visually-hidden')
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
      const priceSizes = suggestPriceSizeMappings(
        group,
        snapshot,
        preferences.sizeVocabulary
      )
      if (
        priceSizes.length &&
        priceSizes.every(({ variantId }) =>
          group.variants
            .find((variant) => variant.id === variantId)
            .entryIds.every((id) => scopeEntries.get(draft.orderId)?.has(id))
        )
      ) {
        const review = orderButton('Review size suggestions', () =>
          reviewPriceSizes(draft.orderId, group.id)
        )
        summary.append(
          preparationHelp(
            review,
            uiMessage(
              'Compare the two prices and photos before assigning S and L. Price alone does not prove size.'
            )
          )
        )
      }
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
        const moveProduct = reorderHandle({
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
        const photoCell = el('td', undefined, 'variant-photos')
        const items = variant.entryIds
          .filter((id) => scopeEntries.get(draft.orderId)?.has(id))
          .map((id) => sourceItems.get(id))
          .filter(Boolean)
        const sourceDetailItems = items.map((item) => ({
          ...item,
          orderId: draft.orderId,
          sellerName: source?.sellerName,
          sourceType: source?.sourceType,
          store: source?.store,
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
        note.querySelector('textarea').rows = 1
        note.firstChild.replaceWith(
          el('span', uiMessage('Product variant'), 'visually-hidden')
        )
        const noteRow = el('div', undefined, 'variant-note-row')
        noteRow.append(
          preparationHelp(
            note,
            uiMessage(
              'Describe what differs, such as color or scent. This note is not printed.'
            )
          )
        )
        if (items.length > 1)
          noteRow.append(
            el(
              'small',
              uiMessage('{0} source rows', { 0: items.length }),
              'variant-source-count'
            )
          )
        const sourceAttributes = el(
          'div',
          undefined,
          'variant-source-attributes'
        )
        const sourceDescriptions = el(
          'div',
          undefined,
          'variant-source-descriptions'
        )
        renderSourceAttributes(
          sourceAttributes,
          sourceDetailItems,
          sourceDescriptions
        )
        sourceAttributeFields.add({
          host: sourceAttributes,
          items: sourceDetailItems,
          titles: sourceDescriptions,
        })
        const attributes = el('div', undefined, 'variant-product-attributes')
        attributes.append(
          sourceAttributes,
          materialControl(draft, [variant], 'Material')
        )
        if (variant.size) {
          const sourceSize = el(
            'small',
            uiMessage('Order size: {0}', { 0: '' }),
            'source-size'
          )
          sourceSize.append(
            copyTextButton(variant.size, { label: uiMessage('Copy size') })
          )
          attributes.append(
            preparationHelp(
              sourceSize,
              uiMessage(
                'From the order. Helps you choose a size code; this measurement is not printed.'
              )
            )
          )
        }
        description.append(sourceDescriptions, attributes)
        const facts = el('dl', undefined, 'variant-order-facts')
        const sharedSources = group.sharedProductId
          ? sharedVariantSources(
              [...preparations.values()],
              getRecords(),
              group.sharedProductId,
              variant.sharedVariantId,
              { accountId: draft.accountId }
            ).filter((entry) =>
              scopeEntries.get(entry.orderId)?.has(entry.item.entryId)
            )
          : items.map((item) => ({ item, orderId: draft.orderId }))
        const sharedItems = sharedSources.map((entry) => entry.item)
        const prices = [
          ...new Set(sharedItems.map((item) => normalizePrice(item.price))),
        ]
        const quantity = sharedItems.reduce(
          (sum, item) => sum + BigInt(item.quantity),
          0n
        )
        for (const [label, value, className] of [
          [
            prices.length > 1 ? 'Unit prices' : 'Unit price',
            prices.map((price) => `¥ ${price}`).join(' / ') || '—',
            'variant-price',
          ],
          ...(sharedItems.length > 1
            ? [
                [
                  group.sharedProductId ? 'Combined quantity' : 'Quantity',
                  () => quantity.toLocaleString(getLocale()),
                  'variant-quantity',
                ],
              ]
            : []),
        ]) {
          const fact = el('div', undefined, className)
          const amount = el('dd')
          if (className === 'variant-quantity') {
            const copy = copyTextButton(String(quantity), {
              label: uiMessage('Copy quantity'),
            })
            const display = el('span')
            bindText(display, value)
            copy.firstChild.replaceWith(display)
            amount.append(copy)
          } else {
            for (const [index, price] of prices.entries()) {
              if (index) amount.append(' / ')
              amount.append(
                '¥ ',
                copyTextButton(price, { label: uiMessage('Copy price') })
              )
            }
          }
          fact.append(el('dt', uiMessage(label)), amount)
          facts.append(fact)
        }
        const factsLine = el('div', undefined, 'variant-facts')
        factsLine.append(
          preparationHelp(
            facts,
            sharedItems.length > 1
              ? uiMessage(
                  'Source unit prices and combined quantity from {0} order rows. Discounts are not subtracted here.',
                  { 0: sharedItems.length }
                )
              : uiMessage(
                  'Source unit price and ordered quantity. Discounts are not subtracted here.'
                )
          )
        )
        const adjustedPrices = [
          ...new Set(
            sharedSources
              .map(({ item, orderId }) => itemCost(item, orderId))
              .filter(
                (cost) =>
                  cost && cost.effectiveUnitPrice !== cost.sourceUnitPrice
              )
              .map((cost) => cost.effectiveUnitPrice)
          ),
        ]
        if (adjustedPrices.length) {
          const adjusted = el(
              'div',
              undefined,
              'variant-price additional-cost-price'
            ),
            amounts = el('dd')
          for (const [index, price] of adjustedPrices.entries()) {
            if (index) amounts.append(' / ')
            amounts.append(
              '¥ ',
              copyTextButton(price, { label: uiMessage('Copy price') })
            )
          }
          adjusted.append(
            el('dt', uiMessage('Unit price with charges')),
            amounts
          )
          facts.append(adjusted)
        }
        const cartonRecord = getRecords().find(
          (record) => record.snapshot.orderId === draft.orderId
        )
        const cartonUnits = cartonRecord?.unitsPerCarton || {}
        const measurementCell = el('td', undefined, 'variant-carton-columns')
        const numericHeader = el('div', undefined, 'variant-numeric-header')
        for (const label of ['Quantity', 'Pcs/box', 'kg/box', 'm³/box'])
          numericHeader.append(el('span', uiMessage(label)))
        measurementCell.append(numericHeader)
        for (const item of items) {
          const measurements = el('div', undefined, 'variant-numeric-row')
          measurements.dataset.entryId = item.entryId
          const quantityValue = copyTextButton(item.quantity, {
            label: uiMessage('Copy quantity'),
            className: 'variant-quantity',
          })
          const quantityDisplay = el('span')
          bindText(quantityDisplay, () =>
            BigInt(item.quantity).toLocaleString(getLocale())
          )
          quantityValue.firstChild.replaceWith(quantityDisplay)
          const capacity = cartonCapacityReadout(
            item,
            cartonUnits[item.entryId]
          )
          capacity.firstChild.classList.add('sr-only')
          capacity.querySelector('small')?.classList.add('sr-only')
          preparationHelp(
            capacity,
            uiMessage(
              'Units packed inside one full carton. Leave blank if unknown. Saves automatically; leftovers need packing review. This does not change the ordered quantity.'
            )
          )
          const kg = el('div', undefined, 'variant-measurement-cell'),
            cbm = el('div', undefined, 'variant-measurement-cell')
          mountMeasurements({ kg, cbm }, item, cartonRecord, draft)
          measurements.append(quantityValue, capacity, kg, cbm)
          measurementCell.append(measurements)
          const carton = productCartonDetails(item, cartonRecord)
          if (carton.boxes !== undefined)
            capacity.append(
              el(
                'small',
                uiMessage('{0} full cartons', { 0: carton.boxes }),
                'sr-only'
              )
            )
        }
        if (source?.sourceType === 'spreadsheet') attributes.append(factsLine)
        else description.append(factsLine)
        const codeOptions = el('fieldset', undefined, 'variant-code-options')
        bindAttribute(codeOptions, 'aria-label', uiMessage('Code options'))
        const codeReadout = el(
          'output',
          undefined,
          'variant-code-readout visually-hidden'
        )
        bindAttribute(codeReadout, 'aria-label', uiMessage('Full barcode'))
        const codeDesign = el('div', undefined, 'variant-code-design')
        const codeBand = el('div', undefined, 'variant-code-band ce-code')
        codeDesign.append(codeBand)
        const codeBasePart = el('div', undefined, 'code-base-part')
        const codeBase = el('code', undefined, 'variant-code-base')
        codeBasePart.append(codeBase)
        codeBand.append(
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
          if (group.baseCode) setCodeText(codeBase, group.baseCode)
          else bindText(codeBase, uiMessage('Assigning code…'))
        }
        updateCodeReadout()
        productInput.addEventListener('input', updateCodeReadout)
        productInput.addEventListener('change', updateCodeReadout)
        const codeInputs = []
        const codeParts = []
        const placeCodeParts = () => {
          // Only printed values belong inside the band. Keep empty editing
          // controls beside it, and preserve the caret when a field moves.
          const focused = document.activeElement
          const caret = codeInputs.includes(focused)
            ? [focused.selectionStart, focused.selectionEnd]
            : null
          let movedFocus = false
          for (const part of codeParts) {
            const target = part.input.value.trim() ? codeBand : codeDesign
            const next = codeParts.find(
              (other) =>
                other.index > part.index && other.field.parentNode === target
            )?.field
            if (part.field.parentNode !== target) {
              target.insertBefore(part.field, next || null)
              if (part.input === focused) movedFocus = true
            }
          }
          if (movedFocus) {
            focused.focus({ preventScroll: true })
            focused.setSelectionRange(...caret)
          }
        }
        for (const [key, label] of [
          ['variantSuffix', 'Variant code'],
          ['sizeSuffix', 'Size code'],
        ]) {
          const labelField = inlineField(
            label,
            variant[key],
            (value) => {
              variant[key] = value.toUpperCase()
              if (key === 'sizeSuffix') {
                variant.needsSizeMapping = false
                if (variant.sizeSuffix) {
                  delete group.sizeMode
                  sizeMode.value = 'automatic'
                }
              }
              updateCodeReadout()
            },
            '—'
          )
          labelField.classList.add(`code-part-${key}`)
          labelField.firstChild.replaceWith(
            el('span', uiMessage(label), 'visually-hidden')
          )
          const codeInput = labelField.querySelector('input')
          codeInput.dataset.packingField =
            key === 'sizeSuffix' ? 'size' : 'variant'
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
            placeCodeParts()
          })
          codeInputs.push(codeInput)
          codeParts.push({
            input: codeInput,
            index: codeParts.length,
            field: preparationHelp(
              labelField,
              key === 'variantSuffix'
                ? uiMessage(
                    'Identifies the color or style: A, B, C. Leave blank when not needed.'
                  )
                : uiMessage(
                    'Identifies the size: S, M, L. Leave blank when not needed.'
                  )
            ),
          })
        }
        placeCodeParts()
        codeOptions.append(codeDesign, codeReadout)
        watchCodeFields(codeInputs, draft, codeOptions, {
          groupId: group.id,
          variantId: variant.id,
        })
        if (variant.needsSizeMapping)
          codeOptions.append(
            el('small', uiMessage('Choose a size code'), 'needs-preparation')
          )
        const heading = el('div', undefined, 'variant-heading')
        heading.append(codeOptions, noteRow)
        const workflow = el('span', undefined, 'variant-workflow')
        for (const item of items)
          operationsStrip(workflow, cartonRecord, item.entryId)
        heading.append(workflow)
        details.append(heading, description)
        option.append(details)
        row.append(photoCell, option, measurementCell)
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
        const actionsCell = el('td', undefined, 'variant-actions')
        actionsCell.append(
          packingItemActions(
            'Product actions',
            moveProduct,
            preparationHelp(
              removeProduct,
              uiMessage(
                'Remove this product from packing and discard its preparation edits from this session. Original order data is kept.'
              )
            )
          )
        )
        row.prepend(actionsCell)
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
      host.append(card)
    }
  }

  async function bulkLabels(kind, selectedRows) {
    selectedRows = selectedRows.filter((row) => !isLinkedPaymentSource(row))
    const selected = new Set(
      selectedRows.map((row) => `${row.orderId}/${row.entryId}`)
    )
    if (!selected.size) return
    await flushSaves()
    const models = []
    const seenCodes = new Set()
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
        for (const variant of kind === 'mark' ? [null] : variants) {
          const model = outputModel(prep, group, variant, kind, false, true)
          if (seenCodes.has(model.code)) continue
          seenCodes.add(model.code)
          models.push({
            model,
            location: {
              orderId,
              groupId: group.id,
              variantId: variant?.id,
              labelKind: kind,
            },
          })
        }
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
        for (const [index, { model, location }] of models
          .slice(start, end)
          .entries()) {
          signal.throwIfAborted()
          onProgress(
            uiMessage('Preparing {0} of {1}', { 0: index + 1, 1: end - start })
          )
          let result
          try {
            result = await renderLabel({
              ...model,
              settings: frozenSettings,
              logoUrl: frozenLogo,
              signal,
            })
          } catch (error) {
            error.packingIssue ||= {
              ...location,
              field: error.labelField,
              value: error.labelValue,
            }
            throw error
          }
          results.push(result)
          images.push({
            blob: result.blob,
            label: model.code,
            codeLabel: true,
          })
          await yieldUI()
        }
        return { images, payload: results }
      },
      write: labelClipboard,
      writeImage: (_image, index, results) => labelClipboard([results[index]]),
      errorOptions: packingErrorOptions,
    })
  }
  /** A print entry for one label, or the label validation's refusal. */
  function printEntry(prep, group, variant, kind, selectedIds) {
    const code =
      kind === 'mark'
        ? group.baseCode
        : barcodeValue(group, { ...variant, needsSizeMapping: false })
    try {
      const model = outputModel(prep, group, variant, kind, false, true)
      let cartonPacking
      if (kind === 'mark') {
        const record = getRecords().find(
          (entry) => entry.snapshot.orderId === prep.orderId
        )
        const ids = new Set(
          group.variants
            .flatMap((entry) => entry.entryIds)
            .filter(
              (id) => !selectedIds || selectedIds.has(`${prep.orderId}/${id}`)
            )
        )
        cartonPacking = cartonPackingForItems(record, ids)
      }
      return {
        item: {
          key: model.code,
          code: model.code,
          name: model.spanishName,
          detail: model.category,
          known: cartonPacking?.exact ? cartonPacking.total : null,
          ...(cartonPacking ? { cartonPacking } : {}),
          // Recent jobs find the product again by where it lives, not by code.
          ref: {
            orderId: prep.orderId,
            groupId: group.id,
            variantId: variant?.id ?? null,
            entryIds: (variant ? [variant] : group.variants)
              .flatMap((entry) => entry.entryIds)
              .filter(
                (entryId) =>
                  !selectedIds || selectedIds.has(`${prep.orderId}/${entryId}`)
              ),
          },
          model,
        },
      }
    } catch (error) {
      return {
        problem: {
          code,
          name: variant?.spanishName || group.spanishName || '',
          message: error.message,
          error,
        },
      }
    }
  }
  /** One entry per distinct label for the selected source rows. */
  function printItems(kind, selectedRows) {
    selectedRows = selectedRows.filter((row) => !isLinkedPaymentSource(row))
    const selected = new Set(
      selectedRows.map((row) => `${row.orderId}/${row.entryId}`)
    )
    const items = new Map()
    const problems = new Map()
    for (const orderId of new Set(selectedRows.map((row) => row.orderId))) {
      const record = getRecords().find(
        (record) => record.snapshot.orderId === orderId
      )
      const prep = preparations.get(orderId)
      if (!prep || !record) continue
      const quantityOf = new Map(
        record.snapshot.items.map((item) => [
          item.entryId,
          Math.max(0, Math.floor(Number(item.quantity)) || 0),
        ])
      )
      for (const group of activeGroups(prep, record.snapshot)) {
        const variants = group.variants.filter((variant) =>
          variant.entryIds.some((id) => selected.has(`${orderId}/${id}`))
        )
        if (!variants.length) continue
        for (const variant of kind === 'mark' ? [null] : variants) {
          const { item, problem } = printEntry(
            prep,
            group,
            variant,
            kind,
            selected
          )
          if (problem) {
            problems.set(problem.code, problem)
            continue
          }
          const units = (variant ? [variant] : [])
            .flatMap((entry) => entry.entryIds)
            .filter((id) => selected.has(`${orderId}/${id}`))
            .reduce((sum, id) => sum + (quantityOf.get(id) || 0), 0)
          const existing = items.get(item.code)
          const source = { orderId, seller: record.snapshot.sellerName || '' }
          if (existing) {
            existing.refs.push(item.ref)
            if (kind === 'mark') {
              existing.cartonSources.push({
                orderId,
                packing: item.cartonPacking,
              })
              existing.cartonPacking = combineRepeatCartonPacking(
                existing.cartonSources
              )
              existing.known = existing.cartonPacking.exact
                ? existing.cartonPacking.total
                : null
              existing.quantity = existing.cartonPacking.requiresReview
                ? ''
                : (existing.known ?? 1)
            } else existing.quantity += units
            if (!existing.orders.some((entry) => entry.orderId === orderId))
              existing.orders.push(source)
          } else
            items.set(item.code, {
              ...item,
              // Every source order of this label, for the export summary.
              orders: [source],
              refs: [item.ref],
              ...(kind === 'mark'
                ? { cartonSources: [{ orderId, packing: item.cartonPacking }] }
                : {}),
              quantity:
                kind === 'mark'
                  ? item.cartonPacking?.requiresReview
                    ? ''
                    : (item.known ?? 1)
                  : Math.max(1, units),
            })
        }
      }
    }
    return { items: [...items.values()], problems: [...problems.values()] }
  }
  /** Current print entries at the job's product references (order, group, variant). */
  function printItemsForRefs(kind, products) {
    const rows = []
    const seen = new Set()
    for (const product of products) {
      for (const ref of product.refs || (product.ref ? [product.ref] : [])) {
        const prep = preparations.get(ref.orderId)
        const record = getRecords().find(
          (record) => record.snapshot.orderId === ref.orderId
        )
        if (!prep || !record) continue
        const group = activeGroups(prep, record.snapshot).find(
          (entry) => entry.id === ref.groupId
        )
        const variant =
          kind === 'mark'
            ? null
            : group?.variants.find((entry) => entry.id === ref.variantId)
        if (!group || (kind !== 'mark' && !variant)) continue
        const ids = new Set(
          (variant ? [variant] : group.variants).flatMap(
            (entry) => entry.entryIds
          )
        )
        for (const item of record.snapshot.items) {
          const sourceKey = `${ref.orderId}/${item.entryId}`
          if (
            ids.has(item.entryId) &&
            (!ref.entryIds || ref.entryIds.includes(item.entryId)) &&
            !seen.has(sourceKey)
          ) {
            seen.add(sourceKey)
            rows.push({ ...item, orderId: ref.orderId })
          }
        }
      }
    }
    return printItems(kind, rows)
  }
  const publicProblems = (problems) =>
    problems.map(({ code, name, message }) => ({ code, name, message }))
  async function openPrint(kind, selectedRows) {
    if (!selectedRows.length) throw new Error('Select prepared products first.')
    await flushSaves()
    const { items, problems } = printItems(kind, selectedRows)
    if (!items.length) {
      // The validation error carries its own way to fix the product.
      if (problems.length) throw problems[0].error
      throw new Error('Select prepared products first.')
    }
    openPrintDialog({
      kind: kind === 'mark' ? 'marks' : 'labels',
      items,
      problems: publicProblems(problems),
      settings: structuredClone(settings()),
      logoUrl: logoUrl(),
    })
  }
  /** Rebuild a recent export from current product data. */
  async function regeneratePrint(job) {
    await flushSaves()
    const kind = job.kind === 'marks' ? 'mark' : 'barcode'
    const { items, problems } = printItemsForRefs(kind, job.products)
    const restored = restoreJob(job, items)
    if (!restored.items.length) {
      if (problems.length) throw problems[0].error
      throw new Error(
        'None of the products in this print job can be found any more.'
      )
    }
    const refused = new Set(problems.map((problem) => problem.code))
    openPrintDialog({
      kind: job.kind,
      items: restored.items,
      problems: publicProblems(problems),
      settings: structuredClone(settings()),
      logoUrl: logoUrl(),
      job: {
        ...job,
        missing: restored.missing.filter(
          (product) => !refused.has(product.code)
        ),
        changed: restored.changed,
      },
    })
  }
  function openRecentPrints() {
    openRecentPrintJobs({
      onRegenerate: (job) => preparationAction(() => regeneratePrint(job)),
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
    const ids = [...new Set(rows.map((row) => row.orderId))]
    const global = globalPackingOrder([])
    const arranged = global.filter((draft) => ids.includes(draft.orderId))
    const remaining = ids.filter(
      (id) => !arranged.some((draft) => draft.orderId === id)
    )
    const orderRanks = new Map(
      [...arranged.map(({ orderId }) => orderId), ...remaining].map(
        (id, index) => [id, index]
      )
    )
    return [...rows].sort(
      (a, b) =>
        orderRanks.get(a.orderId) - orderRanks.get(b.orderId) ||
        (ranks.get(`${a.orderId}/${a.entryId}`) ?? Number.MAX_SAFE_INTEGER) -
          (ranks.get(`${b.orderId}/${b.entryId}`) ?? Number.MAX_SAFE_INTEGER)
    )
  }
  function costAffectedOrderIds(records) {
    return new Set(
      records.flatMap((record) => [
        ...(record.additionalCharges?.length ||
        record.paymentLinks?.length ||
        hasProductFeatureCosts(record)
          ? [record.snapshot.orderId]
          : []),
        ...(record.paymentLinks || []).map((link) => link.sourceOrderId),
      ])
    )
  }
  function preparedRows(rows = getRows()) {
    const allRecords = getRecords()
    const records = new Map(
      allRecords.map((record) => [record.snapshot.orderId, record])
    )
    const costOrders = costAffectedOrderIds(allRecords)
    const costs = new Map()
    return orderRows(rows).map((row) => {
      const record = records.get(row.orderId) || row.record
      if (record && costOrders.has(row.orderId) && !costs.has(row.orderId))
        costs.set(row.orderId, paymentCostAdjustments(record, allRecords))
      row = {
        ...row,
        ...preparationOrderFields(row, record, {
          records: costOrders.has(row.orderId) ? allRecords : undefined,
          costs: costs.get(row.orderId),
        }),
      }
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
          materialSource: 'suggested',
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
        ...(match.group.sharedProductId
          ? {
              sharedProductId: match.group.sharedProductId,
              sharedVariantId: match.variant.sharedVariantId,
            }
          : {}),
        variantDescription: match.variant.variant,
        sourceSize: match.variant.size,
        variantSuffix: match.variant.variantSuffix,
        sizeSuffix: match.variant.sizeSuffix,
        packingMonth: groupPackingMonth(match.prep, match.group),
        material: variantMaterial(match.variant, row.entryId).value,
        materialSource: variantMaterial(match.variant, row.entryId).source,
        manualReordered: Boolean(
          match.prep.packingManualReordered ||
          match.group.manualReordered ||
          match.variant.manualReordered
        ),
      }
    })
  }
  function preparationCopyRows(draft, { selectedOnly = true } = {}) {
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
        const include =
          !selectedOnly ||
          (variants?.size
            ? variants.has(variant.id)
            : state.groups.has(group.id))
        if (include)
          for (const id of variant.entryIds) if (scope.has(id)) entryIds.add(id)
      }
    }
    return preparedRows(
      record.snapshot.items
        .filter((item) => entryIds.has(item.entryId))
        .map((item) => ({
          ...item,
          orderId: draft.orderId,
          sellerName: record.snapshot.sellerName,
          sellerMemberLogin: record.snapshot.sellerMemberLogin,
          sourceType: record.snapshot.sourceType,
          store: record.snapshot.store,
        }))
    )
  }
  /** Packing list as .xlsx (chosen columns) plus its JSON summary. */
  function exportPackingList(rows) {
    const sizeClassifier = createSizeClassifier(preferences.sizeVocabulary)
    const fields = rows.map((row) => preparationCopyFields(row, sizeClassifier))
    let preference
    try {
      preference = JSON.parse(
        localStorage.getItem(PREPARATION_COLUMN_PREFERENCE)
      )
    } catch {}
    const columns = selectedPreparationColumns(preference)
    if (fields.some((row) => Number(row.additionalCharge) > 0))
      for (const key of [
        'effectiveUnitPrice',
        'additionalCharge',
        'effectiveAmount',
        'additionalChargeReasons',
      ])
        if (!columns.includes(key)) columns.push(key)
    if (fields.some((row) => Number(row.linkedPaymentCharge) > 0))
      for (const key of [
        'effectiveUnitPrice',
        'linkedPaymentCharge',
        'effectiveAmount',
        'linkedPaymentReasons',
      ])
        if (!columns.includes(key)) columns.push(key)
    if (fields.some((row) => Number(row.featureCharge) > 0))
      for (const key of [
        'effectiveUnitPrice',
        'featureCharge',
        'effectiveAmount',
      ])
        if (!columns.includes(key)) columns.push(key)
    if (fields.some((row) => row.productFeatureCosts))
      if (!columns.includes('productFeatureCosts'))
        columns.push('productFeatureCosts')
    if (fields.some((row) => row.productFeatures))
      if (!columns.includes('productFeatures')) columns.push('productFeatures')
    const grid = preparationGrid(fields, columns, t)
    const file = uniqueFileName(
      packingListFileName(fields.map((row) => row.sellerName))
    )
    saveFile(
      new Blob(
        [
          createXlsx({
            sheetName: t('Packing list'),
            header: grid.titles,
            rows: grid.values,
            numeric: grid.numeric,
          }),
        ],
        {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }
      ),
      file
    )
    const summary = packingSummary({ rows: fields, file })
    saveFile(
      new Blob([JSON.stringify(summary, null, 2)], {
        type: 'application/json',
      }),
      summaryFileName(file)
    )
    announceExport(summary.files)
    feedback(
      uiMessage('Packing list saved to your downloads: {0}', { 0: file })
    )
    return summary
  }
  async function copyPreparation(rows = preparedRows()) {
    if (!rows.length) throw new Error('Select product rows to copy.')
    const sizeClassifier = createSizeClassifier(preferences.sizeVocabulary)
    rows = rows.map((row) => preparationCopyFields(row, sizeClassifier))
    const modal = el(
      'dialog',
      undefined,
      'packing-column-dialog preparation-column-dialog'
    )
    bindAttribute(modal, 'aria-label', uiMessage('Copy preparation columns'))
    modal.append(
      el('h2', uiMessage('Copy {0} product rows', { 0: rows.length }))
    )
    const fields = createPreparationColumnPicker(modal, (columns) => {
      copy.disabled = !columns.length
    })
    const copy = button(
        uiMessage('Copy chosen columns'),
        async (b) =>
          copied(b, async () => {
            const columns = fields.selected()
            if (!columns.length)
              throw new Error('Select at least one column to copy.')
            await writeTable(preparationTable(rows, columns, headers(), t))
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
    copy.disabled = !fields.selected().length
    const actions = el('div', undefined, 'dialog-actions')
    actions.append(headerChoice, close, copy)
    actions.prepend(popupLanguageToggle(modal))
    modal.append(
      el(
        'p',
        uiMessage(
          'Product codes appear only once per group. Unavailable fields stay blank.'
        )
      ),
      actions
    )
    pinDialogActions(modal, actions)
    document.body.append(modal)
    modal.onclose = () => {
      fields.destroy()
      modal.remove()
    }
    enableLightDismiss(modal)
    modal.showModal()
  }
  async function openSettings() {
    const value = structuredClone(preferences)
    const tagCatalogBaseline = structuredClone({
      orderTags: preferences.orderTags || [],
      productTags: preferences.productTags || [],
    })
    value.settings = settings()
    const settingsDialog = $('settings-dialog'),
      host = $('settings-content'),
      data = $('settings-data'),
      edits = el('fieldset', undefined, 'settings-edits'),
      tabs = el('div', undefined, 'settings-tabs'),
      panels = new Map(),
      tabButtons = []
    let saving = false
    edits.append(tabs)
    host.replaceChildren(el('h2', uiMessage('Settings')), edits)
    tabs.setAttribute('role', 'tablist')
    // The tab list is a column on wide screens and a wrapping row on narrow ones.
    const narrowSettings = matchMedia('(max-width: 760px)')
    const orientTabs = () =>
      tabs.setAttribute(
        'aria-orientation',
        narrowSettings.matches ? 'horizontal' : 'vertical'
      )
    orientTabs()
    narrowSettings.addEventListener('change', orientTabs)
    settingsDialog.addEventListener(
      'close',
      () => narrowSettings.removeEventListener('change', orientTabs),
      { once: true }
    )
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
      ['colors', 'Product colors', 'image'],
      ['materials', 'Materials', 'packing'],
      ['tags', 'Tags', 'tag'],
      ['appearance', 'Appearance', 'sun'],
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
      edits.append(panel)
    }
    tabs.addEventListener('keydown', (event) => {
      const current = tabButtons.indexOf(event.target)
      if (current < 0) return
      const index =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? tabButtons.length - 1
            : event.key === 'ArrowRight' || event.key === 'ArrowDown'
              ? (current + 1) % tabButtons.length
              : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
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
    labels.append(
      el('h3', uiMessage('Label printing')),
      el(
        'p',
        uiMessage(
          'Set shared label content, print dimensions and the logo used in your barcode and carton marks.'
        ),
        'packing-help'
      ),
      grid
    )
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
      const matches = searchMatcher(
        vocabularySearch.querySelector('input').value
      )
      const matching = value.vocabulary.filter((entry) =>
        matches([entry.match, entry.exclude, entry.spanishName, entry.category])
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
    attachSearchSuggestions(vocabularySearch.querySelector('input'), () =>
      value.vocabulary.flatMap((entry) => [
        entry.spanishName,
        entry.category,
        ...String(entry.match || '').split('|'),
        ...String(entry.exclude || '').split('|'),
      ])
    )
    const sizeRules = mountSizeVocabulary(
      panels.get('settings-panel-sizes'),
      value
    )
    const colorRules = mountColorVocabulary(
      panels.get('settings-panel-colors'),
      value
    )
    const materialRules = mountMaterialVocabulary(
      panels.get('settings-panel-materials'),
      value
    )
    const tagOptions = {
        getTagUsage: (name, scope) => repository.getTagUsage(name, { scope }),
        renameTag: async (name, nextName, scope) => {
          const catalog = `${scope}Tags`
          if (
            !tagCatalogBaseline[catalog].some((entry) => entry.name === name)
          ) {
            const latest = await repository.getPackingPreferences()
            if (latest[catalog]?.some((entry) => entry.name === nextName))
              throw new Error(
                t('This tag already exists. Choose a different name.')
              )
            return false
          }
          const result = await repository.renameTag(name, nextName, { scope })
          const renamed = result.preferences[catalog].find(
            (entry) => entry.name === nextName
          )
          tagCatalogBaseline[catalog] = tagCatalogBaseline[catalog].map(
            (entry) => (entry.name === name ? renamed : entry)
          )
          await changed({ reload: true })
          channel?.postMessage('preferences')
          return true
        },
        removeTag: async (name, scope) => {
          await repository.removeTag(name, { scope })
          const catalog = `${scope}Tags`
          tagCatalogBaseline[catalog] = tagCatalogBaseline[catalog].filter(
            (entry) => entry.name !== name
          )
          await changed({ reload: true })
          channel?.postMessage('preferences')
        },
      },
      tagPanel = panels.get('settings-panel-tags'),
      tagHeading = el(
        'div',
        undefined,
        'settings-section-heading settings-tags-heading'
      )
    tagHeading.append(el('h3', uiMessage('Tags')))
    tagPanel.append(
      tagHeading,
      el(
        'p',
        uiMessage(
          'Create, rename and color order and product tags. Renaming and deleting saved tags updates them everywhere; other edits apply when you save settings.'
        ),
        'packing-help'
      )
    )
    const reviewTags = button(
      uiMessage('Review operational tags'),
      async () => {
        await flushSaves()
        await openOperationsMigrationDialog({
          records: await repository.listOrders(),
          repository,
          onSaved: async () => {
            await changed({ reload: true })
            channel?.postMessage('preferences')
            const latest = await repository.getPackingPreferences()
            for (const scope of ['order', 'product']) {
              const catalog = `${scope}Tags`
              value[catalog] = reconcileTagCatalog(
                value[catalog],
                assignedTagNames(getRecords(), scope),
                {
                  previous: latest[catalog],
                  baseline: tagCatalogBaseline[catalog],
                  scope,
                }
              )
              tagCatalogBaseline[catalog] = structuredClone(
                latest[catalog] || []
              )
            }
            tagSettings.forEach((tags) => tags.refresh())
          },
        })
      }
    )
    decorateIcon(reviewTags, 'tag')
    tagHeading.append(reviewTags)
    const tagSettings = [
      mountOrderTagSettings(
        tagPanel,
        value,
        getRecords().flatMap((record) => record.tags || []),
        tagOptions
      ),
      mountTagSettings(tagPanel, value, {
        ...tagOptions,
        scope: 'product',
        existingNames: getRecords().flatMap((record) =>
          Object.values(record.productTags || {}).flat()
        ),
      }),
    ]
    const appearance = mountAppearanceSettings(
      panels.get('settings-panel-appearance'),
      value,
      { onColorsReset: () => tagSettings.forEach((tags) => tags.refresh()) }
    )
    const guardDismissal = (event) => {
      if (saving || tagSettings.some((tags) => tags.pending))
        event.preventDefault()
    }
    settingsDialog.oncancel = guardDismissal
    settingsDialog.onsubmit = guardDismissal
    if (!data.querySelector('.store-import-guide-launch')) {
      const guide = button('Store spreadsheet guide', openStoreSpreadsheetGuide)
      guide.classList.add('store-import-guide-launch')
      preparationHelp(
        guide,
        uiMessage(
          'Check import markers, filenames and review rules. This format guide does not import files or change your library.'
        )
      )
      data.querySelector('.settings-data-actions').append(guide)
    }
    panels.get('settings-panel-data').append(data)
    const footer = el('div', undefined, 'settings-footer'),
      saveHelp = el(
        'span',
        uiMessage(
          'Save label settings, product names, sizes, colors, materials, tags and appearance.'
        ),
        'packing-help'
      )
    saveHelp.setAttribute('role', 'status')
    footer.append(
      saveHelp,
      button(
        uiMessage('Save settings'),
        async (save) => {
          if (saving) return
          saving = true
          save.disabled = true
          edits.disabled = true
          const close = settingsDialog.querySelector('.dialog-close')
          close.disabled = true
          bindText(saveHelp, uiMessage('Saving settings…'))
          clearErrorNotices(settingsDialog)
          try {
            await flushSaves()
            try {
              for (const tags of tagSettings) await tags.flush()
            } catch (error) {
              selectTab('settings-panel-tags')
              throw error
            }
            try {
              value.sizeVocabulary = sizeRules.validate()
            } catch (error) {
              selectTab('settings-panel-sizes')
              throw error
            }
            try {
              value.colorVocabulary = colorRules.validate()
            } catch (error) {
              selectTab('settings-panel-colors')
              panels
                .get('settings-panel-colors')
                .querySelector('[aria-invalid="true"]')
                ?.focus()
              throw error
            }
            value.appearance = appearance.validate()
            try {
              value.materialVocabulary = materialRules.validate()
            } catch (error) {
              selectTab('settings-panel-materials')
              panels
                .get('settings-panel-materials')
                .querySelector('[aria-invalid="true"]')
                ?.focus()
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
            preferences = await repository.savePackingPreferences(value, {
              tagCatalogBaseline,
            })
            await changed({ reload: true })
            if (!$('packing-view').hidden) {
              for (const draft of drafts) {
                const latest = preparations.get(draft.orderId)
                if (latest) acceptDraft(latest)
              }
              renderPreparation()
            }
            channel?.postMessage('preferences')
            settingsDialog.close()
            feedback(uiMessage('Settings saved.'))
          } finally {
            saving = false
            edits.disabled = false
            close.disabled = false
            save.disabled = false
            bindText(
              saveHelp,
              uiMessage(
                'Save label settings, product names, sizes, colors, materials, tags and appearance.'
              )
            )
            host.querySelector('[aria-invalid="true"]')?.focus()
          }
        },
        'primary'
      )
    )
    host.append(footer)
    selectTab('settings-panel-labels')
    dialog(settingsDialog)
  }
  function updateLaunchActions() {
    const candidates = launchCandidates()
    const rows = candidates.filter((row) => !isPackingExcluded(row))
    const skipped = candidates.length - rows.length
    const selected = getSelectedRows().length
    const busy = opening || packingExclusionSaving
    $('prepare-orders').disabled = busy || !rows.length
    $('restore-packing').disabled = busy
    for (const control of document.querySelectorAll(
      '.packing-launch-row, .packing-exclusion-toggle'
    ))
      control.disabled = busy || control.dataset.linkedPayment === 'true'
    const launchHelp = packingExclusionSaving
      ? uiMessage('Saving packing selection…')
      : skipped && !rows.length
        ? uiMessage(
            'All these products are skipped for packing. Choose Skipped on a product to include it.'
          )
        : uiMessage(
            'Prepare eligible selected products, or reopen eligible products already assigned to this packing month. Skipped products stay in Orders.'
          )
    preparationHelp($('prepare-orders'), launchHelp)
    bindText(
      $('packing-scope'),
      packingExclusionSaving
        ? uiMessage('Saving packing selection…')
        : skipped && !rows.length
          ? uiMessage(
              '0 eligible products · {0} skipped. Choose Skipped to include a product.',
              { 0: () => skipped.toLocaleString() }
            )
          : selected
            ? skipped
              ? uiMessage(
                  '{0} eligible products · {1} skipped · {2} orders → {3}',
                  {
                    0: () => rows.length.toLocaleString(),
                    1: () => skipped.toLocaleString(),
                    2: new Set(rows.map((row) => row.orderId)).size,
                    3: () => monthLabel(monthInput.value),
                  }
                )
              : uiMessage('{0} selected products · {1} orders → {2}', {
                  0: () => selected.toLocaleString(),
                  1: new Set(rows.map((row) => row.orderId)).size,
                  2: () => monthLabel(monthInput.value),
                })
            : rows.length
              ? skipped
                ? uiMessage('{0} eligible products · {1} skipped in {2}', {
                    0: () => rows.length.toLocaleString(),
                    1: () => skipped.toLocaleString(),
                    2: () => monthLabel(monthInput.value),
                  })
                : uiMessage('Reopen {0} products already in {1}', {
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
  const ordersTab = $('view-orders')
  const packingTab = $('view-packing')
  if (ordersTab && packingTab) {
    const syncTabs = () => {
      const packing = !$('packing-view').hidden
      if (packing) {
        ordersTab.removeAttribute('aria-current')
        packingTab.setAttribute('aria-current', 'page')
      } else {
        packingTab.removeAttribute('aria-current')
        ordersTab.setAttribute('aria-current', 'page')
      }
    }
    new MutationObserver(syncTabs).observe($('packing-view'), {
      attributes: true,
      attributeFilter: ['hidden'],
    })
    syncTabs()
    preparationHelp(
      ordersTab,
      uiMessage('Return to Orders. Packing edits are saved first.')
    )
    preparationHelp(
      packingTab,
      uiMessage(
        'Open the packing list for the packing month. Products already assigned to that month reopen; your product selection stays in Orders.'
      )
    )
    ordersTab.onclick = () => {
      if (!$('packing-view').hidden) showOrders()
    }
    packingTab.onclick = () => {
      if (!$('packing-view').hidden || opening) return
      openPreparation(undefined, undefined, { monthOnly: true }).catch((e) =>
        feedback(e.message, true)
      )
    }
  }
  const restoreFile = $('restore-packing-file')
  const restore = $('restore-packing')
  decorateIcon(restore, 'upload')
  preparationHelp(
    restore,
    uiMessage(
      'Load a packing backup from Orders and open its saved groups in Preparation. Unrelated library data stays unchanged; newer local edits are kept.'
    )
  )
  restore.onclick = () => restoreFile.click()
  restoreFile.addEventListener('change', async () => {
    const file = restoreFile.files[0]
    restoreFile.value = ''
    if (!file || opening || packingExclusionSaving || !$('packing-view').hidden)
      return
    opening = true
    updateLaunchActions()
    try {
      await restorePackingFile(file)
    } catch (error) {
      feedback(error.message, true)
    } finally {
      opening = false
      updateLaunchActions()
    }
  })
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
    refreshPhoto: (item, thumbnail) => media.updatePhoto(item, thumbnail),
    photoContext,
    flush: flushSaves,
    preparedRows,
    copyLabels: (kind, rows) =>
      preparationAction(() => bulkLabels(kind, orderRows(rows))),
    printLabels: (kind, rows) =>
      preparationAction(() => openPrint(kind, orderRows(rows))),
    openRecentPrints,
    canCopyLabels: (rows) =>
      rows.length > 0 &&
      rows.every((row) => membership.has(`${row.orderId}/${row.entryId}`)),
    errorOptions: packingErrorOptions,
    createCartonMarkRenderer,
    getImageBadges,
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
      const material = variantMaterial(match.variant, entryId).value
      return `${match.group.baseCode} ${code} ${match.group.spanishName} ${match.variant.spanishName || ''} ${match.group.category} ${material} ${translateMaterial(material, getLanguage())}`
    },
    updateActions: updateLaunchActions,
    orderNames(orderId) {
      const order = getRecords().find(
        (record) => record.snapshot.orderId === orderId
      )?.snapshot
      return [
        ...new Set(
          (order?.items || [])
            .map((item) => {
              const key = `${orderId}/${item.entryId}`
              const match = membership.get(key)
              return (
                match
                  ? match.variant.spanishName || match.group.spanishName
                  : suggestions.get(key)?.spanishName || ''
              ).trim()
            })
            .filter(Boolean)
        ),
      ]
    },
    decorateRow(host, row, capacityHost = host, measurementHosts) {
      scheduleRowFieldCleanup()
      const matched = membership.get(`${row.orderId}/${row.entryId}`),
        bar = el('div', undefined, 'row-preparation')
      const excluded = isPackingExcluded(row)
      if (matched) {
        // Reading an assigned code is independent of unresolved size review;
        // generating/printing its label still applies barcodeValue's full checks.
        const code = matched.group.baseCode
          ? barcodeValue(matched.group, {
              ...matched.variant,
              needsSizeMapping: false,
            })
          : ''
        const copy = copyTextButton(code, {
          label: uiMessage('Copy code'),
          className: 'row-code-copy ce-code',
        })
        bindAttribute(copy, 'aria-label', uiMessage('Copy code'))
        bar.append(copy)
        repeatProductControl(bar, matched.prep, matched.group)
        const name = matched.variant.spanishName || matched.group.spanishName
        if (name) bar.append(el('span', name, 'spanish-name'))
        if (matched.group.category)
          bar.append(el('span', matched.group.category, 'category-name'))
        if (
          !excluded &&
          (!(matched.variant.spanishName || matched.group.spanishName) ||
            !matched.group.category)
        )
          bar.append(
            button(
              uiMessage('Name'),
              () => openPreparation(row.orderId, row.entryId),
              'needs-preparation name-product packing-launch-row'
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
          bar.append(el('span', suggestion.spanishName, 'spanish-name'))
        if (suggestion?.category)
          bar.append(el('span', suggestion.category, 'category-name'))
        if (!excluded)
          bar.append(
            button(
              uiMessage('Prepare'),
              () => openPreparation(row.orderId, row.entryId),
              'needs-preparation name-product packing-launch-row'
            )
          )
      }
      bar.append(packingExclusionAction(row, excluded))
      for (const control of bar.querySelectorAll('.packing-launch-row'))
        control.disabled = opening || packingExclusionSaving
      host.append(bar)
      const record = packingRecord(row)
      if (measurementHosts) mountMeasurements(measurementHosts, row, record)
      const cartonKey = `${record?.snapshot.accountId || 'local'}/${row.orderId}/${row.entryId}`
      const existing = cartonFields.get(cartonKey)
      if (existing) {
        existing.update({
          quantity: row.quantity,
          value: record?.unitsPerCarton?.[row.entryId],
        })
        capacityHost.append(existing.control)
        return
      }
      const carton = mountCartonCapacity(capacityHost, {
        quantity: row.quantity,
        value: record?.unitsPerCarton?.[row.entryId],
        onSave: async (value) => {
          const saved = await repository.setUnitsPerCarton(
            row.orderId,
            row.entryId,
            value,
            { accountId: record?.snapshot.accountId || 'local' }
          )
          const currentRecord = packingRecord(row)
          if (!currentRecord) return
          Object.assign(
            currentRecord,
            mergeProductAnnotations(currentRecord, saved)
          )
          channel?.postMessage('carton-capacity')
        },
      })
      cartonFields.set(cartonKey, carton)
    },
  }
}
