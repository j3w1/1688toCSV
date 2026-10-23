import {
  element as el,
  copied,
  pinDialogActions,
  yieldUI,
  resetCopyFeedback,
} from './ui.js'
import {
  message as m,
  bindAttribute,
  bindText,
  getLanguage,
  t,
} from './i18n.js'
import { DEFAULT_LABEL_SETTINGS, renderLabel } from './labels.js'
import { openImageCopyDialog, imageBatchPlans } from './image-copy-dialog.js'
import {
  labelClipboard,
  preparationCopyFields,
  preparationTable,
  preparationFeatureFields,
  writeTable,
  preparationOrderFields,
} from './preparation-clipboard.js'
import { createPreparationColumnPicker } from './preparation-column-picker.js'
import { createSizeClassifier } from './size-vocabulary.js'
import { popupLanguageToggle } from './popup-language-toggle.js'
import { openPrintDialog, openRecentPrintJobs } from './print-dialog.js'
import {
  restoreJob,
  assertContainerPrintRef,
  makeOrderCartonPrintRef,
  assertOrderCartonPrintRef,
} from './print-store.js'
import { physicalUnits } from './inventory-model.js'
import { physicalMarkReadback } from './physical-mark-aliases.js'
import { copyExcelImage } from './excel-image-copy.js'
import { createExcelImageBadges } from './excel-image-badges.js'
import { resolveOperations } from './operations-workflow.js'
import { copySourceImages } from './source-image-copy.js'
import { copyTable } from './clipboard.js'
import { openPackingExportDialog } from './packing-export-dialog.js'
import { createPackingWorkbookImages } from './packing-workbook-images.js'
import { saveFile, announceExport, uniqueFileName } from './save-file.js'

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    for (const child of Object.values(value)) freeze(child)
  }
  return value
}

/** Reject incomplete contexts; a filter/selection is never manifest membership. */
export function captureContainerOutput(manifest) {
  const revision = manifest?.revision ?? manifest?.container?.revision,
    identifiedDraft =
      manifest?.draft === true && Number.isSafeInteger(revision) && revision > 0
  if (
    !manifest?.container?.id ||
    (manifest.draft === true && manifest.revisionId !== null) ||
    (!manifest.revisionId && !identifiedDraft) ||
    !Array.isArray(manifest.products) ||
    !Array.isArray(manifest.cartons) ||
    !Array.isArray(manifest.leftBehind?.products) ||
    !Array.isArray(manifest.leftBehind?.cartons)
  )
    throw new Error(
      'The complete container revision is unavailable. Reload it before exporting.'
    )
  return freeze(
    structuredClone({
      ...manifest,
      revision,
      kind: 'container-revision',
      containerId: manifest.container.id,
    })
  )
}

export function captureOrdersOutput(products, preferences = {}) {
  return freeze(
    structuredClone({
      kind: 'orders-selection',
      products,
      preferences,
      partial: true,
    })
  )
}

