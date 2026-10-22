import { element as el, copied, pinDialogActions, yieldUI } from './ui.js'
import { message as m, bindAttribute, getLanguage, t } from './i18n.js'
import { DEFAULT_LABEL_SETTINGS, renderLabel } from './labels.js'
import { openImageCopyDialog, imageBatchPlans } from './image-copy-dialog.js'
import {
  labelClipboard,
  preparationCopyFields,
  preparationTable,
  preparationFeatureFields,
  writeTable,
} from './preparation-clipboard.js'
import { createPreparationColumnPicker } from './preparation-column-picker.js'
import { createSizeClassifier } from './size-vocabulary.js'
import { popupLanguageToggle } from './popup-language-toggle.js'
import { openPrintDialog, openRecentPrintJobs } from './print-dialog.js'
import { restoreJob } from './print-store.js'
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
  if (
    !manifest?.container?.id ||
    !manifest.revisionId ||
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
    if (!code) throw new Error('Review product codes in Orders first.')
    if (kind === 'mark' && !category?.trim())
      throw new Error(
        'Add a Chinese category in Orders before generating this carton mark.'
      )
    if (kind !== 'mark' && !row.spanishName?.trim())
      throw new Error(
        'Add a Spanish name in Orders before generating this barcode.'
      )
    if (row.needsSizeMapping)
      throw new Error('Map this variant size before generating labels')
    const existing = models.get(code)
    const quantity =
      kind === 'mark' ? (row.cartonId ? '1' : null) : row.quantity
    const source = {
      orderId: row.orderId,
      accountId: row.accountId || 'local',
      seller: row.sellerName || '',
      ...(row.source === 'other'
        ? { source: 'other', reference: row.reference }
        : {}),
    }
    const ref = {
      accountId: source.accountId,
      orderId: row.orderId,
      groupId: row.groupId || row.group?.id,
      variantId: row.variantId || row.variant?.id,
      entryIds: row.entryId ? [row.entryId] : [],
      ...(row.cartonId ? { cartonId: row.cartonId } : {}),
      ...(context.kind === 'container-revision'
        ? { containerId: context.containerId, revisionId: context.revisionId }
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
  feedback = () => {},
  workbookAdapter,
}) {
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
    if (context.kind !== 'container-revision' || !dialog) return
    const note = el('div', undefined, 'container-output-context')
    note.append(
      el('p', `${context.container.name} · ${context.revisionId}`),
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
    return captureContainerOutput(
      await repository.getContainerManifest({
        id: ref.containerId || ref.id,
        revisionId: ref.revisionId,
      })
    )
  }
  async function copyLabels(kind, source) {
    const context = Array.isArray(source)
      ? await ordersContext(source, { labels: true })
      : source
    const printContext =
      context.kind === 'container-revision' && workbookAdapter?.printRows
        ? { ...context, products: workbookAdapter.printRows(context, { kind }) }
        : context
    const items = outputLabelModels(printContext, kind),
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
            const result = await renderLabel({
              ...item.model,
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
    const printContext =
      context.kind === 'container-revision' && workbookAdapter?.printRows
        ? { ...context, products: workbookAdapter.printRows(context, { kind }) }
        : context
    const items = outputLabelModels(printContext, kind)
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
    }
    if (!items.length) throw new Error('No active labels to copy.')
    const dialog = openPrintDialog({
      kind: kind === 'mark' ? 'marks' : 'labels',
      items,
      problems: [],
      settings: settings(context),
      logoUrl: logo(context),
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
    const fields = createPreparationColumnPicker(modal, (columns) => {
      copy.disabled = !columns.length
    })
    const copy = el('button', m('Copy chosen columns'), 'primary'),
      close = el('button', m('Close'))
    copy.disabled = !fields.selected().length
    copy.onclick = () =>
      void copied(copy, () => {
        const translate = (source, params) =>
          t(source, params, getLanguage(modal))
        return writeTable(
          preparationTable(
            rows.map((row, index) => ({
              ...row,
              ...preparationFeatureFields(featureSources[index], translate),
            })),
            fields.selected(),
            headers(),
            translate
          )
        )
      })
    close.onclick = () => modal.close()
    actions.append(popupLanguageToggle(modal), close, copy)
    modal.append(actions)
    pinDialogActions(modal, actions)
    modal.onclose = () => {
      fields.destroy()
      modal.remove()
    }
    document.body.append(modal)
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
          const containerRef = refs.find(
            (ref) => ref?.containerId && ref?.revisionId
          )
          const context = containerRef
            ? await containerContext(containerRef)
            : await ordersContext(authoring.rowsForRefs(refs))
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
          return openPrintDialog({
            kind: job.kind,
            items: restored.items,
            problems: [],
            settings: settings(context),
            logoUrl: logo(context),
            job: {
              ...job,
              missing: restored.missing,
              changed: restored.changed,
            },
          })
        },
      }),
  }
}
