import {
  message as uiMessage,
  bindText,
  bindAttribute,
  isMessage,
  t,
  getLocale,
  getLanguage,
  setLanguage,
  onLanguageChange,
} from './i18n.js'
import {
  element as el,
  copied,
  yieldUI,
  enableLightDismiss,
  copyTextButton,
  pinDialogActions,
} from './ui.js'
import {
  barcodeValue,
  variantMaterial,
  setVariantMaterial,
  validatePreparationSuffixEdits,
  setGroupSizeMode,
  regeneratePreparationCode,
  refreshPreparationMaterials,
} from './packing-model.js'
import { acknowledgePreparation, samePreparation } from './preparation-save.js'
import {
  createPreparationHistory,
  preparationHistorySnapshot,
  restorePreparationHistory,
} from './preparation-history.js'
import { preparationOrderFields } from './preparation-clipboard.js'
import { paymentCostAdjustments } from './payment-links.js'
import { hasProductFeatureCosts } from './product-features.js'
import {
  suggestMaterial,
  translateMaterial,
  configureMaterialVocabulary,
} from './material-vocabulary.js'
import { configureColorVocabulary } from './color-vocabulary.js'
import {
  createSizeClassifier,
  suggestPriceSizeMappings,
} from './size-vocabulary.js'
import { createPreparationMedia, preparationHelp } from './preparation-media.js'
import { mountLabelEditor } from './label-editor.js'
import { labelClipboard } from './preparation-clipboard.js'
import { DEFAULT_LABEL_SETTINGS, renderLabel } from './labels.js'
import {
  setCodeText,
  decorateCodeInput,
  refreshCodeInput,
} from './code-display.js'
import { createExcelImageBadges } from './excel-image-badges.js'
import { showErrorNotice, clearErrorNotices } from './error-notice.js'
import { decorateIcon } from './icons.js'
import { applyAppearance } from './appearance.js'
import { openStoreSpreadsheetGuide } from './store-spreadsheet-guide.js'
import { createVirtualList } from './virtual-list.js'
import { eligibleOrderItems } from './inventory-model.js'
import { mountMaterialVocabulary } from './material-vocabulary-settings.js'
import { mountColorVocabulary } from './color-vocabulary-settings.js'
import { mountAppearanceSettings } from './appearance-settings.js'
import { mountSizeVocabulary } from './size-vocabulary-settings.js'
import { mountProductVocabulary } from './product-vocabulary-settings.js'
import { assignedTagNames, reconcileTagCatalog } from './order-tags.js'
import { mountOrderTagSettings, mountTagSettings } from './order-tags-ui.js'
import { openOperationsMigrationDialog } from './operations-ui.js'
import { mountRepeatProductControl } from './repeat-products-ui.js'
import {
  regroupSelection,
  groupingAvailability,
  groupingReviewChanges,
  unusedSuffix,
} from './packing-grouping.js'
import {
  reviewPackingChanges,
  packingValueComparison,
} from './packing-review.js'
const $ = (id) => document.getElementById(id)
const orderKey = ({ accountId = 'local', orderId }) =>
  JSON.stringify([accountId, orderId])
const entryKey = (ref) =>
  JSON.stringify([
    ref.accountId || ref.record?.accountId || 'local',
    ref.orderId,
    ref.entryId,
  ])
function field(title, value, change, type = 'text') {
  const label = el('label', isMessage(title) ? title : uiMessage(title)),
    input = el('input')
  input.type = type
  input.id = `packing-${crypto.randomUUID()}`
  label.htmlFor = input.id
  input.value = value ?? ''
  input.addEventListener('input', (event) => {
    if (!event.isComposing) change(input.value)
  })
  input.addEventListener('compositionend', () => change(input.value))
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
    // Text inputs strip line breaks before a textarea can receive them.
    // Preserve the authored/source value when mounting multiline controls.
    textarea.value = value ?? ''
    textarea.rows = 2
    textarea.addEventListener('input', (event) => {
      if (!event.isComposing) change(textarea.value)
    })
    textarea.addEventListener('compositionend', () => change(textarea.value))
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
    'Share one barcode': 'barcode',
    'Give rows separate barcodes': 'barcode',
    'Move to new product': 'packing',
    'Save settings': 'check',
    Remove: 'trash',
  }
  if (buttonIcons[source]) decorateIcon(result, buttonIcons[source])
  result.addEventListener('click', async () => {
    clearErrorNotices(document)
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
function authoringLanguages(modal) {
  const controls = el('div', undefined, 'authoring-languages')
  controls.setAttribute('role', 'group')
  bindAttribute(controls, 'aria-label', uiMessage('Language'))
  for (const [language, title] of [
    ['en', 'EN'],
    ['es', 'ES'],
    ['zh', '中文'],
  ]) {
    const button = el('button', title)
    button.type = 'button'
    button.dataset.language = language
    button.onclick = () => setLanguage(language)
    controls.append(button)
  }
  const paint = () => {
    for (const button of controls.children)
      button.setAttribute(
        'aria-pressed',
        String(button.dataset.language === getLanguage())
      )
  }
  const stop = onLanguageChange(paint)
  modal.addEventListener('close', stop, { once: true })
  paint()
  modal.append(controls)
}
const blobData = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })

/** Orders owns these controllers. Containers receive only frozen output data. */
export async function createProductAuthoring({
  repository,
  getRecords,
  changed = async () => {},
  feedback = () => {},
  loadImage,
  onCartons,
  onPhotoEdit,
  getContextContainerId = () => undefined,
  onAmend = () => {},
  getSelectedRows = () => [],
}) {
  let preferences = {},
    preparations = new Map(),
    membership = new Map(),
    suggestions = new Map(),
    generation = 0,
    loadedContext,
    editor
  const sessions = new Map(),
    cartonFields = new Map()
  const histories = new Map(),
    historyBaselines = new WeakMap()
  const amendmentFor = (ref) =>
    preparations.get(orderKey(ref))?.amendmentContext
  const sameAmendment = (a, b) =>
    JSON.stringify(a || null) === JSON.stringify(b || null)
  function history() {
    const key = JSON.stringify([
      getContextContainerId() || null,
      [...preparations.values()].find((prep) => prep.amendmentContext)
        ?.amendmentContext || null,
    ])
    if (!histories.has(key)) {
      const stack = createPreparationHistory()
      histories.set(key, stack)
      historyBaselines.set(stack, new Map())
    }
    return histories.get(key)
  }
  const historyGuard = (preparation, observedAt) => ({
    revision: preparation.revision,
    observedAt,
    amendmentContext: structuredClone(preparation.amendmentContext),
  })
  const sameHistoryGuard = (left, right) =>
    left &&
    right &&
    left.revision === right.revision &&
    left.observedAt === right.observedAt &&
    sameAmendment(left.amendmentContext, right.amendmentContext)
  function beginLocalHistory(stack, preparation, observedAt) {
    const guards = historyBaselines.get(stack),
      key = orderKey(preparation),
      captured = historyGuard(preparation, observedAt)
    // A deliberate new edit may adopt a foreign saved context. Older history
    // for that order cannot cross this discontinuity; reload alone keeps it.
    if (guards.has(key) && !sameHistoryGuard(guards.get(key), captured))
      stack.clear(key)
    guards.set(key, captured)
  }
  function acknowledgeHistory(stack, preparation, observedAt) {
    historyBaselines
      .get(stack)
      .set(orderKey(preparation), historyGuard(preparation, observedAt))
  }
  const sessionKey = (ref, contextContainerId = getContextContainerId()) =>
    JSON.stringify([
      contextContainerId || null,
      amendmentFor(ref)?.epoch ?? null,
      ref.accountId || 'local',
      ref.orderId,
    ])
  const amendmentOptions = (ref) =>
    getContextContainerId()
      ? {
          contextContainerId: getContextContainerId(),
          ...(ref && (ref.amendmentContext || amendmentFor(ref))
            ? {
                expectedAmendment: structuredClone(
                  ref.amendmentContext || amendmentFor(ref)
                ),
              }
            : {}),
        }
      : {}
  const isCurrentSession = (session) =>
    session.contextContainerId === getContextContainerId() &&
    sameAmendment(session.amendmentContext, amendmentFor(session.draft))
  async function ensureContext() {
    if (loadedContext !== getContextContainerId()) await reload()
  }
  const channel = globalThis.BroadcastChannel
    ? new BroadcastChannel('1688-preparation')
    : null
  const settings = () => ({
    ...DEFAULT_LABEL_SETTINGS,
    ...preferences.settings,
    barcode: {
      ...DEFAULT_LABEL_SETTINGS.barcode,
      ...preferences.settings?.barcode,
    },
    mark: { ...DEFAULT_LABEL_SETTINGS.mark, ...preferences.settings?.mark },
  })
  const logoUrl = () =>
    preferences.logoDataUrl ||
    new URL('assets/casa-elida.png', location.href).href
  const recordFor = (ref) =>
    getRecords().find(
      ({ snapshot, accountId }) =>
        snapshot.orderId === ref.orderId &&
        (accountId || snapshot.accountId || 'local') ===
          (ref.accountId || ref.record?.accountId || 'local')
    )
  function rebuild() {
    membership = new Map()
    suggestions = new Map()
    for (const prep of preparations.values())
      for (const group of prep.groups)
        for (const variant of group.variants)
          for (const entryId of variant.entryIds)
            membership.set(entryKey({ ...prep, entryId }), {
              prep,
              group,
              variant,
            })
    for (const record of getRecords())
      for (const group of record.namingSuggestions?.groups || [])
        for (const entryId of group.entryIds)
          suggestions.set(
            entryKey({
              accountId: record.accountId,
              orderId: record.snapshot.orderId,
              entryId,
            }),
            group
          )
  }
  async function reload() {
    const version = ++generation
    const [list, prefs] = await Promise.all([
      repository.listPreparations(amendmentOptions()),
      repository.getPackingPreferences(),
    ])
    if (version !== generation) return
    loadedContext = getContextContainerId()
    preparations = new Map(list.map((prep) => [orderKey(prep), prep]))
    preferences = prefs
    configureColorVocabulary(preferences.colorVocabulary)
    configureMaterialVocabulary(preferences.materialVocabulary)
    applyAppearance(preferences.appearance)
    rebuild()
    for (const session of sessions.values()) {
      const latest = preparations.get(orderKey(session.draft))
      if (
        !session.dirty &&
        !session.mounted &&
        latest &&
        isCurrentSession(session)
      ) {
        session.draft = structuredClone(latest)
        session.saved = structuredClone(latest)
        session.sourceObservedAt = recordFor(latest)?.snapshot.observedAt
      }
    }
  }
  function preparedRows(rows) {
    const records = getRecords()
    const materials = new Map()
    const costOrders = new Set(
      records.flatMap((record) => [
        ...(record.additionalCharges?.length ||
        record.paymentLinks?.length ||
        hasProductFeatureCosts(record)
          ? [record.snapshot.orderId]
          : []),
        ...(record.paymentLinks || []).map((link) => link.sourceOrderId),
      ])
    )
    const costs = new Map()
    return rows.map((source) => {
      const record = recordFor(source) || source.record
      if (
        record &&
        costOrders.has(source.orderId) &&
        !costs.has(
          orderKey({ accountId: record.accountId, orderId: source.orderId })
        )
      )
        costs.set(
          orderKey({ accountId: record.accountId, orderId: source.orderId }),
          paymentCostAdjustments(record, records)
        )
      const row = {
        ...source,
        accountId: record?.accountId || source.accountId || 'local',
        ...preparationOrderFields(source, record, {
          records: costOrders.has(source.orderId) ? records : undefined,
          costs: costs.get(
            orderKey({ accountId: record?.accountId, orderId: source.orderId })
          ),
        }),
      }
      const match = membership.get(entryKey(row)),
        suggestion = suggestions.get(entryKey(row))
      if (!match)
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
      const key = orderKey(match.prep)
      if (!materials.has(key)) {
        const refreshed = record
          ? refreshPreparationMaterials(match.prep, record.snapshot)
          : match.prep
        materials.set(
          key,
          new Map(
            refreshed.groups.flatMap((group) =>
              group.variants.flatMap((variant) =>
                variant.entryIds.map((entryId) => [
                  entryId,
                  variantMaterial(variant, entryId),
                ])
              )
            )
          )
        )
      }
      const material = materials.get(key).get(row.entryId)
      let code = ''
      try {
        code = barcodeValue(match.group, match.variant)
      } catch {}
      return {
        ...row,
        baseCode: match.group.baseCode,
        barcode: code,
        spanishName: match.variant.spanishName ?? match.group.spanishName,
        needsSizeMapping: Boolean(match.variant.needsSizeMapping),
        chineseCategory: match.group.category,
        groupId: match.group.id,
        variantId: match.variant.id,
        variantDescription: match.variant.variant,
        sourceSize: match.variant.size,
        variantSuffix: match.variant.variantSuffix,
        sizeSuffix: match.variant.sizeSuffix,
        material: material.value,
        materialSource: material.source,
        ...(match.group.sharedProductId
          ? {
              sharedProductId: match.group.sharedProductId,
              sharedVariantId: match.variant.sharedVariantId,
            }
          : {}),
      }
    })
  }
  function photoContext(item) {
    const row = preparedRows([item])[0]
    return {
      code: row.barcode,
      sellerName: row.sellerName,
      spanishName: row.spanishName,
      quantity: row.quantity,
    }
  }
  function labelRows(rows) {
    const records = getRecords(),
      eligibility = new Map()
    return rows.flatMap((row) => {
      const record = recordFor(row)
      if (!record) return []
      const key = orderKey({
        accountId: record.accountId || record.snapshot.accountId || 'local',
        orderId: record.snapshot.orderId,
      })
      if (!eligibility.has(key))
        eligibility.set(
          key,
          new Map(
            eligibleOrderItems(record, records).map((entry) => [
              entry.entryId,
              entry,
            ])
          )
        )
      const entry = eligibility.get(key).get(row.entryId)
      if (!entry) return []
      // Source label requests can retain fractional/zero historical quantities;
      // that does not establish whole-unit inventory or authorize a shipment.
      if (!entry.dispositionKind && !entry.paymentOnly && !entry.reason)
        return [{ ...row, quantity: entry.eligible ?? row.quantity }]
      return entry.eligible != null && BigInt(entry.eligible) > 0n
        ? [{ ...row, quantity: entry.eligible }]
        : []
    })
  }
  const media = createPreparationMedia({
    container: null,
    loadImage,
    settings,
    logoUrl,
    getPhotoContext: photoContext,
    getSizeClassifier: () => createSizeClassifier(preferences.sizeVocabulary),
    getPhotoItems: getSelectedRows,
    onPhotoEdit,
  })
  function recoveryKey(ref, contextContainerId = getContextContainerId()) {
    return `1688-orders-authoring-draft:${orderKey(ref)}${contextContainerId ? `:amendment:${contextContainerId}` : ''}`
  }
  function retain(session) {
    // Recovery UI state is not inventory. Only the repository accepts facts.
    try {
      localStorage.setItem(
        recoveryKey(session.draft, session.contextContainerId),
        JSON.stringify(session.draft)
      )
    } catch (error) {
      session.error = new Error(
        'The editing draft could not be saved for recovery.'
      )
      feedback(session.error.message, true)
    }
  }
  function getSession(ref) {
    const key = sessionKey(ref)
    let session = sessions.get(key)
    if (!session) {
      const saved = preparations.get(orderKey(ref))
      if (!saved) throw new Error('Review product codes in Orders first.')
      let draft = structuredClone(saved)
      try {
        const recovered = JSON.parse(localStorage.getItem(recoveryKey(ref)))
        if (
          recovered &&
          orderKey(recovered) === orderKey(ref) &&
          Array.isArray(recovered.groups)
        )
          draft = recovered
      } catch {}
      session = {
        draft,
        saved: structuredClone(saved),
        sourceObservedAt: recordFor(saved)?.snapshot.observedAt,
        contextContainerId: getContextContainerId(),
        amendmentContext: structuredClone(saved.amendmentContext),
        dirty: !samePreparation(draft, saved),
        generation: 0,
        work: null,
        error: null,
        stale:
          draft.revision !== saved.revision ||
          !sameAmendment(draft.amendmentContext, saved.amendmentContext),
      }
      sessions.set(key, session)
    }
    return session
  }
  async function flushSession(session) {
    clearTimeout(session.timer)
    if (session.work) {
      await session.work
      return flushSession(session)
    }
    if (!session.dirty) return
    if (session.stale)
      throw new Error(
        'Review the recovered draft against the newer saved revision before saving.'
      )
    const submitted = structuredClone(session.draft),
      before = session.saved || preparations.get(orderKey(submitted))
    if (before && before.revision !== submitted.revision) {
      session.stale = true
      throw new Error(
        'Review the recovered draft against the newer saved revision before saving.'
      )
    }
    const cleared = submitted.groups.find(
      (group) =>
        !group.baseCode &&
        before?.groups.some((saved) => saved.id === group.id && saved.baseCode)
    )
    if (cleared)
      throw new Error(
        'Enter a complete product code. Clearing an assigned code cannot create a new one.'
      )
    validatePreparationSuffixEdits(submitted, before, {
      snapshot: recordFor(submitted)?.snapshot,
      sizeVocabulary: preferences.sizeVocabulary,
    })
    const version = session.generation,
      stack = session.history || history(),
      observedAt = session.sourceObservedAt
    session.notify?.('Saving…')
    session.work = repository.savePreparations([submitted], {
      ...(session.contextContainerId
        ? {
            contextContainerId: session.contextContainerId,
            expectedAmendment: session.amendmentContext,
          }
        : {}),
      expectedRevisions: [submitted.revision],
      expectedSnapshots: [
        {
          accountId: submitted.accountId,
          orderId: submitted.orderId,
          observedAt,
        },
      ],
    })
    try {
      const [result] = await session.work
      acknowledgePreparation(session.draft, submitted, result)
      session.saved = structuredClone(result)
      acknowledgeHistory(stack, result, observedAt)
      if (isCurrentSession(session)) {
        preparations.set(orderKey(result), result)
        rebuild()
      }
      session.dirty = session.generation !== version
      session.error = null
      session.notify?.(session.dirty ? 'Pending changes' : 'Saved')
      if (!session.dirty) {
        try {
          localStorage.removeItem(
            recoveryKey(result, session.contextContainerId)
          )
        } catch {}
      } else retain(session)
      channel?.postMessage('changed')
      await changed()
    } catch (error) {
      session.error = error
      session.notify?.(error.message)
      retain(session)
      throw error
    } finally {
      session.work = null
    }
    if (session.dirty) return flushSession(session)
  }
  async function flushSaves() {
    for (const controller of cartonFields.values()) await controller.flush()
    for (const session of sessions.values()) {
      if (isCurrentSession(session)) await flushSession(session)
      else clearTimeout(session.timer)
    }
  }
  function editSession(session, change, mergeKey = null) {
    const before = preparationHistorySnapshot(session.draft)
    change(session.draft)
    if (before === preparationHistorySnapshot(session.draft)) return
    const stack = history()
    beginLocalHistory(stack, session.saved, session.sourceObservedAt)
    session.history = stack
    stack.record(
      orderKey(session.draft),
      before,
      preparationHistorySnapshot(session.draft),
      mergeKey
    )
    session.generation++
    session.dirty = true
    session.error = null
    session.notify?.('Pending changes')
    retain(session)
    clearTimeout(session.timer)
    session.timer = setTimeout(
      () =>
        void flushSession(session).catch((error) => {
          session.error = error
          session.notify?.(error.message)
          if (!session.notify) feedback(error.message, true)
        }),
      800
    )
  }
  async function reviewRecovered(session) {
    const latest = (
      await repository.listPreparations(
        session.contextContainerId
          ? { contextContainerId: session.contextContainerId }
          : {}
      )
    ).find((draft) => orderKey(draft) === orderKey(session.draft))
    if (!latest) throw new Error('This edit session is no longer available.')
    const rows = (draft) =>
      new Map(
        draft.groups.flatMap((group) =>
          group.variants.flatMap((variant) =>
            variant.entryIds.map((entryId) => [
              entryId,
              [
                group.baseCode,
                variant.variantSuffix,
                variant.sizeSuffix,
                variant.spanishName ?? group.spanishName,
                group.category,
                variantMaterial(variant, entryId).value,
              ].join('\n'),
            ])
          )
        )
      )
    const savedRows = rows(latest),
      recoveredRows = rows(session.draft),
      changes = [...new Set([...savedRows.keys(), ...recoveredRows.keys()])]
        .filter((id) => savedRows.get(id) !== recoveredRows.get(id))
        .map((entryId) => ({
          name:
            recordFor(latest)?.snapshot.items.find(
              (item) => item.entryId === entryId
            )?.description || entryId,
          orderId: latest.orderId,
          before: savedRows.get(entryId) || '—',
          after: recoveredRows.get(entryId) || '—',
        }))
    const choice = await reviewPackingChanges({
      title: uiMessage('Review recovered product edits'),
      explanation: uiMessage(
        'A newer saved revision exists. Review every recovered value before using it; current ownership and physical-history checks still apply.'
      ),
      changes,
      proceed: uiMessage('Use these reviewed edits'),
      alternate: { label: uiMessage('Keep saved version'), value: 'saved' },
      media,
    })
    if (!choice) return false
    preparations.set(orderKey(latest), latest)
    session.saved = structuredClone(latest)
    session.amendmentContext = structuredClone(latest.amendmentContext)
    session.sourceObservedAt = recordFor(latest)?.snapshot.observedAt
    session.history = history()
    beginLocalHistory(session.history, latest, session.sourceObservedAt)
    if (choice === 'saved') {
      session.draft = structuredClone(latest)
      session.dirty = false
      localStorage.removeItem(recoveryKey(latest, session.contextContainerId))
    } else {
      session.draft.revision = latest.revision
      session.draft.updatedAt = latest.updatedAt
      session.draft.amendmentContext = structuredClone(latest.amendmentContext)
      session.dirty = true
      retain(session)
    }
    session.stale = false
    session.error = null
    return true
  }
  async function travel(direction) {
    await flushSaves()
    const stack = history(),
      result = stack.peek(direction)
    if (!result) return
    const entries = result.changes || [result]
    const before = entries.map((entry) => preparations.get(entry.orderId))
    if (before.some((draft) => !draft))
      throw new Error('This edit session is no longer available.')
    const guards = entries.map((entry) =>
      structuredClone(historyBaselines.get(stack).get(entry.orderId))
    )
    if (
      before.some(
        (draft, index) =>
          !sameHistoryGuard(
            guards[index],
            historyGuard(draft, recordFor(draft)?.snapshot.observedAt)
          )
      )
    )
      throw new Error(
        'Preparation changed in another tab. Reload it before saving your edits.'
      )
    const candidates = entries.map((entry, index) =>
      restorePreparationHistory(entry.value, before[index])
    )
    const controls = [
        ...document.querySelectorAll(
          '.product-authoring-dialog input,.product-authoring-dialog textarea,.product-authoring-dialog button'
        ),
      ],
      disabled = controls.map((control) => control.disabled)
    const submitted = new Map(
      before.map((draft) => [
        orderKey(draft),
        structuredClone(sessions.get(sessionKey(draft))?.draft || draft),
      ])
    )
    controls.forEach((control) => {
      control.disabled = true
    })
    try {
      const results = await repository.savePreparations(candidates, {
        ...(getContextContainerId()
          ? {
              contextContainerId: getContextContainerId(),
              expectedAmendment: guards[0].amendmentContext,
            }
          : {}),
        expectedRevisions: guards.map((guard) => guard.revision),
        expectedSnapshots: before.map((draft, index) => ({
          accountId: draft.accountId,
          orderId: draft.orderId,
          observedAt: guards[index].observedAt,
        })),
        suffixBaselines: candidates,
        preserveNaming: true,
      })
      stack[direction]()
      for (const [index, saved] of results.entries()) {
        acknowledgeHistory(stack, saved, guards[index].observedAt)
        preparations.set(orderKey(saved), saved)
        const session = sessions.get(sessionKey(saved))
        if (session) {
          session.saved = structuredClone(saved)
          acknowledgePreparation(
            session.draft,
            submitted.get(orderKey(saved)),
            saved
          )
          session.dirty = !samePreparation(session.draft, saved)
          session.error = null
          if (session.dirty) retain(session)
          else
            try {
              localStorage.removeItem(recoveryKey(saved))
            } catch {}
        }
      }
      rebuild()
      await changed()
      channel?.postMessage('changed')
    } finally {
      controls.forEach((control, index) => {
        control.disabled = disabled[index]
      })
    }
  }
  async function reviewCodes(rows = getSelectedRows()) {
    await flushSaves()
    const refs = rows.map((row) => ({
      accountId: row.accountId || row.record?.accountId || 'local',
      orderId: row.orderId,
      entryId: row.entryId,
    }))
    if (!refs.length) throw new Error('Select product rows to review codes.')
    const orderRefs = [
      ...new Map(
        refs.map((ref) => [
          orderKey(ref),
          { accountId: ref.accountId, orderId: ref.orderId },
        ])
      ).values(),
    ]
    const review = await repository.reviewPurchaseCodes({
      orderRefs,
      entryRefs: refs,
    })
    const modal = el(
        'dialog',
        undefined,
        'packing-review purchase-code-review'
      ),
      content = el('div', undefined, 'purchase-code-review-content'),
      items = el('div', undefined, 'purchase-code-review-items'),
      status = el('p'),
      actions = el('div', undefined, 'dialog-actions')
    modal.dataset.action = 'purchase-code-review'
    modal.append(
      el('h2', uiMessage('Review purchase-month codes')),
      el(
        'p',
        uiMessage(
          'New codes use the original purchase month. Review does not reserve codes.'
        )
      )
    )
    function reviewCard(row) {
      const card = el('article')
      card.dataset.orderId = row.orderId || ''
      card.dataset.entryId = row.entryId || ''
      if (row.photo)
        card.append(
          media.photo(
            typeof row.photo === 'string'
              ? {
                  thumbnail: row.photo,
                  description: row.name || row.description || '',
                  orderId: row.orderId,
                  entryId: row.entryId,
                }
              : row.photo
          )
        )
      const code = el('code', undefined, 'ce-code purchase-code')
      setCodeText(code, row.after || row.code || row.baseCode || '—')
      card.append(
        el('p', row.name || row.description || row.entryId || row.orderId),
        code
      )
      if (row.after === '' && row.baseCode)
        card.append(
          el('small', uiMessage('Product code')),
          el('p', uiMessage('Map this variant size before generating labels'))
        )
      if (row.supplierIdentity) {
        const identity = row.supplierIdentity
        card.append(
          el(
            'p',
            uiMessage(
              identity.provenance === 'manual-confirmed'
                ? 'Operator-confirmed supplier identity'
                : 'Original source supplier identity'
            )
          ),
          el('code', identity.sellerId || '—')
        )
        if (identity.conflict)
          card.append(
            el(
              'p',
              uiMessage(
                'Supplier identities disagree. Review the source and authored evidence before assigning or linking codes.'
              )
            )
          )
      }
      return card
    }
    content.append(items)
    items.dataset.rowCount = String(
      (review.changes || review.assignments || []).length
    )
    items.setAttribute('role', 'list')
    bindAttribute(items, 'aria-label', uiMessage('Review purchase-month codes'))
    for (const issue of review.issues || []) {
      const notice = el(
        'p',
        uiMessage(
          issue.code === 'PURCHASE_SIZE_REQUIRED'
            ? 'Map this variant size before generating labels'
            : issue.message || issue
        )
      )
      if (issue.code) notice.dataset.issueCode = issue.code
      content.append(notice)
      if (issue.code === 'PURCHASE_SIZE_REQUIRED') continue
      const ref = orderRefs.find(
        (ref) => !issue.orderId || ref.orderId === issue.orderId
      )
      if (ref) {
        const resolve = button('Review purchase evidence', async () => {
          modal.close()
          await openInventoryRecovery({
            ...ref,
            entryId: refs.find((entry) => entry.orderId === ref.orderId)
              ?.entryId,
          })
        })
        resolve.dataset.action = 'review-purchase-evidence'
        content.append(resolve)
      }
    }
    const cancel = el('button', uiMessage('Cancel')),
      commit = el('button', uiMessage('Assign purchase codes'), 'primary'),
      intentId = crypto.randomUUID()
    let assigning = false,
      reviewList
    commit.dataset.action = 'assign-purchase-codes'
    commit.disabled = (review.issues || []).some(
      (issue) => issue.severity === 'error'
    )
    cancel.onclick = () => modal.close()
    commit.onclick = () =>
      void (async () => {
        assigning = true
        commit.disabled = cancel.disabled = true
        try {
          await repository.assignPurchaseCodes({
            plan: review.plan || review,
            expectedRevisions: review.expectedRevisions,
            intentId,
          })
          await reload()
          await changed()
          modal.close('assigned')
        } catch (error) {
          bindText(status, uiMessage(error.message))
        } finally {
          assigning = false
          commit.disabled = cancel.disabled = false
        }
      })()
    status.setAttribute('role', 'status')
    actions.append(cancel, commit)
    modal.append(content, status, actions)
    modal.onclose = () => {
      reviewList?.destroy()
      media.forget(modal)
      modal.remove()
    }
    document.body.append(modal)
    modal.showModal()
    modal.oncancel = (event) => {
      if (assigning) event.preventDefault()
    }
    reviewList = createVirtualList({
      scroller: items,
      sections: [
        {
          element: items,
          entries: (review.changes || review.assignments || []).map((row) => ({
            key: JSON.stringify([
              row.accountId || 'local',
              row.orderId,
              row.entryId,
              row.groupId,
              row.variantId,
            ]),
            row,
          })),
        },
      ],
      render: ({ row }) => {
        const card = reviewCard(row)
        card.setAttribute('role', 'listitem')
        return card
      },
      remove: (node) => media.forget(node),
      limit: 100,
    })
    reviewList.update()
  }
  async function openInventoryRecovery(ref) {
    await flushSaves()
    const context = await repository.getOrderReconciliation({
        accountId: ref.accountId || 'local',
        orderId: ref.orderId,
        ...(getContextContainerId()
          ? { contextContainerId: getContextContainerId() }
          : {}),
      }),
      record = context.record,
      item =
        record.snapshot.items.find((item) => item.entryId === ref.entryId) ||
        record.snapshot.items[0]
    if (!item) throw new Error('The target source row is unavailable.')
    const evidenceContext = {
      ...(getContextContainerId()
        ? { contextContainerId: getContextContainerId() }
        : {}),
      ...(context.amendmentContext || context.revisions?.amendmentContext
        ? {
            expectedAmendment: structuredClone(
              context.amendmentContext || context.revisions.amendmentContext
            ),
          }
        : {}),
    }
    const identity = {
        accountId: record.accountId || record.snapshot.accountId || 'local',
        orderId: record.snapshot.orderId,
      },
      recoveryKey = `1688-orders-evidence-draft:${JSON.stringify([identity.accountId, identity.orderId, item.entryId])}`,
      previous = structuredClone(
        record.inventoryDispositions?.[item.entryId] || null
      ),
      modal = el('dialog', undefined, 'product-authoring-dialog'),
      status = el('p'),
      source = el('p'),
      date = el('input'),
      supplier = el('input'),
      kind = el('select'),
      quantity = el('input'),
      reason = el('textarea'),
      saveDate = el('button', uiMessage('Resolve original purchase date')),
      saveSupplier = el('button', uiMessage('Resolve supplier identity')),
      save = el('button', uiMessage('Save inventory evidence')),
      close = el('button', uiMessage('Close'))
    modal.dataset.action = 'review-purchase-evidence'
    modal.append(
      el('h2', uiMessage('Review purchase evidence')),
      el('p', item.description || item.title)
    )
    bindText(
      source,
      uiMessage('Original source date: {0}', {
        0: record.snapshot.purchasedAt || '—',
      })
    )
    modal.append(source)
    if (record.supplierIdentityResolution)
      modal.append(
        el('p', uiMessage('Operator-confirmed supplier identity')),
        el('code', record.supplierIdentityResolution.sellerId || '—'),
        el('time', record.supplierIdentityResolution.updatedAt || '')
      )
    const label = (text, input) => {
      const node = el('label', uiMessage(text))
      bindAttribute(input, 'aria-label', uiMessage(text))
      node.append(input)
      modal.append(node)
    }
    supplier.type = 'text'
    supplier.value = record.supplierIdentityResolution?.sellerId || ''
    modal.append(
      el(
        'p',
        uiMessage('Original supplier identity: {0}', {
          0: record.snapshot.sellerMemberLogin || '—',
        })
      )
    )
    label('Authored supplier identity', supplier)
    modal.append(
      saveSupplier,
      el(
        'p',
        uiMessage(
          'Operator-confirmed supplier identity is retained with provenance. An unambiguous source identity takes priority; disagreements require review.'
        )
      )
    )
    date.type = 'date'
    date.value =
      record.purchaseDateResolution?.date ||
      context.resolvedPurchaseDate?.date ||
      context.resolvedPurchaseDate ||
      ''
    label('Resolved original purchase date', date)
    modal.append(
      saveDate,
      el(
        'p',
        uiMessage(
          'Resolve only a missing or ambiguous original purchase date. Source evidence remains unchanged.'
        )
      )
    )
    for (const [value, title] of [
      ['goods', 'Eligible goods'],
      ['non-goods', 'Non-goods'],
      ['fee', 'Fee'],
      ['payment-only', 'Payment only'],
      ['canceled', 'Canceled quantity'],
    ])
      kind.append(new Option(uiMessage(title), value))
    kind.value = previous?.kind || 'goods'
    quantity.type = 'text'
    quantity.inputMode = 'numeric'
    quantity.value = previous?.quantity || ''
    reason.value = previous?.reason || ''
    label('Inventory disposition', kind)
    label('Canceled quantity', quantity)
    label('Evidence reason', reason)
    modal.append(
      el(
        'p',
        uiMessage(
          'Only documented non-goods, fees, payment-only rows or canceled quantities reduce eligible inventory. Container selection never excludes goods.'
        )
      )
    )
    try {
      const recovered = JSON.parse(localStorage.getItem(recoveryKey) || 'null')
      if (recovered) {
        date.value = recovered.date || date.value
        supplier.value = recovered.supplier ?? supplier.value
        if (recovered.kind) kind.value = recovered.kind
        if (recovered.quantity !== undefined)
          quantity.value = recovered.quantity
        if (recovered.reason !== undefined) reason.value = recovered.reason
        bindText(
          status,
          uiMessage(
            'Recovered unsaved evidence. Review it against the saved values before saving.'
          )
        )
      }
    } catch {
      /* Invalid local recovery never replaces persisted evidence. */
    }
    const retain = () =>
      localStorage.setItem(
        recoveryKey,
        JSON.stringify({
          date: date.value,
          supplier: supplier.value,
          kind: kind.value,
          quantity: quantity.value,
          reason: reason.value,
        })
      )
    const controls = [
      date,
      supplier,
      kind,
      quantity,
      reason,
      saveDate,
      saveSupplier,
      save,
      close,
    ]
    const busy = (value) =>
      controls.forEach((control) => (control.disabled = value))
    let saving = false
    let committed = false
    const retryRefresh = el('button', uiMessage('Retry'))
    retryRefresh.hidden = true
    retryRefresh.dataset.action = 'retry-evidence-refresh'
    const finishRefresh = async () => {
      await reload()
      await changed({ reload: true })
      modal.close('saved')
    }
    retryRefresh.onclick = () =>
      void (async () => {
        if (saving) return
        saving = true
        retryRefresh.disabled = true
        try {
          await finishRefresh()
        } catch (error) {
          bindText(status, uiMessage(error.message))
        } finally {
          saving = false
          retryRefresh.disabled = false
        }
      })()
    async function commit(run, domain = 'disposition') {
      if (saving || committed) return
      saving = true
      retain()
      busy(true)
      try {
        await run()
        committed = true
        const recovered = JSON.parse(localStorage.getItem(recoveryKey) || '{}')
        if (domain === 'date') delete recovered.date
        else if (domain === 'supplier') delete recovered.supplier
        else {
          delete recovered.kind
          delete recovered.quantity
          delete recovered.reason
        }
        if (Object.keys(recovered).length)
          localStorage.setItem(recoveryKey, JSON.stringify(recovered))
        else localStorage.removeItem(recoveryKey)
        await finishRefresh()
      } catch (error) {
        bindText(status, uiMessage(error.message))
        retryRefresh.hidden = !committed
      } finally {
        saving = false
        busy(false)
        if (committed)
          save.disabled = saveDate.disabled = saveSupplier.disabled = true
      }
    }
    const update = () => {
      quantity.hidden = kind.value !== 'canceled'
      retain()
    }
    kind.onchange = update
    for (const input of [date, supplier, quantity, reason])
      input.oninput = retain
    quantity.hidden = kind.value !== 'canceled'
    saveDate.dataset.action = 'resolve-purchase-date'
    saveSupplier.dataset.action = 'resolve-purchase-supplier'
    saveSupplier.onclick = () =>
      void commit(
        () =>
          repository.resolvePurchaseSupplier({
            ...identity,
            ...evidenceContext,
            sellerId: supplier.value.trim(),
            expectedObservedAt: record.snapshot.observedAt,
          }),
        'supplier'
      )
    saveDate.onclick = () =>
      void commit(
        () =>
          repository.resolvePurchaseDate({
            ...identity,
            ...evidenceContext,
            date: date.value,
            expectedObservedAt: record.snapshot.observedAt,
          }),
        'date'
      )
    save.dataset.action = 'save-inventory-disposition'
    save.onclick = () =>
      void commit(async () => {
        if (kind.value !== 'goods' && !reason.value.trim())
          throw new Error('Document the reason for the inventory disposition.')
        if (
          kind.value === 'canceled' &&
          !/^[1-9]\d*$/.test(quantity.value.trim())
        )
          throw new Error('Canceled quantity must be a positive whole number.')
        await repository.setInventoryDispositions({
          ...identity,
          ...evidenceContext,
          entries: {
            [item.entryId]:
              kind.value === 'goods'
                ? null
                : {
                    kind: kind.value,
                    reason: reason.value.trim(),
                    ...(kind.value === 'canceled'
                      ? { quantity: quantity.value.trim() }
                      : {}),
                  },
          },
          expectedValues: { [item.entryId]: previous },
        })
      })
    close.onclick = () => modal.close()
    modal.oncancel = (event) => {
      if (saving) event.preventDefault()
    }
    modal.onclose = () => modal.remove()
    status.setAttribute('role', 'status')
    modal.append(status, retryRefresh, save, close)
    if (context.preparation?.groups.some((group) => group.baseCode)) {
      const legacy = button('Review legacy supplier identity', async () => {
        const review = await repository.reviewLegacySupplierIdentity({
            ...identity,
            ...evidenceContext,
          }),
          dialog = el('dialog', undefined, 'legacy-supplier-identity-review'),
          reason = el('textarea'),
          label = el('label', uiMessage('Identity review reason')),
          status = el('p'),
          confirm = el(
            'button',
            uiMessage('Confirm reviewed supplier equivalence')
          ),
          cancel = el('button', uiMessage('Cancel')),
          intentId = crypto.randomUUID(),
          draftKey = `1688-orders-legacy-identity-draft:${orderKey(identity)}`
        dialog.dataset.action = 'review-legacy-supplier-identity'
        dialog.append(
          el('h2', uiMessage('Review legacy supplier identity')),
          el(
            'p',
            uiMessage(
              'Review the historical code owner and actual supplier. Issued codes, prefixes, source purchases and financial evidence remain unchanged.'
            )
          )
        )
        for (const change of review.changes || []) {
          dialog.append(el('p', `${change.before} → ${change.after}`))
          for (const owner of change.codeOwners || [])
            dialog.append(el('code', owner.baseCode))
        }
        for (const issue of review.issues || [])
          dialog.append(el('p', uiMessage(issue.message || issue.code)))
        label.append(reason)
        reason.value = globalThis.localStorage?.getItem(draftKey) || ''
        reason.oninput = () =>
          globalThis.localStorage?.setItem(draftKey, reason.value)
        dialog.append(label, status, cancel, confirm)
        const blocked =
          !review.changes?.length ||
          (review.requiresAmendment && !getContextContainerId()) ||
          (review.issues || []).some((issue) => issue.severity === 'error')
        for (const dependency of review.requiresAmendment &&
        !getContextContainerId()
          ? review.affectedShipmentRevisions || []
          : []) {
          const amend = el('button', uiMessage('Open container amendment'))
          amend.onclick = () => {
            dialog.close()
            modal.close()
            onAmend(dependency)
          }
          dialog.append(amend)
        }
        confirm.disabled = blocked
        confirm.dataset.action = 'confirm-legacy-supplier-identity'
        let saving = false
        cancel.onclick = () => dialog.close()
        confirm.onclick = () =>
          void (async () => {
            if (saving) return
            if (!reason.value.trim())
              throw new Error(
                'Document a reason for the reviewed supplier equivalence.'
              )
            saving = true
            confirm.disabled = cancel.disabled = reason.disabled = true
            await repository.confirmLegacySupplierIdentity({
              plan: review.plan || review,
              expectedRevisions: review.expectedRevisions,
              reason: reason.value.trim(),
              intentId,
              ...evidenceContext,
              ...(review.expectedRevisions?.amendmentContext
                ? {
                    expectedAmendment:
                      review.expectedRevisions.amendmentContext,
                  }
                : {}),
            })
            await reload()
            await changed({ reload: true })
            globalThis.localStorage?.removeItem(draftKey)
            dialog.close('saved')
            modal.close('saved')
          })()
            .catch((error) => bindText(status, uiMessage(error.message)))
            .finally(() => {
              saving = false
              cancel.disabled = reason.disabled = false
              confirm.disabled = blocked
            })
        dialog.oncancel = (event) => {
          if (saving) event.preventDefault()
        }
        dialog.onclose = () => dialog.remove()
        document.body.append(dialog)
        dialog.showModal()
      })
      legacy.dataset.action = 'review-legacy-supplier-identity'
      modal.insertBefore(legacy, status)
    }
    document.body.append(modal)
    modal.showModal()
  }
  async function openEditor(ref) {
    await ensureContext()
    for (const session of sessions.values())
      if (!session.stale && isCurrentSession(session))
        await flushSession(session)
    const match = membership.get(entryKey(ref))
    if (!match) return reviewCodes([ref])
    const session = getSession(match.prep)
    if (session.stale && !(await reviewRecovered(session))) return
    session.mounted = true
    const group = session.draft.groups.find((group) =>
        group.variants.some((variant) => variant.entryIds.includes(ref.entryId))
      ),
      variant = group?.variants.find((variant) =>
        variant.entryIds.includes(ref.entryId)
      )
    if (!group || !variant)
      throw new Error('The target source row is unavailable.')
    const modal = el('dialog', undefined, 'product-authoring-dialog'),
      content = el('div', undefined, 'product-authoring-fields'),
      status = el('p'),
      close = el('button', uiMessage('Close')),
      undo = el('button', uiMessage('Undo')),
      redo = el('button', uiMessage('Redo'))
    session.modal = modal
    let removed = false
    function removeEditor() {
      if (removed) return
      removed = true
      if (session.modal === modal) {
        session.modal = undefined
        session.mounted = false
        session.notify = undefined
      }
      media.forget(modal)
      modal.remove()
    }
    function dismissEditor() {
      modal.close()
      // A native close event is queued. Release this editor before a replacement
      // mounts, so the old event cannot clear its new session observer.
      removeEditor()
    }
    modal.dataset.action = 'edit-order-product'
    modal.append(el('h2', uiMessage('Edit product in Orders')))
    authoringLanguages(modal)
    const row = preparedRows([ref])[0]
    modal.append(el('p', row.description || row.title))
    const sourceFacts = el('div', undefined, 'product-authoring-source-facts')
    for (const [value, label] of [
      [variant.variant, 'Copy value'],
      [variant.size, 'Copy size'],
      [
        recordFor(ref)?.snapshot.items.find(
          (item) => item.entryId === ref.entryId
        )?.quantity,
        'Copy quantity',
      ],
    ])
      if (value !== undefined && value !== '')
        sourceFacts.append(
          copyTextButton(String(value), { label: uiMessage(label) })
        )
    modal.append(sourceFacts)
    if (ref.thumbnail) modal.append(media.photo(ref))
    const fields = []
    let resolveControl
    const mappingStatus = el(
      'p',
      uiMessage('Map this variant size before generating labels'),
      'size-mapping-status'
    )
    mappingStatus.setAttribute('role', 'status')
    status.id = `orders-authoring-status-${crypto.randomUUID()}`
    session.notify = (message) => {
      const savedGroup = session.saved?.groups.find(
          (entry) => entry.id === group.id
        ),
        savedVariant = savedGroup?.variants.find(
          (entry) => entry.id === variant.id
        )
      mappingStatus.hidden = !(
        variant.needsSizeMapping || savedVariant?.needsSizeMapping
      )
      if (mappingStatus.hidden) delete mappingStatus.dataset.issueCode
      else mappingStatus.dataset.issueCode = 'SIZE_MAPPING_REQUIRED'
      bindText(status, uiMessage(message))
      if (!session.error) {
        for (const field of fields) {
          field.input.removeAttribute('aria-invalid')
          field.input.removeAttribute('aria-errormessage')
        }
        clearErrorNotices(modal)
        if (resolveControl) resolveControl.hidden = true
        return
      }
      const fieldName = {
          variant: 'Variant ending',
          variantSuffix: 'Variant ending',
          size: 'Size ending',
          sizeSuffix: 'Size ending',
          code: 'Product code',
          baseCode: 'Product code',
          name: 'Spanish name',
          category: 'Chinese category',
        }[session.error.packingIssue?.field],
        affected = new Set(
          fieldName
            ? [fieldName]
            : group.baseCode !== savedGroup?.baseCode
              ? ['Product code']
              : [
                  ...(variant.variantSuffix !== savedVariant?.variantSuffix
                    ? ['Variant ending']
                    : []),
                  ...(variant.sizeSuffix !== savedVariant?.sizeSuffix
                    ? ['Size ending']
                    : []),
                ]
        )
      if (!affected.size) affected.add('Product code')
      for (const field of fields) {
        if (affected.has(field.label)) {
          field.input.setAttribute('aria-invalid', 'true')
          field.input.setAttribute('aria-errormessage', status.id)
        } else {
          field.input.removeAttribute('aria-invalid')
          field.input.removeAttribute('aria-errormessage')
        }
      }
      const conflict = Boolean(
        session.error.conflict || /CE\d{8}/.test(session.error.message)
      )
      if (resolveControl) resolveControl.hidden = !conflict
      showErrorNotice(session.error, {
        scope: modal,
        key: 'authoring',
        detail: uiMessage('Your edits are still here.'),
        deduplicate: true,
        context: {
          orderId: ref.orderId,
          seller: ref.sellerName,
          code: group.baseCode,
          thumbnail: ref.thumbnail ? () => loadImage(ref.thumbnail) : undefined,
        },
        ...(conflict
          ? {
              action: {
                label: uiMessage('Resolve code'),
                onClick: () => resolveControl?.click(),
              },
            }
          : {}),
      })
    }
    session.notify(session.dirty ? 'Pending changes' : 'Saved')
    const add = (label, value, change, multiline = false) => {
      const control = inlineField(
        label,
        value,
        (value) => {
          editSession(
            session,
            () => change(value),
            `${orderKey(session.draft)}/${group.id}/${label}`
          )
          bindText(status, uiMessage('Pending changes'))
        },
        '',
        multiline
      )
      fields.push({
        label,
        input: control.querySelector('input,textarea'),
        read: () => value,
      })
      control.querySelector('input,textarea').dataset.authoringField = label
        .toLowerCase()
        .replaceAll(' ', '-')
      content.append(control)
      control
        .querySelector('input,textarea')
        .addEventListener('blur', () => history().breakGroup())
    }
    add(
      'Spanish name',
      variant.spanishName ?? group.spanishName ?? '',
      (value) => {
        variant.spanishName = value.toUpperCase()
      },
      true
    )
    add('Chinese category', group.category || '', (value) => {
      group.category = value
    })
    const materialPreparation = refreshPreparationMaterials(
        session.draft,
        recordFor(ref).snapshot
      ),
      materialVariant = materialPreparation.groups
        .find((entry) => entry.id === group.id)
        .variants.find((entry) => entry.id === variant.id)
    const editorMaterial = variantMaterial(materialVariant, ref.entryId)
    add(
      'Material',
      editorMaterial.source === 'manual'
        ? editorMaterial.value
        : translateMaterial(editorMaterial.value, getLanguage()),
      (value) => setVariantMaterial(variant, value, [ref.entryId])
    )
    add('Product code', group.baseCode, (value) => {
      group.baseCode = value.toUpperCase()
    })
    add('Variant ending', variant.variantSuffix, (value) => {
      variant.variantSuffix = value.toUpperCase()
    })
    add('Size ending', variant.sizeSuffix, (value) => {
      variant.sizeSuffix = value.toUpperCase()
      if (value) {
        variant.needsSizeMapping = false
        delete group.sizeMode
      }
    })
    add(
      'Product variant',
      variant.variant || '',
      (value) => {
        variant.variant = value
      },
      true
    )
    for (const input of content.querySelectorAll('input'))
      if (/code|ending/i.test(input.closest('label').textContent))
        decorateCodeInput(input)
    const tools = el('div', undefined, 'product-authoring-tools')
    for (const [title, mode] of [
      ['Automatic sizes', 'automatic'],
      ['No size difference', 'none'],
    ]) {
      const control = button(title, async () => {
        await flushSession(session)
        const candidate = setGroupSizeMode(session.draft, group.id, mode, {
          snapshot: recordFor(ref)?.snapshot,
          sizeVocabulary: preferences.sizeVocabulary,
        })
        const next = candidate.groups.find((entry) => entry.id === group.id)
        const changes = group.variants
          .map((variant) => {
            const changed = next.variants.find(
              (entry) => entry.id === variant.id
            )
            return {
              name: variant.variant || variant.spanishName || group.spanishName,
              before:
                group.baseCode + variant.variantSuffix + variant.sizeSuffix,
              after: next.baseCode + changed.variantSuffix + changed.sizeSuffix,
            }
          })
          .filter((row) => row.before !== row.after)
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
            proceed: uiMessage('Apply size handling'),
            media,
          }))
        )
          return
        editSession(session, () => {
          session.draft = candidate
        })
        await flushSession(session)
        dismissEditor()
        await openEditor(ref)
      })
      control.dataset.sizeMode = mode
      control.setAttribute(
        'aria-pressed',
        String((group.sizeMode || 'automatic') === mode)
      )
      tools.append(control)
    }
    const priceSuggestions = suggestPriceSizeMappings(
      group,
      recordFor(ref)?.snapshot,
      preferences.sizeVocabulary
    )
    if (priceSuggestions.length)
      tools.append(
        button('Review size suggestions', async () => {
          const changes = priceSuggestions.map(
            ({ variantId, sizeSuffix, price }) => {
              const variant = group.variants.find(
                (entry) => entry.id === variantId
              )
              return {
                photo: recordFor(ref)?.snapshot.items.find((item) =>
                  variant.entryIds.includes(item.entryId)
                ),
                name: variant.variant || variant.size,
                before:
                  group.baseCode + variant.variantSuffix + variant.sizeSuffix,
                after: group.baseCode + variant.variantSuffix + sizeSuffix,
                detail: uiMessage(
                  'Unit price ¥{price} · Suggested size {size}',
                  { price, size: sizeSuffix }
                ),
              }
            }
          )
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
          editSession(session, () => {
            for (const suggestion of priceSuggestions) {
              const variant = group.variants.find(
                (entry) => entry.id === suggestion.variantId
              )
              variant.sizeSuffix = suggestion.sizeSuffix
              variant.needsSizeMapping = false
            }
          })
          await flushSession(session)
          dismissEditor()
          await openEditor(ref)
        })
      )
    for (const [title, kind] of [
      ['Barcode', 'barcode'],
      ['Carton mark', 'mark'],
    ])
      tools.append(
        button(title, async () => {
          await flushSession(session)
          dismissEditor()
          await openLabel(ref, kind)
        })
      )
    if (onCartons)
      tools.append(
        button('Edit cartons', async () => {
          await flushSession(session)
          dismissEditor()
          await onCartons(ref)
        })
      )
    if (repository.getRepeatProductCandidates)
      mountRepeatProductControl(tools, {
        source: {
          accountId: session.draft.accountId,
          orderId: session.draft.orderId,
          groupId: group.id,
        },
        linked: Boolean(group.sharedProductId),
        repository,
        media,
        beforeOpen: flushSaves,
        onSaved: async () => {
          await reload()
          await changed({ reload: true })
          dismissEditor()
        },
        onError: (error) => bindText(status, uiMessage(error.message)),
      })
    const resolve = button('Resolve code conflict', async () => {
      const result = await resolveCodeConflict(session.draft, session.error, {
        groupId: group.id,
        variantId: variant.id,
      })
      if (result) {
        dismissEditor()
        await openEditor(ref)
      }
    })
    resolveControl = resolve
    resolve.hidden = true
    tools.append(resolve)
    const recovered = button('Review recovered product edits', async () => {
      if (await reviewRecovered(session)) {
        dismissEditor()
        await openEditor(ref)
      }
    })
    recovered.hidden = true
    tools.append(recovered)
    const finish = async () => {
      try {
        await flushSession(session)
        dismissEditor()
      } catch (error) {
        session.error = error
        session.notify(error.message)
        resolve.hidden = !error.conflict && !/CE\d{8}/.test(error.message)
        recovered.hidden = !session.stale
        content.querySelector('[aria-invalid="true"]')?.focus()
      }
    }
    close.onclick = () => void finish()
    modal.oncancel = (event) => {
      event.preventDefault()
      void finish()
    }
    undo.onclick = () =>
      void travel('undo')
        .then(() => {
          dismissEditor()
          return openEditor(ref)
        })
        .catch((error) => bindText(status, uiMessage(error.message)))
    redo.onclick = () =>
      void travel('redo')
        .then(() => {
          dismissEditor()
          return openEditor(ref)
        })
        .catch((error) => bindText(status, uiMessage(error.message)))
    status.setAttribute('role', 'status')
    modal.append(content, tools, status, mappingStatus, undo, redo, close)
    modal.onclose = removeEditor
    document.body.append(modal)
    modal.showModal()
    if (ref.field) {
      const title = {
        category: 'Chinese category',
        name: 'Spanish name',
        variant: 'Variant ending',
        size: 'Size ending',
        code: 'Product code',
      }[ref.field]
      const target = fields.find((field) => field.label === title)?.input
      target?.focus()
      target?.select()
    }
  }
  async function openLabel(ref, kind = 'barcode') {
    await ensureContext()
    await flushSaves()
    const match = membership.get(entryKey(ref))
    if (!match) throw new Error('Review product codes in Orders first.')
    let prep = structuredClone(match.prep)
    const stack = history(),
      observedAt = recordFor(prep)?.snapshot.observedAt
    const host = $('label-content')
    host.replaceChildren(
      el('h2', uiMessage(kind === 'mark' ? 'Carton mark' : 'Barcode label'))
    )
    const mount = el('div')
    host.append(mount)
    function model() {
      const group = prep.groups.find((entry) => entry.id === match.group.id),
        variant = group.variants.find((entry) => entry.id === match.variant.id)
      return {
        kind,
        code:
          kind === 'mark'
            ? group.baseCode
            : barcodeValue(group, { ...variant, needsSizeMapping: false }),
        baseCode: group.baseCode,
        spanishName: variant.spanishName ?? group.spanishName,
        category: group.category,
        variantSuffix: variant.variantSuffix,
        sizeSuffix: variant.sizeSuffix,
        needsSizeMapping: variant.needsSizeMapping,
      }
    }
    function candidate(next) {
      const draft = structuredClone(prep),
        group = draft.groups.find((entry) => entry.id === match.group.id),
        variant = group.variants.find((entry) => entry.id === match.variant.id)
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
        if (next.sizeSuffix) delete group.sizeMode
        variant.needsSizeMapping = next.needsSizeMapping
        variant.spanishName = next.spanishName.toUpperCase()
      }
      return draft
    }
    editor?.destroy()
    editor = mountLabelEditor(mount, {
      model: model(),
      settings: settings(),
      logoUrl: logoUrl(),
      onValidate: (next) =>
        repository.previewPreparations(
          [candidate(next)],
          amendmentOptions(candidate(next))
        ),
      onResolve: async (error, next) => {
        const result = await resolveCodeConflict(candidate(next), error, {
          groupId: match.group.id,
          variantId: match.variant.id,
        })
        if (!result) return null
        prep = result
        return model()
      },
      onCommit: async (next) => {
        const before = prep
        const [result] = await repository.savePreparations([candidate(next)], {
          ...amendmentOptions(candidate(next)),
          expectedRevisions: [prep.revision],
          expectedSnapshots: [
            { accountId: prep.accountId, orderId: prep.orderId, observedAt },
          ],
        })
        beginLocalHistory(stack, before, observedAt)
        stack.record(
          orderKey(result),
          preparationHistorySnapshot(before),
          preparationHistorySnapshot(result)
        )
        acknowledgeHistory(stack, result, observedAt)
        prep = result
        preparations.set(orderKey(result), result)
        rebuild()
        await changed()
        return model()
      },
      onCopy: async (result) => labelClipboard([result]),
    })
    const dialog = $('label-dialog')
    const closeForm = dialog.querySelector('form[method="dialog"]')
    const closeWithReview = (event) => {
      event.preventDefault()
      // Use the editor's cancel/commit path for Close, just as for backdrop
      // dismissal. A method=dialog submit would destroy a pending blur save.
      dialog.requestClose()
    }
    closeForm?.addEventListener('submit', closeWithReview)
    dialog.addEventListener(
      'close',
      () => {
        closeForm?.removeEventListener('submit', closeWithReview)
        editor?.destroy()
        editor = null
      },
      { once: true }
    )
    dialog.showModal()
  }
  function createCartonMarkRenderer() {
    const frozenSettings = structuredClone(settings()),
      logo = logoUrl()
    return async (source, { signal } = {}) =>
      (
        await renderLabel({
          kind: 'mark',
          code: source.baseCode,
          category: source.chineseCategory,
          settings: frozenSettings,
          logoUrl: logo,
          signal,
        })
      ).blob
  }
  function decorateRow(host, row, capacityHost = host, measurementHosts) {
    const projected = preparedRows([row])[0],
      bar = el('div', undefined, 'row-preparation')
    if (projected.barcode) {
      const copy = copyTextButton(projected.barcode, {
        label: uiMessage('Copy code'),
        className: 'row-code-copy ce-code',
      })
      bar.append(copy)
    } else if (projected.baseCode) {
      const base = copyTextButton(projected.baseCode, {
        label: uiMessage('Product code'),
        className: 'row-base-code ce-code',
      })
      base.dataset.codeKind = 'product'
      bar.append(base)
    }
    if (projected.needsSizeMapping) {
      const warning = el(
        'span',
        uiMessage('Map this variant size before generating labels'),
        'size-mapping-status'
      )
      warning.setAttribute('role', 'status')
      warning.dataset.issueCode = 'SIZE_MAPPING_REQUIRED'
      warning.dataset.entryId = row.entryId
      bar.append(warning)
    }
    if (projected.spanishName)
      bar.append(el('span', projected.spanishName, 'spanish-name'))
    const edit = button('Edit product', () => openEditor(row))
    edit.dataset.action = 'edit-order-product'
    bar.append(edit)
    if (projected.barcode)
      for (const [title, kind] of [
        ['Barcode', 'barcode'],
        ['Carton mark', 'mark'],
      ]) {
        const label = button(title, () => openLabel(row, kind))
        if (kind === 'barcode') label.dataset.action = 'edit-order-barcode'
        else label.dataset.action = 'edit-order-carton-mark'
        bar.append(label)
      }
    const evidence = button('Review purchase evidence', () =>
      openInventoryRecovery(row)
    )
    evidence.dataset.action = 'review-purchase-evidence'
    bar.append(evidence)
    host.append(bar)
    capacityHost.append(button('Reconcile cartons', () => onCartons?.(row)))
    if (measurementHosts)
      for (const cell of Object.values(measurementHosts))
        cell.append(el('span', '—'))
  }
  async function groupProducts(rows) {
    await ensureContext()
    await flushSaves()
    const chosen = new Set(rows.map(entryKey)),
      selected = new Map()
    for (const row of rows) {
      const match = membership.get(entryKey(row))
      if (!match) throw new Error('Review product codes in Orders first.')
      const key = JSON.stringify([orderKey(match.prep), match.group.id])
      let entry = selected.get(key)
      if (!entry) {
        entry = {
          draft: match.prep,
          group: match.group,
          variants: [],
          complete: false,
        }
        selected.set(key, entry)
      }
      if (!entry.variants.some((variant) => variant.id === match.variant.id))
        entry.variants.push(match.variant)
    }
    const entries = [...selected.values()],
      stack = history()
    const baselines = new Map(
        entries.map((entry) => [
          orderKey(entry.draft),
          structuredClone(entry.draft),
        ])
      ),
      groupingContext = {
        ...amendmentOptions(entries[0]?.draft),
        expectedSnapshots: [...baselines.values()].map((draft) => ({
          accountId: draft.accountId,
          orderId: draft.orderId,
          observedAt: recordFor(draft)?.snapshot.observedAt,
        })),
      }
    for (const entry of entries) {
      const source = new Set(
        recordFor(entry.draft)?.snapshot.items.map((item) => item.entryId) || []
      )
      const groupAvailable = entry.group.variants.every((variant) =>
        variant.entryIds.every((entryId) => {
          const owner = membership.get(entryKey({ ...entry.draft, entryId }))
          return (
            source.has(entryId) &&
            owner?.group.id === entry.group.id &&
            owner.variant.id === variant.id
          )
        })
      )
      const selectedVariantsComplete = entry.variants.every((variant) =>
        variant.entryIds.every((entryId) =>
          chosen.has(entryKey({ ...entry.draft, entryId }))
        )
      )
      // Scope completeness and chosen variants are distinct. Partial variants
      // may not move hidden shared source rows; split may select whole variants.
      entry.complete = groupAvailable && selectedVariantsComplete
    }
    const available = groupingAvailability(entries),
      modal = el('dialog', undefined, 'orders-grouping-dialog'),
      status = el('p')
    modal.append(el('h2', uiMessage('Grouping tools')))
    for (const [operation, title] of [
      ['share', 'Share one barcode'],
      ['separate', 'Give rows separate barcodes'],
      ['split', 'Move to new product'],
      ['merge', 'Merge products'],
    ]) {
      const control = button(title, async () => {
        const candidates = await regroupSelection(entries, operation, {
          getReservedBarcodes: (...args) =>
            repository.getReservedBarcodes(...args),
          sizeVocabulary: preferences.sizeVocabulary,
        })
        // Existing guarded preview/save rejects sealed/physical incompatibility;
        // grouping never changes container membership or destroys cartons.
        const preview = await repository.previewPreparations(
          candidates,
          groupingContext
        )
        const prepared = Array.isArray(preview)
          ? preview
          : preview.preparations || candidates
        if (
          !(await reviewPackingChanges({
            title: uiMessage('Review product grouping'),
            explanation: uiMessage(
              'Review every affected source row. Purchase quantities, prices and physical carton evidence stay separate.'
            ),
            changes: groupingReviewChanges(entries, prepared, getRecords()),
            proceed: uiMessage('Apply changes'),
            media,
          }))
        )
          return
        const before = prepared.map((candidate) =>
          baselines.get(orderKey(candidate))
        )
        const results = await repository.savePreparations(prepared, {
          ...groupingContext,
          expectedRevisions: before.map((draft) => draft.revision),
        })
        for (const [index, draft] of before.entries())
          beginLocalHistory(
            stack,
            draft,
            groupingContext.expectedSnapshots[index].observedAt
          )
        stack.recordBatch(
          results.map((result, index) => ({
            orderId: orderKey(result),
            before: preparationHistorySnapshot(before[index]),
            after: preparationHistorySnapshot(result),
          }))
        )
        for (const [index, result] of results.entries()) {
          acknowledgeHistory(
            stack,
            result,
            groupingContext.expectedSnapshots[index].observedAt
          )
          preparations.set(orderKey(result), result)
          sessions.delete(sessionKey(result))
        }
        rebuild()
        await changed()
        modal.close()
      })
      control.disabled = Boolean(available[operation]?.reason)
      if (available[operation]?.reason)
        preparationHelp(control, uiMessage(available[operation].reason))
      modal.append(control)
    }
    const close = button('Close', () => modal.close())
    modal.append(status, close)
    modal.onclose = () => modal.remove()
    document.body.append(modal)
    modal.showModal()
  }
  async function resolveCodeConflict(candidate, error, target = {}) {
    const conflictContext = amendmentOptions(candidate),
      stack = history()
    const code =
      error?.conflict?.code || error?.message?.match(/CE\d{8}[A-Z0-9]*/)?.[0]
    if (!code) throw error
    const ownership = await repository.queryCodeOwnership(code, {
      accountId: candidate.accountId,
    })
    const proposals = new Map([
      [orderKey(candidate), structuredClone(candidate)],
    ])
    for (const owner of ownership.owners || []) {
      const key = orderKey(owner),
        saved = preparations.get(key)
      if (saved && !proposals.has(key))
        proposals.set(key, structuredClone(saved))
    }
    conflictContext.expectedSnapshots = [...proposals.values()].map(
      (draft) => ({
        accountId: draft.accountId,
        orderId: draft.orderId,
        observedAt: recordFor(draft)?.snapshot.observedAt,
      })
    )
    const modal = el(
        'dialog',
        undefined,
        'packing-review code-conflict-dialog'
      ),
      content = el('div', undefined, 'conflict-evidence'),
      status = el('p'),
      actions = el('div', undefined, 'dialog-actions'),
      recovery = el('div', undefined, 'conflict-recovery-actions'),
      applyActions = el('div', undefined, 'conflict-apply-actions'),
      keepSaved = el('button', uiMessage('Keep saved version')),
      cancel = el('button', uiMessage('Cancel')),
      apply = el('button', uiMessage('Apply corrections'), 'primary')
    bindAttribute(modal, 'aria-label', uiMessage('Resolve code conflict'))
    modal.append(
      el('h2', uiMessage('Resolve code conflict')),
      el('p', code, 'ce-code'),
      el(
        'p',
        uiMessage(
          'Review the final codes together. All affected orders save atomically after revision and ownership checks.'
        )
      )
    )
    const requested =
        error.conflict?.requestedOwner || error.packingIssue || target,
      editedGroupId =
        target.groupId ||
        requested.groupId ||
        candidate.groups.find((group) => group.baseCode === code.slice(0, 10))
          ?.id,
      editedVariantId = requested.variantId || target.variantId,
      variantConflict = code.length > 10 && editedVariantId,
      controls = [],
      comparisons = []
    for (const proposal of proposals.values())
      for (const group of proposal.groups) {
        const edited =
          orderKey(proposal) === orderKey(candidate) &&
          group.id === editedGroupId
        if (
          !edited &&
          !(ownership.owners || []).some(
            (owner) =>
              orderKey(owner) === orderKey(proposal) &&
              (owner.currentGroupId || owner.groupId) === group.id
          )
        )
          continue
        const section = el(
            'article',
            undefined,
            `packing-review-item ${edited ? 'conflict-edit-card' : 'conflict-owner-card'}`
          ),
          detail = el('div', undefined, 'conflict-product-details'),
          source = recordFor(proposal),
          item = source?.snapshot.items.find((item) =>
            group.variants.some((variant) =>
              variant.entryIds.includes(item.entryId)
            )
          )
        if (item) section.append(media.photo(item))
        detail.append(
          el('strong', group.spanishName || group.title || proposal.orderId),
          el(
            'small',
            `${source?.snapshot.sellerName || ''} · ${proposal.orderId}`
          )
        )
        const add = (label, value, change, key, read) => {
          const field = inlineField(label, value, change),
            input = field.querySelector('input')
          input.dataset.codePart = key
          decorateCodeInput(input)
          input.addEventListener('input', () => {
            if (!input.isComposing) refreshComparisons()
          })
          input.addEventListener('compositionend', refreshComparisons)
          detail.append(field)
          controls.push({ input, read })
        }
        add(
          'Product code',
          group.baseCode,
          (value) => {
            group.baseCode = value.toUpperCase()
          },
          'baseCode',
          () => group.baseCode
        )
        for (const variant of group.variants) {
          add(
            'Variant ending',
            variant.variantSuffix,
            (value) => {
              variant.variantSuffix = value.toUpperCase()
            },
            'variantSuffix',
            () => variant.variantSuffix
          )
          add(
            'Size ending',
            variant.sizeSuffix,
            (value) => {
              variant.sizeSuffix = value.toUpperCase()
            },
            'sizeSuffix',
            () => variant.sizeSuffix
          )
        }
        const savedGroup = preparations
            .get(orderKey(proposal))
            ?.groups.find((entry) => entry.id === group.id),
          impact = el('div', undefined, 'conflict-code-impact')
        comparisons.push({ group, savedGroup, impact })
        section.append(detail, impact)
        content.append(section)
      }
    function refreshComparisons() {
      for (const { group, savedGroup, impact } of comparisons) {
        impact.replaceChildren(
          packingValueComparison([
            {
              label: 'Product code',
              kind: 'code',
              before: savedGroup?.baseCode,
              after: group.baseCode,
            },
            ...group.variants.map((variant) => ({
              label: 'Barcode',
              context: variant.variant || variant.size,
              kind: 'code',
              before: savedGroup?.variants.find(
                (entry) => entry.id === variant.id
              )
                ? barcodeValue(
                    savedGroup,
                    savedGroup.variants.find((entry) => entry.id === variant.id)
                  )
                : '',
              after: barcodeValue(group, variant),
            })),
          ])
        )
      }
    }
    refreshComparisons()
    const next = button(
      variantConflict
        ? 'Use next available variant code'
        : 'Use next available code',
      async () => {
        const elements = [...modal.querySelectorAll('input,button')]
        elements.forEach((control) => {
          control.disabled = true
        })
        try {
          const draft = proposals.get(orderKey(candidate)),
            group = draft.groups.find((group) => group.id === editedGroupId)
          if (variantConflict) {
            const variant = group.variants.find(
                (variant) => variant.id === editedVariantId
              ),
              used = new Set(
                group.variants
                  .filter((entry) => entry.id !== variant.id)
                  .map((entry) => entry.variantSuffix + entry.sizeSuffix)
              )
            for (const value of await repository.getReservedBarcodes(
              group.baseCode,
              { accountId: candidate.accountId }
            ))
              used.add(value.slice(group.baseCode.length))
            variant.variantSuffix = unusedSuffix(
              used,
              variant.sizeSuffix,
              preferences.sizeVocabulary
            )
          } else {
            const [preview] = await repository.previewPreparations(
              [regeneratePreparationCode(draft, group.id)],
              {
                preserveNaming: true,
                ...conflictContext,
                suffixBaselines: [preparations.get(orderKey(draft))],
              }
            )
            const proposed = preview.groups.find(
              (entry) => entry.id === group.id
            )
            group.baseCode = proposed.baseCode
          }
          for (const control of controls) {
            control.input.value = control.read()
            refreshCodeInput(control.input)
          }
          refreshComparisons()
          bindText(
            status,
            uiMessage(
              'A free code is proposed below. Review the changes and choose Apply corrections.'
            )
          )
        } finally {
          elements.forEach((control) => {
            control.disabled = false
          })
        }
      }
    )
    recovery.append(next, keepSaved)
    preparationHelp(keepSaved, uiMessage('Reload saved version'))
    status.setAttribute('role', 'status')
    cancel.onclick = () => modal.close()
    let result = null
    keepSaved.onclick = () => {
      const saved = preparations.get(orderKey(candidate)),
        session = sessions.get(sessionKey(candidate))
      if (!saved) return
      if (session) {
        clearTimeout(session.timer)
        session.draft = structuredClone(saved)
        session.saved = structuredClone(saved)
        session.amendmentContext = structuredClone(saved.amendmentContext)
        session.dirty = session.stale = false
        session.error = null
        localStorage.removeItem(recoveryKey(saved, session.contextContainerId))
      }
      result = saved
      modal.close('saved')
    }
    apply.onclick = () =>
      void (async () => {
        const controls = [...modal.querySelectorAll('input,button')]
        controls.forEach((control) => {
          control.disabled = true
        })
        try {
          const values = [...proposals.values()]
          await repository.previewPreparations(values, conflictContext)
          const before = values.map((value) =>
            preparations.get(orderKey(value))
          )
          const results = await repository.savePreparations(values, {
            ...conflictContext,
            expectedRevisions: values.map((value) => value.revision),
          })
          for (const [index, draft] of before.entries())
            beginLocalHistory(
              stack,
              draft,
              conflictContext.expectedSnapshots[index].observedAt
            )
          stack.recordBatch(
            results.map((value, index) => ({
              orderId: orderKey(value),
              before: preparationHistorySnapshot(before[index]),
              after: preparationHistorySnapshot(value),
            }))
          )
          for (const [index, value] of results.entries()) {
            acknowledgeHistory(
              stack,
              value,
              conflictContext.expectedSnapshots[index].observedAt
            )
            preparations.set(orderKey(value), value)
            const session = sessions.get(sessionKey(value))
            if (session) {
              session.saved = structuredClone(value)
              acknowledgePreparation(
                session.draft,
                proposals.get(orderKey(value)),
                value
              )
              session.dirty = false
              session.error = null
              try {
                localStorage.removeItem(recoveryKey(value))
              } catch {}
            }
          }
          rebuild()
          await changed()
          result = results.find(
            (value) => orderKey(value) === orderKey(candidate)
          )
          modal.close('saved')
        } catch (failure) {
          bindText(status, uiMessage(failure.message))
        } finally {
          controls.forEach((control) => {
            control.disabled = false
          })
        }
      })()
    modal.oncancel = (event) => {
      if (apply.disabled) event.preventDefault()
    }
    applyActions.append(cancel, apply)
    actions.append(recovery, applyActions)
    modal.append(content, status, actions)
    document.body.append(modal)
    modal.showModal()
    return new Promise((resolve) =>
      modal.addEventListener(
        'close',
        () => {
          modal.remove()
          resolve(result)
        },
        { once: true }
      )
    )
  }
  await reload()
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
      ['appearance', 'Appearance', 'sun'],
      ['labels', 'Labels', 'barcode'],
      ['names', 'Product names', 'text'],
      ['sizes', 'Size codes', 'packing'],
      ['colors', 'Product colors', 'image'],
      ['materials', 'Materials', 'packing'],
      ['tags', 'Tags', 'tag'],
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
    const nameRules = mountProductVocabulary(names, value)
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
    settingsDialog.addEventListener(
      'close',
      () => {
        for (const rules of [nameRules, sizeRules, colorRules, materialRules])
          rules.destroy()
      },
      { once: true }
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
              sizeRules.revealError()?.focus()
              throw error
            }
            try {
              value.colorVocabulary = colorRules.validate()
            } catch (error) {
              selectTab('settings-panel-colors')
              colorRules.revealError()?.focus()
              throw error
            }
            value.appearance = appearance.validate()
            try {
              value.materialVocabulary = materialRules.validate()
            } catch (error) {
              selectTab('settings-panel-materials')
              materialRules.revealError()?.focus()
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
    selectTab('settings-panel-appearance')
    dialog(settingsDialog)
  }

  channel?.addEventListener(
    'message',
    () =>
      void changed({ reload: true }).catch((error) =>
        feedback(error.message, true)
      )
  )
  $('packing-settings').onclick = () =>
    void openSettings().catch((error) => feedback(error.message, true))
  return {
    reload,
    preparedRows,
    project: preparedRows,
    openEditor,
    openInventoryRecovery,
    reviewCodes,
    groupProducts,
    flush: flushSaves,
    photoContext,
    decorateRow,
    openLabel,
    settings,
    logoUrl,
    getPreferences: () => preferences,
    createCartonMarkRenderer,
    getImageBadges: () => createExcelImageBadges(preferences),
    sizeClassifier: () => createSizeClassifier(preferences.sizeVocabulary),
    refreshPhoto: (item, thumbnail) => media.updatePhoto(item, thumbnail),
    updateActions() {},
    orderRows: (rows) => [...rows],
    canCopyLabels(rows) {
      const eligible = labelRows(rows)
      // A base identity permits an actionable request; the output controller
      // validates variant mappings and artwork before copying or printing.
      return (
        eligible.length > 0 &&
        preparedRows(eligible).every((row) => Boolean(row.baseCode))
      )
    },
    labelRows,
    rowsForRefs(refs) {
      const rows = [],
        seen = new Set()
      for (const ref of refs) {
        const record = recordFor(ref),
          prep = preparations.get(orderKey(ref)),
          group = prep?.groups.find((group) => group.id === ref.groupId)
        const ids = new Set(
          ref.entryIds ||
            group?.variants
              .filter(
                (variant) => !ref.variantId || variant.id === ref.variantId
              )
              .flatMap((variant) => variant.entryIds) ||
            []
        )
        for (const item of record?.snapshot.items || [])
          if (ids.has(item.entryId)) {
            const row = {
                ...item,
                accountId: record.accountId || 'local',
                orderId: record.snapshot.orderId,
                sellerName: record.snapshot.sellerName,
                record,
              },
              key = entryKey(row)
            if (!seen.has(key)) {
              seen.add(key)
              rows.push(row)
            }
          }
      }
      return rows
    },
    searchText(orderId, entryId, accountId = 'local') {
      const record = recordFor({ orderId, accountId }),
        item = record?.snapshot.items.find((item) => item.entryId === entryId)
      if (!item) return ''
      const row = preparedRows([{ ...item, orderId, accountId, record }])[0]
      return [
        row.barcode,
        row.spanishName,
        row.chineseCategory,
        row.material,
        translateMaterial(row.material, getLanguage()),
      ]
        .filter(Boolean)
        .join(' ')
    },
    orderNames(orderId, accountId = 'local') {
      const record = recordFor({ orderId, accountId })
      return [
        ...new Set(
          preparedRows(
            (record?.snapshot.items || []).map((row) => ({
              ...row,
              orderId,
              accountId,
              record,
            }))
          )
            .map((row) => row.spanishName)
            .filter(Boolean)
        ),
      ]
    },
    cartonDetailsOptions(row) {
      return {
        summary: () =>
          uiMessage('Inspect and reconcile physical cartons in Orders.'),
        openBatches: () => onCartons?.(row),
      }
    },
    status: () => ({
      dirty: [...sessions.values()].some((entry) => entry.dirty),
      errors: [...sessions.values()]
        .map((entry) => entry.error)
        .filter(Boolean),
    }),
    undo: () => travel('undo'),
    redo: () => travel('redo'),
    dispose() {
      generation++
      for (const session of sessions.values()) clearTimeout(session.timer)
      editor?.destroy()
      media.destroy()
      channel?.close()
    },
  }
}