export function outputLabelModels(context, kind = 'barcode') {
  const models = new Map()
  for (const row of context.products) {
    const code = kind === 'mark' ? row.markCode || row.baseCode : row.barcode
    const category = row.chineseCategory || row.category || row.mark?.category
    const refuse = (message, field) => {
      throw Object.assign(new Error(message), {
        packingIssue: {
          accountId: row.accountId || 'local',
          orderId: row.orderId,
          entryId: row.entryId,
          groupId: row.groupId,
          variantId: row.variantId,
          field,
        },
      })
    }
    if (kind === 'barcode' && row.needsSizeMapping)
      refuse('Map this variant size before generating labels', 'size')
    if (!code) refuse('Review product codes in Orders first.', 'code')
    if (kind === 'mark' && !category?.trim())
      refuse(
        'Add a Chinese category in Orders before generating this carton mark.',
        'category'
      )
    if (kind !== 'mark' && !row.spanishName?.trim())
      refuse(
        'Add a Spanish name in Orders before generating this barcode.',
        'name'
      )
    const existing = models.get(code)
    const quantity =
      kind === 'mark' ? (row.cartonId ? '1' : null) : row.quantity
    const source = {
      orderId: row.orderId,
      accountId: row.accountId || 'local',
      seller: row.sellerName || '',
      ...(row.source === 'other'
        ? { source: 'other', reference: row.reference ?? row.orderReference }
        : {}),
    }
    if (
      context.kind === 'order-carton-mark' &&
      row.printRef?.scope !== 'order-carton-mark'
    )
      throw new Error(
        'The captured carton mark changed. Review the current order before printing again.'
      )
    const ref =
      context.kind === 'order-carton-mark'
        ? structuredClone(row.printRef)
        : {
            accountId: source.accountId,
            orderId: row.orderId,
            groupId: row.groupId || row.group?.id,
            variantId: row.variantId || row.variant?.id,
            entryIds: row.entryId ? [row.entryId] : [],
            ...(row.cartonId ? { cartonId: row.cartonId } : {}),
            ...(context.kind === 'container-revision'
              ? {
                  containerId: context.containerId,
                  revisionId: context.revisionId,
                  ...(context.draft
                    ? { draft: true, draftRevision: context.revision }
                    : {}),
                }
              : {}),
          }
    if (existing) {
      if (quantity == null || existing.quantity === '') existing.quantity = ''
      else
        existing.quantity = (
          BigInt(existing.quantity) + BigInt(quantity)
        ).toString()
      existing.refs.push(ref)
      if (
        !existing.orders.some(
          (order) =>
            order.accountId === source.accountId &&
            order.orderId === source.orderId
        )
      )
        existing.orders.push(source)
      continue
    }
    const model = {
      kind,
      code,
      baseCode: row.baseCode,
      spanishName: row.spanishName,
      category,
      variantSuffix: row.variantSuffix,
      sizeSuffix: row.sizeSuffix,
    }
    models.set(code, {
      key: code,
      code,
      name: row.spanishName || '',
      detail: row.chineseCategory || '',
      quantity:
        quantity ??
        (kind === 'mark' && context.kind === 'orders-selection' ? '1' : ''),
      known: null,
      model,
      ref,
      refs: [ref],
      orders: [source],
    })
  }
  if (kind === 'mark' && context.kind === 'order-carton-mark') {
    for (const item of models.values()) {
      const units = new Map(
        item.refs.map((ref) => [JSON.stringify([ref.batchId, ref.index]), ref])
      )
      item.quantity = String(units.size)
      item.known = units.size
      item.cartonPacking = {
        exact: true,
        total: units.size,
        requiresReview: false,
        rows: [...units.values()].map((ref) => ({
          batchId: ref.batchId,
          index: ref.index,
          explicit: true,
          fullCartons: 1,
          status: 'exact',
        })),
      }
    }
  }
  if (kind === 'mark' && context.kind === 'container-revision') {
    // A physical mark is counted once even when several product rows participate.
    for (const item of models.values()) {
      const ids = new Set(item.refs.map((ref) => ref.cartonId).filter(Boolean))
      const cartons = context.cartons.filter((carton) =>
        ids.size
          ? ids.has(carton.id || carton.cartonId)
          : carton.markCode === item.code || carton.baseCode === item.code
      )
      item.quantity = ids.size
        ? String(ids.size)
        : cartons.length
          ? cartons.length
          : ''
      item.known = ids.size || (cartons.length ? cartons.length : null)
      item.cartonPacking = {
        exact: cartons.length > 0,
        total: cartons.length,
        requiresReview: cartons.length === 0,
        rows: cartons.map((carton) => ({
          batchId: carton.id,
          explicit: true,
          fullCartons: 1,
          status: 'exact',
        })),
      }
    }
  }
  return [...models.values()]
}

/** Reuses the proven clipboard/PDF dialogs with an explicit frozen source. */
export function createProductOutput({
  repository,
  authoring,
  loadImage,
  headers = () => true,
  setHeaders = () => {},
  feedback = () => {},
  workbookAdapter,
  editInOrders = (ref) => authoring.openEditor(ref),
}) {
  function labelFailure(error, context, ref) {
    if (error.name === 'AbortError') return error
    const issue = error.packingIssue || { ...ref, field: error.labelField },
      row = context.products.find(
        (row) =>
          (row.accountId || 'local') === (issue.accountId || 'local') &&
          row.orderId === issue.orderId &&
          (issue.entryId
            ? row.entryId === issue.entryId
            : issue.entryIds?.includes(row.entryId))
      )
    error.packingIssue = { ...issue, entryId: issue.entryId || row?.entryId }
    error.noticeOptions = {
      ...error.noticeOptions,
      context: {
        seller: row?.sellerName || row?.record?.snapshot.sellerName,
        orderId: issue.orderId,
        code: row?.barcode || row?.baseCode,
        variant: row?.variant || row?.description,
        thumbnail: row?.thumbnail ? () => loadImage(row.thumbnail) : undefined,
      },
      action: {
        label: m('Edit in Orders'),
        onClick: () => {
          for (const dialog of document.querySelectorAll(
            'dialog.image-copy-dialog[open],dialog.print-dialog[open]'
          ))
            dialog.close()
          return editInOrders(
            error.packingIssue,
            context.kind === 'container-revision'
              ? {
                  containerId: context.containerId,
                  revisionId: context.revisionId,
                  view:
                    context.outputSide === 'left-behind'
                      ? 'left-behind'
                      : 'packing-list',
                }
              : undefined
          )
        },
      },
    }
    return error
  }
  function labelModels(context, kind) {
    try {
      return outputLabelModels(context, kind)
    } catch (error) {
      throw labelFailure(error, context)
    }
  }
  async function renderOutputLabel(context, item, options) {
    try {
      return await renderLabel({ ...item.model, ...options })
    } catch (error) {
      throw labelFailure(error, context, item.ref)
    }
  }
  function settings(context) {
    const prefs =
      context.preferences ||
      context.media?.preferences ||
      context.labelPreferences
    if (context.kind === 'container-revision' && !prefs)
      throw new Error(
        'The revision label settings are unavailable. Reload its historical media.'
      )
    return {
      ...DEFAULT_LABEL_SETTINGS,
      ...prefs?.settings,
      barcode: {
        ...DEFAULT_LABEL_SETTINGS.barcode,
        ...prefs?.settings?.barcode,
      },
      mark: { ...DEFAULT_LABEL_SETTINGS.mark, ...prefs?.settings?.mark },
    }
  }
  const logo = (context) =>
    context.preferences?.logoDataUrl ||
    context.media?.preferences?.logoDataUrl ||
    context.labelPreferences?.logoDataUrl ||
    new URL('assets/casa-elida.png', location.href).href
  function annotateDialog(context, dialog) {
    if (context.kind === 'order-carton-mark' && dialog) {
      const note = el('div', undefined, 'container-output-context')
      note.append(
        el(
          'p',
          m(
            context.markRole === 'recorded'
              ? 'Recorded physical mark'
              : 'Current product code'
          )
        ),
        el('p', `${m('Carton reference')}: ${context.batchId}`)
      )
      if (context.amendmentContext && context.markRole === 'current-product')
        note.append(
          el(
            'p',
            m(
              'Proposed amendment artwork — printing does not confirm physical relabeling.'
            )
          )
        )
      if (context.productGroupId)
        note.append(
          el(
            'p',
            m(
              'Existing product artwork for a proposed carton relation — printing does not confirm physical relabeling.'
            )
          )
        )
      dialog.querySelector('h2')?.after(note)
      return
    }
    if (context.kind !== 'container-revision' || !dialog) return
    const note = el('div', undefined, 'container-output-context')
    const identity = el('p')
    bindText(
      identity,
      () =>
        `${context.container.name} · ${context.draft ? `${m('DRAFT — unsealed container')} · ${context.revision}` : context.revisionId}`
    )
    note.append(
      identity,
      ...(context.outputSide === 'left-behind' ? [el('p', m('Se quedó'))] : []),
      el(
        'p',
        m(
          context.partial
            ? 'Partial selection — this is not the complete container manifest.'
            : 'Complete container revision'
        )
      )
    )
    dialog.querySelector('h2')?.after(note)
  }
  function openContextDialog(context, open) {
    const before = new Set(document.querySelectorAll('dialog')),
      result = open()
    annotateDialog(
      context,
      [...document.querySelectorAll('dialog')].find(
        (dialog) => !before.has(dialog)
      )
    )
    return result
  }
  async function ordersContext(rows, { labels = false } = {}) {
    // Capture references before a delayed authoring flush; selection may change.
    const captured = structuredClone(rows)
    await authoring.flush()
    return captureOrdersOutput(
      authoring.preparedRows(labels ? authoring.labelRows(captured) : captured),
      authoring.getPreferences()
    )
  }
  async function containerContext(ref) {
    const captured = captureContainerOutput(
      await repository.getContainerManifest({
        id: ref.containerId || ref.id,
        revisionId: ref.revisionId,
      })
    )
    if (ref.orderId && (ref.draft !== undefined || ref.revisionId != null))
      assertContainerPrintRef(ref, captured)
    else if (
      captured.containerId !== (ref.containerId || ref.id) ||
      (ref.revisionId != null && captured.revisionId !== ref.revisionId) ||
      (ref.draft === true &&
        (!captured.draft || captured.revision !== ref.draftRevision))
    )
      throw new Error(
        'The container changed before output was captured. Review the current revision and try again.'
      )
    return captured
  }
  async function orderCartonContext(ref) {
    await authoring.flush()
    const source = {
        accountId: ref.accountId || 'local',
        orderId: ref.orderId,
        ...(ref.contextContainerId
          ? { contextContainerId: ref.contextContainerId }
          : {}),
      },
      context = await repository.getOrderReconciliation(source),
      batch = context.batches.find((batch) => batch.id === ref.batchId),
      role = ref.markRole || ref.role || 'recorded'
    if (ref.scope === 'order-carton-mark')
      await assertOrderCartonPrintRef(ref, context)
    if (!batch || batch.deletedAt)
      throw new Error('This edit session is no longer available.')
    const readback = physicalMarkReadback(
        batch,
        context.preparation ? [context.preparation] : []
      ),
      owner = context.preparation?.groups.find(
        (group) =>
          group.id ===
          (ref.productGroupId || (batch.mark || batch.groups?.[0])?.groupId)
      ),
      currentArtwork =
        (!ref.productGroupId && readback.currentProductArtwork) ||
        (owner && {
          title: owner.title,
          spanishName: owner.spanishName,
          category: owner.category,
          groupId: owner.id,
        }),
      artwork =
        role === 'recorded' && batch.physicalMark
          ? readback.recordedArtwork || batch.physicalMark.artwork
          : currentArtwork,
      units = physicalUnits(batch)
    if (!artwork || !units.length)
      throw new Error(
        'Review the recorded carton mark evidence in Orders before printing.'
      )
    const item = context.record.snapshot.items.find((item) =>
        batch.contents.some((part) => part.entryId === item.entryId)
      ),
      row = {
        ...item,
        ...source,
        record: context.record,
        sellerName: context.record.snapshot.sellerName,
        ...preparationOrderFields({ ...item, ...source }, context.record),
      },
      products = []
    for (const unit of units) {
      const printRef = await makeOrderCartonPrintRef(context, {
        batchId: batch.id,
        role,
        index: unit.index,
        ...(ref.productGroupId ? { productGroupId: ref.productGroupId } : {}),
      })
      products.push({
        ...row,
        groupId: artwork.groupId || owner?.id,
        baseCode: printRef.currentProductCode,
        markCode: printRef.code,
        spanishName: artwork.spanishName || '',
        chineseCategory: artwork.chineseCategory || artwork.category || '',
        cartonId: unit.id,
        printRef,
      })
    }
    const result = freeze(
      structuredClone({
        kind: 'order-carton-mark',
        ...source,
        batchId: batch.id,
        batchRevision: batch.revision,
        markRole: role,
        ...(ref.productGroupId ? { productGroupId: ref.productGroupId } : {}),
        amendmentContext:
          context.amendmentContext || context.revisions?.amendmentContext,
        preferences: await repository.getPackingPreferences(),
        products,
        cartons: units,
      })
    )
    await validateOrderCartonSource(result)
    return result
  }
  async function validateOrderCartonSource(context) {
    if (context.kind !== 'order-carton-mark') return
    const fresh = await repository.getOrderReconciliation({
      accountId: context.accountId,
      orderId: context.orderId,
      ...(context.contextContainerId
        ? { contextContainerId: context.contextContainerId }
        : {}),
    })
    for (const row of context.products)
      await assertOrderCartonPrintRef(row.printRef, fresh)
  }
  async function copyLabels(kind, source) {
    const context = Array.isArray(source)
      ? await ordersContext(source, { labels: true })
      : source
    const printContext =
      context.kind === 'container-revision' && workbookAdapter?.printRows
        ? { ...context, products: workbookAdapter.printRows(context, { kind }) }
        : context
    const items = labelModels(printContext, kind),
      frozenSettings = settings(context),
      frozenLogo = logo(context)
    if (!items.length) throw new Error('No active labels to copy.')
    const geometry = frozenSettings[kind],
      bytes =
        Math.ceil((geometry.widthMm * frozenSettings.dpi) / 25.4) *
        Math.ceil((geometry.heightMm * frozenSettings.dpi) / 25.4) *
        4
    return openContextDialog(context, () =>
      openImageCopyDialog({
        title: 'Prepare label images',
        count: items.length,
        plan: () =>
          imageBatchPlans(
            items.length,
            Math.max(
              1,
              Math.min(
                Math.floor((64 * 1024 * 1024) / bytes),
                kind === 'mark' ? 4 : 20
              )
            )
          ),
        async prepare({ start, end }, { signal, onProgress }) {
          const results = [],
            images = []
          for (const [index, item] of items.slice(start, end).entries()) {
            signal.throwIfAborted()
            onProgress(
              m('Preparing {0} of {1}', { 0: index + 1, 1: end - start })
            )
            const result = await renderOutputLabel(printContext, item, {
              settings: frozenSettings,
              logoUrl: frozenLogo,
              signal,
            })
            results.push(result)
            images.push({
              blob: result.blob,
              label: item.code,
              codeLabel: true,
            })
            await yieldUI()
          }
          return { images, payload: results }
        },
        write: labelClipboard,
        writeImage: (_image, index, results) =>
          labelClipboard([results[index]]),
      })
    )
  }
  async function printLabels(kind, source) {
    const context = Array.isArray(source)
      ? await ordersContext(source, { labels: true })
      : source
    if (context.kind === 'order-carton-mark')
      await validateOrderCartonSource(context)
    const printContext =
      context.kind === 'container-revision' && workbookAdapter?.printRows
        ? { ...context, products: workbookAdapter.printRows(context, { kind }) }
        : context
    const items = labelModels(printContext, kind)
    for (const item of items) {
      if (
        item.quantity !== '' &&
        (!/^\d+$/.test(String(item.quantity)) ||
          BigInt(item.quantity) > BigInt(Number.MAX_SAFE_INTEGER))
      )
        throw new Error(
          'This label quantity exceeds the supported print range.'
        )
      if (item.quantity !== '') item.quantity = Number(item.quantity)
      // Validate artwork with the actual renderer before the print dialog takes
      // over errors; the failing source retains its Orders recovery route.
      await renderOutputLabel(printContext, item, {
        settings: settings(context),
        logoUrl: logo(context),
      })
    }
    if (!items.length) throw new Error('No active labels to copy.')
    if (context.kind === 'order-carton-mark')
      await validateOrderCartonSource(context)
    const dialog = openPrintDialog({
      kind: kind === 'mark' ? 'marks' : 'labels',
      items,
      problems: [],
      settings: settings(context),
      logoUrl: logo(context),
      ...(context.kind === 'order-carton-mark'
        ? { validateSource: () => validateOrderCartonSource(context) }
        : {}),
    })
    annotateDialog(context, dialog)
    return dialog
  }
  async function copyPreparation(source) {
    const context = Array.isArray(source) ? await ordersContext(source) : source
    const rows = context.products.map((row) =>
      preparationCopyFields(
        row,
        createSizeClassifier(context.preferences?.sizeVocabulary)
      )
    )
    const featureSources = context.products.map((row) =>
      structuredClone(
        row.features ||
          resolveOperations(row.record || {}, row.entryId).effective.features
      )
    )
    const modal = el(
        'dialog',
        undefined,
        'packing-column-dialog preparation-column-dialog'
      ),
      actions = el('div', undefined, 'dialog-actions')
    modal.append(
      el(
        'h2',
        m(
          context.partial
            ? 'Copy selected product rows'
            : 'Copy container product rows'
        )
      )
    )
    bindAttribute(
      modal,
      'aria-label',
      m(
        context.partial
          ? 'Copy selected product rows'
          : 'Copy container product rows'
      )
    )
    const copy = el('button', m('Copy chosen columns'), 'primary'),
      close = el('button', m('Close')),
      headerLabel = el('label', m('Headers'), 'check'),
      header = el('input')
    let version = 0,
      copying = false
    header.type = 'checkbox'
    header.checked = headers()
    bindAttribute(header, 'aria-label', m('Headers'))
    headerLabel.prepend(header)
    modal.append(headerLabel)
    modal.append(
      el(
        'p',
        m('Copy {0} product rows', { 0: context.products.length }),
        'copy-row-count'
      )
    )
    const changed = () => {
      version++
      if (!copying) resetCopyFeedback(copy)
      copy.disabled = copying || !fields.selected().length
    }
    header.onchange = () => {
      setHeaders(header.checked)
      changed()
    }
    const fields = createPreparationColumnPicker(modal, changed)
    copy.disabled = !fields.selected().length
    copy.onclick = () =>
      void (async () => {
        if (copying) return
        copying = true
        header.disabled = true
        const capturedVersion = version
        const translate = (source, params) =>
          t(source, params, getLanguage(modal))
        try {
          await copied(copy, async () => {
            if (
              fields.selected().includes('barcode') &&
              context.products.some((row) => row.needsSizeMapping)
            )
              throw new Error(
                translate('Map this variant size before generating labels')
              )
            const table = preparationTable(
              rows.map((row, index) => ({
                ...row,
                ...preparationFeatureFields(featureSources[index], translate),
              })),
              fields.selected(),
              header.checked,
              translate
            )
            await writeTable(table)
            return capturedVersion === version
          })
        } finally {
          copying = false
          header.disabled = false
          copy.disabled = !fields.selected().length
        }
      })()
    close.onclick = () => modal.close()
    actions.append(
      popupLanguageToggle(modal, { onChange: changed }),
      close,
      copy
    )
    modal.append(actions)
    pinDialogActions(modal, actions)
    modal.onclose = () => {
      fields.destroy()
      modal.remove()
    }
    document.body.append(modal)
    annotateDialog(context, modal)
    modal.showModal()
  }
  async function copy(context, format) {
    if (format === 'values')
      return copyTable(context.products, { headers: headers() })
    if (format === 'columns') return copyPreparation(context)
    if (format === 'excel-image')
      return openContextDialog(context, () =>
        copyExcelImage(context.products, {
          sizeClassifier: createSizeClassifier(
            context.preferences?.sizeVocabulary
          ),
          loadImage,
          renderCartonMark: async (row, { signal } = {}) =>
            (
              await renderLabel({
                kind: 'mark',
                code: row.baseCode,
                category: row.chineseCategory || row.category,
                settings: settings(context),
                logoUrl: logo(context),
                signal,
              })
            ).blob,
          headers: headers(),
          badges: createExcelImageBadges(context.preferences || {}),
          errorOptions: (error) => labelFailure(error, context).noticeOptions,
        })
      )
    return copySourceImages(context.products, {
      imagesOnly: format === 'images',
      headers: headers(),
      loadImage,
    })
  }
  async function openWorkbook(ref) {
    const context =
      ref.kind === 'container-revision' ? ref : await containerContext(ref)
    if (!workbookAdapter)
      throw new Error(
        'The container workbook adapter is unavailable. Keep this revision and retry after updating.'
      )
    const suggestedFile = workbookAdapter.fileName?.(context)
    return openPackingExportDialog({
      context,
      getRows: () => context.products,
      getCartonBatches: () => context.cartons,
      hasSelection: false,
      planWorkbook: (rows, options) => workbookAdapter.plan(context, options),
      loadImage,
      renderCartonMark: async (row, { signal } = {}) =>
        (
          await renderLabel({
            kind: 'mark',
            code: row.baseCode,
            category: row.chineseCategory || row.category,
            settings: settings(context),
            logoUrl: logo(context),
            signal,
          })
        ).blob,
      async onExport(_rows, options) {
        const summaryNeeded = options.includeAutomationJson === true
        if (summaryNeeded && !workbookAdapter.summary)
          throw new Error('The detailed revision summary is unavailable.')
        const result = await workbookAdapter.create(context, {
          ...options,
          prepareImages: createPackingWorkbookImages(
            loadImage,
            async (row) =>
              (
                await renderLabel({
                  kind: 'mark',
                  code: row.baseCode,
                  category: row.chineseCategory || row.category,
                  settings: settings(context),
                  logoUrl: logo(context),
                })
              ).blob
          ),
        })
        const file = uniqueFileName(
          suggestedFile ||
            result.fileName ||
            `1688toPL-${context.containerId}-${context.revisionId}${context.draft ? '-DRAFT' : ''}.xlsx`
        )
        saveFile(
          new Blob([result.bytes || result], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          }),
          file
        )
        const files = [file]
        if (options.includeAutomationJson === true) {
          const name = file.replace(/\.xlsx$/i, '.json'),
            summary = workbookAdapter.summary(context, {
              file,
              files: [file, name],
            })
          saveFile(
            new Blob([JSON.stringify(summary, null, 2)], {
              type: 'application/json',
            }),
            name
          )
          files.push(name)
        }
        announceExport(files)
        feedback(m('Packing list saved to your downloads: {0}', { 0: file }))
      },
    })
  }
  return {
    ordersContext,
    containerContext,
    orderCartonContext,
    async printOrderCartonMark(ref) {
      return printLabels('mark', await orderCartonContext(ref))
    },
    copyLabels,
    printLabels,
    copyPreparation,
    copy,
    openWorkbook,
    openRecentPrints: () =>
      openRecentPrintJobs({
        onRegenerate: async (job) => {
          const refs =
            job.products?.flatMap(
              (row) => row.refs || (row.ref ? [row.ref] : [])
            ) || []
          const physicalRef = refs.find(
              (ref) => ref?.scope === 'order-carton-mark'
            ),
            containerRef = refs.find((ref) => ref?.containerId)
          const context = physicalRef
            ? await orderCartonContext(physicalRef)
            : containerRef
              ? await containerContext(containerRef)
              : await ordersContext(authoring.rowsForRefs(refs))
          if (containerRef)
            for (const ref of refs) assertContainerPrintRef(ref, context)
          if (physicalRef) {
            const fresh = await repository.getOrderReconciliation({
              accountId: physicalRef.accountId,
              orderId: physicalRef.orderId,
              ...(physicalRef.contextContainerId
                ? { contextContainerId: physicalRef.contextContainerId }
                : {}),
            })
            for (const ref of refs) await assertOrderCartonPrintRef(ref, fresh)
          }
          const kind = job.kind === 'marks' ? 'mark' : 'barcode'
          const projected =
            context.kind === 'container-revision' && workbookAdapter?.printRows
              ? {
                  ...context,
                  products: workbookAdapter.printRows(context, { kind }),
                }
              : context
          const restored = restoreJob(job, outputLabelModels(projected, kind))
          if (!restored.items.length)
            throw new Error(
              'None of the products in this print job can be found any more.'
            )
          const dialog = openPrintDialog({
            kind: job.kind,
            items: restored.items,
            problems: [],
            settings: settings(context),
            logoUrl: logo(context),
            ...(physicalRef
              ? { validateSource: () => validateOrderCartonSource(context) }
              : {}),
            job: {
              ...job,
              missing: restored.missing,
              changed: restored.changed,
            },
          })
          annotateDialog(context, dialog)
          return dialog
        },
      }),
  }
}
