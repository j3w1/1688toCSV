import {
  message as uiMessage,
  bindText,
  bindAttribute,
  isMessage,
  t,
  getLocale,
  getLanguage,
  onLanguageChange,
  localize,
  setLanguage,
} from './i18n.js'
import { copyTable, copySingleImage, pngThumbnail } from './clipboard.js'
import { openDatabase } from './database.js'
import {
  confirmScope,
  copied,
  yieldUI,
  enableLightDismiss,
  copyTextButton,
  orderReference,
} from './ui.js'
import { startPackingWorkspace } from './packing-workspace.js'
import { createImportReport, importJobView } from './import-report.js'
import {
  createProgressView,
  importProgressStyles,
  progressPresentation,
} from './import-progress.js'
import { createPhotoViewer } from './photo-viewer.js'
import { presentOrderStatus } from './order-presentation.js'
import { labelColorKey } from './appearance.js'
import { applyCodeDesign } from './code-design.js'
import { orderTagBadge, mountOrderAnnotations } from './order-tags-ui.js'
import { mergeOrderTags } from './order-tags.js'
import { createRowSelection } from './row-selection.js'
import { copyExcelImage } from './excel-image-copy.js'
import { copySourceImages } from './source-image-copy.js'
import { mountProductCopyActions, mountCopyActions } from './copy-actions.js'
import { showErrorNotice, clearErrorNotice } from './error-notice.js'
import { photoCopyTile } from './photo-copy.js'
import { summarizeOrders, summarizeProductRows } from './order-summary.js'
import { decorateIcon, icon } from './icons.js'
import { preparationHelp } from './preparation-help.js'
import { installWorkspaceActionHelp } from './workspace-action-help.js'
import { installWorkspaceShortcuts } from './workspace-shortcuts.js'
import { createActivityTracker, ACTIVITY_READ_KEY } from './activity-state.js'
import { suggestMaterial, translateMaterial } from './material-vocabulary.js'
import { attachSearchSuggestions, searchMatcher } from './search-assistance.js'
import { productAttributes, translateAttribute } from './product-attributes.js'
import {
  createProductDescription,
  openProductDetails,
} from './product-details.js'

applyCodeDesign(document.documentElement)

const $ = (id) => document.getElementById(id)
const keyFor = (row) => `${row.orderId}/${row.entryId}`
const headerPreference = '1688-library-include-headers'
const monthPreference = '1688-library-purchase-months'
const purchaseDay = (order) => order.purchasedAt?.slice(0, 10) || ''
const purchaseMonth = (order) => purchaseDay(order).slice(0, 7) || 'unknown'
const monthLabel = (month) =>
  month === 'unknown'
    ? t('Date unavailable')
    : new Date(`${month}-01T12:00:00Z`).toLocaleDateString(getLocale(), {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      })
const purchaseLabel = (order) =>
  purchaseDay(order)
    ? new Date(`${purchaseDay(order)}T12:00:00Z`).toLocaleDateString(
        getLocale(),
        {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          timeZone: 'UTC',
        }
      )
    : t('Date unavailable')
const dateLabel = (value) =>
  value
    ? new Date(value).toLocaleString(getLocale(), {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—'
function node(tag, text, className) {
  const element = document.createElement(tag)
  if (tag === 'dialog') enableLightDismiss(element)
  if (isMessage(text)) bindText(element, text)
  else if (text !== undefined) element.textContent = text
  if (className) element.className = className
  if (tag === 'button') {
    const source = isMessage(text) ? text.source : text
    const name = /copy/i.test(source)
      ? 'copy'
      : /refresh|retry/i.test(source)
        ? 'refresh'
        : /save|back up/i.test(source)
          ? 'download'
          : /remove|dismiss/i.test(source)
            ? 'trash'
            : null
    if (name) decorateIcon(element, name)
  }
  return element
}
function statusBadge(status) {
  const display = presentOrderStatus(status)
  const badge = node('span', uiMessage(display.label), 'order-status')
  badge.dataset.tone = display.tone
  badge.dataset.uiLabel = labelColorKey(display.label)
  badge.title = status
  return badge
}
function revisionBadge(updated) {
  const badge = node(
    'span',
    uiMessage(updated ? 'Updated' : 'Saved'),
    'badge revision-badge'
  )
  badge.dataset.uiLabel = updated ? 'updated' : 'saved'
  preparationHelp(
    badge,
    updated
      ? 'This order changed during a refresh. Updated does not describe its delivery status.'
      : 'Saved in this browser. Saved does not describe its delivery status.'
  )
  return badge
}
function dateBadge(order) {
  const date = node('time', undefined, 'purchase-date')
  date.dataset.uiLabel = 'dates'
  bindText(date, () => purchaseLabel(order))
  if (purchaseDay(order)) date.dateTime = purchaseDay(order)
  bindAttribute(date, 'title', uiMessage('Purchase date'))
  return date
}
function downloadJson(value, filename) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value)], { type: 'application/json' })
  )
  const anchor = node('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}

async function confirmBulkResume(job) {
  const done =
    job.orders?.filter((order) => order.state === 'done').length ||
    job.done ||
    0
  const count =
    job.remaining ??
    Math.max(0, (job.total || job.discovered || job.orders?.length || 0) - done)
  if (count <= 1) return true
  const dialog = node('dialog')
  bindAttribute(dialog, 'aria-label', uiMessage('Confirm bulk import'))
  dialog.append(
    node(
      'h2',
      uiMessage('Resume collection of {0} orders?', {
        0: () => count.toLocaleString(getLocale()),
      })
    ),
    node(
      'p',
      uiMessage(
        'This resumes the previous bulk import, using one visible detail tab to collect the remaining orders. Cancel if you only want a few selected orders.'
      )
    )
  )
  const cancel = node('button', uiMessage('Cancel')),
    proceed = node(
      'button',
      uiMessage('Resume {0} orders', {
        0: () => count.toLocaleString(getLocale()),
      }),
      'primary'
    )
  dialog.append(cancel, proceed)
  document.body.append(dialog)
  return new Promise((resolve) => {
    let confirmed = false
    cancel.addEventListener('click', () => dialog.close())
    proceed.addEventListener('click', () => {
      confirmed = true
      dialog.close()
    })
    dialog.addEventListener(
      'close',
      () => {
        dialog.remove()
        resolve(confirmed)
      },
      { once: true }
    )
    dialog.showModal()
    cancel.focus()
  })
}

export async function startLibrary(
  transport = (message) => chrome.runtime.sendMessage(message),
  repository = null
) {
  localize(document)
  installWorkspaceActionHelp(document)
  installWorkspaceShortcuts(document)
  setLanguage(getLanguage(), { persist: false })
  const languageButtons = [
    ...document.querySelectorAll('#language-toggle [data-language]'),
  ]
  const updateLanguageButtons = () => {
    for (const button of languageButtons)
      button.setAttribute(
        'aria-pressed',
        String(button.dataset.language === getLanguage())
      )
  }
  updateLanguageButtons()
  for (const button of languageButtons)
    button.addEventListener('click', () => setLanguage(button.dataset.language))
  const progressStyle = node('style', importProgressStyles)
  document.head.append(progressStyle)
  for (const dialog of document.querySelectorAll('dialog'))
    enableLightDismiss(dialog)
  let records = [],
    jobs = [],
    page = 0,
    refreshWork,
    hasLoadedLibrary = false,
    refreshPending = false,
    copyBusy = false,
    showDismissed = false,
    orderPage = 0
  let packing
  let orderTagDefinitions = [],
    productTagDefinitions = [],
    productDetailsEditor,
    annotationEditor
  const annotationDrafts = new Map()
  async function flushOrderDetails() {
    if (annotationEditor) await annotationEditor.flush()
  }
  addEventListener('beforeunload', (event) => {
    if (!annotationEditor?.dirty() && !productDetailsEditor?.dirty()) return
    event.preventDefault()
    event.returnValue = ''
  })
  const detailsDialog = $('order-details')
  let closingOrderDetails = false
  async function closeOrderDetails(event) {
    event.preventDefault()
    if (closingOrderDetails) return
    closingOrderDetails = true
    try {
      await flushOrderDetails()
      detailsDialog.close()
      annotationEditor?.destroy()
      annotationEditor = undefined
    } catch {
      annotationEditor?.section
        .querySelector('.annotation-footer button')
        ?.focus()
    } finally {
      closingOrderDetails = false
    }
  }
  detailsDialog.addEventListener('cancel', closeOrderDetails)
  detailsDialog
    .querySelector('form')
    .addEventListener('submit', closeOrderDetails)
  const currentMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
  let savedMonths = [currentMonth]
  try {
    const stored = JSON.parse(localStorage.getItem(monthPreference))
    if (Array.isArray(stored))
      savedMonths = stored.filter((month) =>
        /^(?:20\d{2}-(?:0[1-9]|1[0-2])|unknown)$/.test(month)
      )
  } catch {}
  const selectedMonths = new Set(savedMonths)
  const expandedMonths = new Set([currentMonth, ...savedMonths])
  let monthAnchor = null
  const photos = createPhotoViewer(async (url) => {
    const data = await send('IMAGE_GET', { url })
    return typeof data === 'string' ? data : data.dataUrl
  })
  const selectedOrders = new Set(),
    selectedRows = new Set(),
    preparedImages = new Map(),
    loadingImages = new Map()
  function showProductDetails(row, { sourceItems = [row] } = {}) {
    const record =
      records.find(
        ({ snapshot, accountId }) =>
          snapshot.orderId === row.orderId &&
          (!row.record || accountId === row.record.accountId)
      ) || row.record
    const details = openProductDetails(row, {
      tags:
        record && repository?.setProductTags
          ? {
              selected: record.productTags?.[row.entryId] || [],
              definitions: productTagDefinitions,
              save: async (names) => {
                await send('LIBRARY_PRODUCT_TAGS', {
                  orderId: row.orderId,
                  entryId: row.entryId,
                  tags: names,
                  accountId: record.accountId || 'local',
                })
                await refresh()
                return productTagDefinitions
              },
            }
          : undefined,
      loadPhoto: async (url) => {
        const result = await send('IMAGE_GET', { url })
        return typeof result === 'string' ? result : result.dataUrl
      },
      onPhoto: () =>
        void photos.open(
          row,
          sourceItems.length > 1 || !row.record ? sourceItems : filteredRows()
        ),
      onOrder: () =>
        record &&
        void openDetails(record).catch((error) =>
          feedback(error.message, true)
        ),
      copyPhoto: async () => {
        const result = await send('IMAGE_GET', { url: row.thumbnail })
        await copySingleImage(
          typeof result === 'string' ? result : result.dataUrl
        )
      },
    })
    const { dialog } = details
    productDetailsEditor = details
    dialog.addEventListener(
      'close',
      () => {
        if (productDetailsEditor === details) productDetailsEditor = undefined
      },
      { once: true }
    )
    if (sourceItems.length > 1) {
      const sources = node('nav', undefined, 'product-source-choices')
      bindAttribute(
        sources,
        'aria-label',
        uiMessage('Original products sharing this barcode')
      )
      sources.append(node('span', uiMessage('Original products:')))
      for (const [index, item] of sourceItems.entries()) {
        const choice = node('button', String(index + 1))
        choice.type = 'button'
        choice.setAttribute(
          'aria-pressed',
          String(item.entryId === row.entryId)
        )
        bindAttribute(
          choice,
          'aria-label',
          uiMessage('Original product {0}: {1}', {
            0: index + 1,
            1: item.title || item.description.split('\n')[0],
          })
        )
        preparationHelp(choice, item.description)
        choice.onclick = () =>
          void details.close(() => showProductDetails(item, { sourceItems }))
        sources.append(choice)
      }
      dialog.querySelector('.product-details-body').before(sources)
    }
    return dialog
  }
  const productSelection = createRowSelection({
    selected: selectedRows,
    getKeys: () => filteredRows().map(keyFor),
    onChange: updateSelection,
    onActivate: (key) => {
      const row = filteredRows().find((item) => keyFor(item) === key)
      if (!row) return
      showProductDetails(row)
    },
  })
  let selectionScope = 'products'
  for (const type of ['pointerdown', 'focusin'])
    document.addEventListener(type, (event) => {
      if (event.target.closest?.('#order-list')) selectionScope = 'orders'
      else if (event.target.closest?.('.table-scroll, .export-toolbar'))
        selectionScope = 'products'
    })
  document.addEventListener(
    'keydown',
    (event) => {
      if (
        $('orders-view').hidden ||
        document.querySelector('dialog[open]') ||
        !(event.ctrlKey || event.metaKey) ||
        !['a', 'd'].includes(event.key.toLowerCase()) ||
        event.altKey ||
        event.isComposing ||
        event.target.closest('input, textarea, select, [contenteditable]')
      )
        return
      event.preventDefault()
      event.stopPropagation()
      const selection =
        selectionScope === 'orders' ? orderSelection : productSelection
      if (event.key.toLowerCase() === 'a') selection.selectAll()
      else selection.clear()
    },
    true
  )
  const orderSelection = createRowSelection({
    selected: selectedOrders,
    getKeys: () =>
      matchingOrders()
        .filter(({ snapshot }) => expandedMonths.has(purchaseMonth(snapshot)))
        .map(({ snapshot }) => snapshot.orderId),
    onChange: () => {
      productSelection.reset()
      page = 0
      renderRows()
      updateOrderActions()
      packing?.updateActions()
    },
    onActivate: (key) => {
      const record = records.find(({ snapshot }) => snapshot.orderId === key)
      if (record)
        void openDetails(record).catch((error) => feedback(error.message, true))
    },
  })
  const imageObserver = new IntersectionObserver(
    async (entries) => {
      for (const entry of entries)
        if (entry.isIntersecting) {
          imageObserver.unobserve(entry.target)
          try {
            entry.target.src = await imageData(entry.target.dataset.thumbnail)
          } catch {
            bindAttribute(
              entry.target,
              'alt',
              uiMessage('Image unavailable offline')
            )
          }
        }
    },
    { rootMargin: '150px' }
  )
  const pageSize = 100
  for (const [id, name, iconOnly] of [
    ['packing-settings', 'settings', true],
    ['activity-open', 'activity', false],
    ['copy-values', 'copy'],
    ['copy-images', 'image'],
    ['copy-excel', 'table'],
    ['copy-excel-image', 'image'],
    ['prepare-orders', 'packing'],
    ['copy-preparation', 'copy'],
    ['copy-group-codes', 'copy'],
    ['refresh-all', 'refresh'],
    ['refresh-orders', 'refresh'],
    ['remove-orders', 'trash', true],
    ['backup', 'download'],
    ['restore', 'upload'],
  ])
    decorateIcon($(id), name, { iconOnly })
  decorateIcon(document.querySelector('.open-orders'), 'external')
  preparationHelp(
    $('orders-heading'),
    uiMessage(
      'Click to select or deselect. Shift-click for a range; Ctrl-click adds orders. Double-click or Enter opens details. Click a month heading to expand or collapse it.'
    )
  )
  preparationHelp(
    $('select-rows'),
    uiMessage(
      'Click a product row to select or deselect it. Shift-click selects a range; Ctrl-click adds rows. Buttons and photos work independently.'
    )
  )
  for (const [id, hint] of [
    ['activity-open', 'Import progress, paused jobs and reports.'],
    ['packing-settings', 'Label layout, naming rules, backup and restore.'],
    ['theme-toggle', 'Switch between dark and light appearance.'],
    ['order-search', 'Find a seller, member login or full order number.'],
    [
      'month-filter',
      'Filter by purchase month. Shift-click filters a range. Starts with the current month, then remembers your filter.',
    ],
    ['date-from', 'Include orders purchased on or after this date.'],
    ['date-to', 'Include orders purchased through this date.'],
    [
      'refresh-orders',
      'Refresh only the orders in the current selection and filters.',
    ],
    [
      'refresh-all',
      'Read every saved order again. Review the count before starting.',
    ],
    [
      'all-orders',
      'Clear the order selection, order search and purchase-date filters.',
    ],
    ['search', 'Search product text, sellers and prepared names or codes.'],
    ['status-filter', 'Show orders with this purchase status.'],
    ['changes-only', 'Show product rows changed by a recent refresh.'],
    [
      'packing-month',
      'The month you are packing for, independent of purchase dates. Selected products receive this month’s CE codes after you confirm any changes. With no products selected, reopen products already assigned to this packing month.',
    ],
    [
      'prepare-orders',
      'Prepare exactly the selected products. Ctrl+A in the product table selects all filtered products. Review the scope shown beside this button.',
    ],
    [
      'copy-values',
      'Copy the five source columns. Uses selected rows, or all filtered rows.',
    ],
    [
      'copy-images',
      'Copy separate product pictures for the selected or filtered rows.',
    ],
    [
      'copy-excel',
      'Copy source values and product pictures together into Excel.',
    ],
    [
      'copy-excel-image',
      'Copy selected rows as one picture in your workspace language',
    ],
    ['copy-preparation', 'Choose which packing and source columns to copy.'],
    ['copy-group-codes', 'Copy one CE code per product group.'],
    [
      'include-headers',
      'Include column headings in copied values. Image headings follow the workspace language.',
    ],
    [
      'clear-rows',
      'Clear the row selection; copying will use all filtered rows.',
    ],
    [
      'remove-orders',
      'Remove the selected orders and their packing data from this browser. Their codes become available when no remaining product uses them.',
    ],
    [
      'backup',
      'Save orders, packing edits, naming rules and current code assignments to a local file.',
    ],
    [
      'restore',
      'Merge a saved backup into this library, preserving newer edits and checking current code conflicts.',
    ],
    [
      'pause-active',
      'Pause collection after the current operation. Saved orders stay available.',
    ],
  ])
    preparationHelp($(id), hint)
  try {
    const stored = localStorage.getItem(headerPreference)
    if (stored !== null) $('include-headers').checked = stored === 'true'
  } catch {
    /* Keep the unchecked default when preferences are unavailable. */
  }
  $('include-headers').addEventListener('change', () => {
    try {
      localStorage.setItem(
        headerPreference,
        String($('include-headers').checked)
      )
    } catch {}
  })
  addEventListener('storage', (event) => {
    if (event.key === headerPreference || event.key === null)
      $('include-headers').checked = event.newValue === 'true'
  })
  let jobTimer, searchTimer, orderSearchTimer
  let jobStructure = ''
  const jobViews = new Map()
  async function send(type, data = {}) {
    // Extension pages share IndexedDB with the worker. Large libraries and
    // image backups must not cross Chrome's runtime message size limit.
    if (repository) {
      if (type === 'LIBRARY_QUERY')
        return {
          orders: await repository.listOrders(),
          jobs: (await repository.listJobs()).map(importJobView),
        }
      if (type === 'LIBRARY_HISTORY') return repository.getHistory(data.orderId)
      if (type === 'BACKUP_EXPORT') return repository.exportBackup()
      if (
        [
          'BACKUP_RESTORE',
          'LIBRARY_NOTES',
          'LIBRARY_PRODUCT_TAGS',
          'LIBRARY_PACKING_EXCLUSION',
          'LIBRARY_REMOVE',
        ].includes(type)
      ) {
        if (
          ['BACKUP_RESTORE', 'LIBRARY_REMOVE'].includes(type) &&
          (await repository.listJobs()).some((job) => job.state === 'running')
        )
          throw new Error(
            'Pause the import before removing orders or restoring a backup.'
          )
        let result
        if (type === 'BACKUP_RESTORE')
          result = await repository.restoreBackup(data.backup)
        if (type === 'LIBRARY_NOTES')
          result = await repository.setNotes(data.orderId, {
            notes: data.notes,
            tags: data.tags,
          })
        if (type === 'LIBRARY_PRODUCT_TAGS')
          result = await repository.setProductTags(
            data.orderId,
            data.entryId,
            data.tags,
            {
              accountId: data.accountId || 'local',
            }
          )
        if (type === 'LIBRARY_PACKING_EXCLUSION')
          result = await repository.setPackingExcluded(
            data.orderId,
            data.entryIds,
            data.excluded,
            { accountId: data.accountId || 'local' }
          )
        if (type === 'LIBRARY_REMOVE')
          result = await repository.removeOrders(data.orderIds)
        // Persistence is already committed; a sleeping/updated worker must not
        // turn a successful local write into a false failure message.
        try {
          await transport({ type: 'LIBRARY_UPDATED' })
        } catch {
          /* Refresh locally below. */
        }
        return result
      }
    }
    const reply = await transport({ type, ...data })
    if (!reply?.ok)
      throw new Error(
        reply?.error ||
          'The extension could not complete that action. Reload this page and try again.'
      )
    return reply.data
  }
  let feedbackTimer
  function feedback(message, error = false) {
    clearTimeout(feedbackTimer)
    if (error) {
      $('feedback').replaceChildren()
      showErrorNotice(message, { key: 'feedback' })
      return
    }
    clearErrorNotice({ key: 'feedback' })
    const close = node('button', '×')
    bindAttribute(close, 'aria-label', uiMessage('Dismiss notification'))
    close.onclick = () => {
      clearTimeout(feedbackTimer)
      $('feedback').replaceChildren()
    }
    $('feedback').replaceChildren(
      node('span', isMessage(message) ? message : uiMessage(message)),
      close
    )
    $('feedback').className = ''
    feedbackTimer = setTimeout(() => $('feedback').replaceChildren(), 4000)
  }
  function action(id, handler) {
    $(id).addEventListener('click', async () => {
      try {
        await handler()
      } catch (error) {
        feedback(error.message, true)
      }
    })
  }
  async function copyAction(button, handler) {
    try {
      return await copied(button, handler)
    } finally {
      if (button.closest('.copy-actions')) updateSelection()
    }
  }
  function matchingOrders() {
    const matches = searchMatcher($('order-search').value)
    const from = $('date-from').value,
      to = $('date-to').value
    return records.filter((record) => {
      const order = record.snapshot
      const day = purchaseDay(order)
      return (
        matches([
          order.sellerName,
          order.sellerMemberLogin,
          order.orderId,
          ...record.tags,
        ]) &&
        (!selectedMonths.size || selectedMonths.has(purchaseMonth(order))) &&
        (!(from || to) || (day && (!from || day >= from) && (!to || day <= to)))
      )
    })
  }
  let productSearchMetadata = new WeakMap()
  function productSearchTerms(item) {
    const language = getLanguage()
    let saved = productSearchMetadata.get(item)
    if (!saved || saved.language !== language) {
      const parsed = productAttributes(item)
      const terms = parsed.fields.map(
        (field) => translateAttribute(field, language).value
      )
      terms.push(translateMaterial(suggestMaterial(item), language))
      saved = { language, terms }
      productSearchMetadata.set(item, saved)
    }
    return saved.terms
  }
  function filteredRows() {
    const search = $('search').value.trim(),
      matches = searchMatcher(search)
    const status = $('status-filter').value
    const changedOnly = $('changes-only').checked
    const rows = matchingOrders().flatMap((record) => {
      const order = record.snapshot
      if (selectedOrders.size && !selectedOrders.has(order.orderId)) return []
      if (status && order.status !== status) return []
      return order.items
        .filter((item) => {
          if (changedOnly && !record.changedEntryIds.includes(item.entryId))
            return false
          return (
            !search ||
            matches([
              item.description,
              item.productNumber,
              order.sellerName,
              order.orderId,
              record.notes,
              ...record.tags,
              ...(record.productTags?.[item.entryId] || []),
              packing?.searchText(order.orderId, item.entryId) || '',
              ...productSearchTerms(item),
            ])
          )
        })
        .map((item) => ({
          ...item,
          orderId: order.orderId,
          sellerName: order.sellerName,
          sellerMemberLogin: order.sellerMemberLogin,
          record,
        }))
    })
    // Main library rows follow the same purchase chronology as the order
    // selector, retaining source-row order within each order. Packing's manual
    // arrangement belongs to preparation and its exports, not this view.
    return rows
  }
  function copyRows() {
    const rows = filteredRows()
    const selected = rows.filter((row) => selectedRows.has(keyFor(row)))
    return selected.length ? selected : rows
  }
  function scopedOrders(rows = filteredRows()) {
    const ids = new Set(rows.map((row) => row.orderId))
    return records.filter(({ snapshot }) => ids.has(snapshot.orderId))
  }
  function renderTotals(rows) {
    const totals = summarizeOrders(scopedOrders(rows))
    const host = $('order-totals')
    const heading = node(
      'p',
      uiMessage('Whole-order totals · {0} matching order{1}', {
        0: () => totals.orderCount.toLocaleString(getLocale()),
        1: totals.orderCount === 1 ? '' : 's',
      }),
      'totals-scope'
    )
    bindAttribute(
      heading,
      'title',
      uiMessage(
        'Each matching order is counted once, including all its products, shipping and order discounts. Product searches do not split order charges.'
      )
    )
    preparationHelp(heading, heading.title)
    heading.removeAttribute('title')
    const amounts = node('dl', undefined, 'totals-grid')
    for (const [key, label, reduction] of [
      ['originalTotal', 'Original amount'],
      ['shipping', 'Shipping'],
      ['sellerAdjustment', 'Seller price changes', true],
      ['productDiscount', 'Product discounts', true],
      ['orderDiscount', 'Order discounts', true],
      ['redPacketDiscount', 'Red packets', true],
      ['customizationService', 'Extra services'],
      ['payable', 'Total payable'],
    ]) {
      const value = totals.amounts[key]
      if (
        ['customizationService', 'redPacketDiscount'].includes(key) &&
        value === '0.00'
      )
        continue
      const pair = node(
        'div',
        undefined,
        key === 'payable' ? 'totals-payable' : ''
      )
      const formatted =
        value === null
          ? 'Unavailable'
          : `${reduction && Number(value) !== 0 ? (Number(value) > 0 ? '−' : '+') : ''}¥ ${(reduction ? Math.abs(Number(value)) : Number(value)).toLocaleString(getLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      pair.append(
        node('dt', uiMessage(label)),
        node('dd', formatted, reduction ? 'total-reduction' : '')
      )
      amounts.append(pair)
    }
    host.replaceChildren(heading, amounts)
    if (totals.missingOrderCount || totals.inconsistentOrderCount)
      host.append(
        node(
          'p',
          uiMessage(
            'Some saved totals are incomplete or inconsistent. Refresh the affected orders; unavailable amounts are not treated as zero.'
          ),
          'totals-warning'
        )
      )
    if (totals.foreignCurrencyFeeUnknownCount)
      host.append(
        node(
          'p',
          uiMessage(
            '{0} orders report an unspecified foreign-payment fee. It is not included in these CNY totals.',
            { 0: totals.foreignCurrencyFeeUnknownCount }
          ),
          'totals-warning'
        )
      )
    host.hidden = !records.length
  }
  function renderSelectionTotals(rows, selected) {
    const selectedTotals = summarizeProductRows(selected)
    const filteredTotals = summarizeProductRows(rows)
    const matchingTotals = summarizeProductRows(
      scopedOrders(rows).flatMap(({ snapshot }) => snapshot.items)
    )
    const host = $('product-selection-totals')
    const integer = (value) =>
      value === null
        ? t('Unavailable')
        : BigInt(value).toLocaleString(getLocale())
    const money = (value) => {
      if (value === null) return t('Unavailable')
      const [whole, fraction] = value.split('.')
      const decimal = new Intl.NumberFormat(getLocale())
        .formatToParts(1.1)
        .find((part) => part.type === 'decimal').value
      return `¥ ${BigInt(whole).toLocaleString(getLocale())}${decimal}${fraction}`
    }
    const amounts = node('dl', undefined, 'selection-totals-grid')
    for (const [key, label, value] of [
      ['rows', 'Selected rows', integer(selectedTotals.rowCount)],
      ['quantity', 'Quantity', integer(selectedTotals.quantity)],
      ['gross', 'Price × quantity', money(selectedTotals.gross)],
      [
        'after-discounts',
        'After row discounts',
        money(selectedTotals.afterDiscount),
      ],
    ]) {
      const pair = node('div')
      pair.dataset.selectionTotal = key
      pair.append(node('dt', uiMessage(label)), node('dd', value))
      amounts.append(pair)
    }
    preparationHelp(
      amounts,
      uiMessage(
        'Only selected product rows are summed, across all filtered pages. After row discounts uses the saved Discount column, including already allocated seller adjustments. Shipping and other order-wide charges are not added or divided. This is not the order payable total.'
      )
    )
    const context = node('p', undefined, 'selection-totals-context')
    context.append(
      node(
        'span',
        uiMessage('Filtered products: {rows} rows · Quantity {quantity}', {
          rows: integer(filteredTotals.rowCount),
          quantity: integer(filteredTotals.quantity),
        })
      ),
      node(
        'span',
        uiMessage('Complete matching orders: Quantity {quantity}', {
          quantity: integer(matchingTotals.quantity),
        })
      )
    )
    host.replaceChildren(amounts, context)
  }
  function updateSelection() {
    packing?.updateActions()
    const rows = filteredRows(),
      selected = rows.filter((row) => selectedRows.has(keyFor(row)))
    renderSelectionTotals(rows, selected)
    bindText(
      $('selection-summary'),
      uiMessage('{0} rows{1}', {
        0: () => rows.length.toLocaleString(getLocale()),
        1: () =>
          selected.length
            ? uiMessage(' · {0} selected', {
                0: selected.length.toLocaleString(getLocale()),
              })
            : uiMessage(' · all filtered rows will copy'),
      })
    )
    $('select-rows').disabled = !rows.length || selected.length === rows.length
    $('clear-rows').disabled = !selectedRows.size
    for (const id of [
      'copy-excel',
      'copy-values',
      'copy-images',
      'copy-excel-image',
    ])
      $(id).disabled =
        !rows.length || copyBusy || $(id).getAttribute('aria-busy') === 'true'
    for (const id of [
      'copy-barcodes',
      'copy-carton-marks',
      'print-labels',
      'print-carton-marks',
    ]) {
      const target = $(id)
      if (target)
        target.disabled = copyBusy || !packing?.canCopyLabels(copyRows())
    }
  }
  async function imageData(url) {
    if (!url)
      throw new Error(
        'A selected product has no thumbnail. Copy values, or choose rows with images.'
      )
    if (preparedImages.has(url)) return preparedImages.get(url)
    if (!loadingImages.has(url))
      loadingImages.set(
        url,
        (async () => {
          try {
            const data = await send('IMAGE_GET', { url })
            const result = await pngThumbnail(
              typeof data === 'string' ? data : data.dataUrl,
              { size: 240 }
            )
            preparedImages.set(url, result)
            while (preparedImages.size > 200)
              preparedImages.delete(preparedImages.keys().next().value)
            return result
          } finally {
            loadingImages.delete(url)
          }
        })()
      )
    return loadingImages.get(url)
  }
  function renderOrders() {
    const list = $('order-list')
    list.replaceChildren()
    orderSelection.detach()
    const matching = matchingOrders()
    const expanded = matching.filter(({ snapshot }) =>
      expandedMonths.has(purchaseMonth(snapshot))
    )
    orderPage = Math.min(
      orderPage,
      Math.max(0, Math.ceil(expanded.length / 50) - 1)
    )
    $('orders-page').textContent =
      `${orderPage + 1} / ${Math.max(1, Math.ceil(expanded.length / 50))}`
    $('orders-prev').disabled = orderPage === 0
    $('orders-next').disabled = (orderPage + 1) * 50 >= expanded.length
    if (!matching.length)
      list.append(
        node(
          'p',
          uiMessage('No orders match these filters.'),
          'order-search-empty'
        )
      )
    const visible = new Set(
      expanded
        .slice(orderPage * 50, (orderPage + 1) * 50)
        .map(({ snapshot }) => snapshot.orderId)
    )
    let lastMonth
    for (const record of matching) {
      const order = record.snapshot
      const month = purchaseMonth(order)
      if (month !== lastMonth) {
        const section = node('h3', undefined, 'order-month')
        const toggle = node('button', undefined, 'month-toggle')
        toggle.append(
          node('span', monthLabel(month)),
          node(
            'small',
            String(
              matching.filter(
                ({ snapshot }) => purchaseMonth(snapshot) === month
              ).length
            )
          )
        )
        decorateIcon(toggle, 'chevron')
        toggle.setAttribute('aria-expanded', String(expandedMonths.has(month)))
        bindAttribute(
          toggle,
          'aria-label',
          uiMessage('{0} orders', { 0: () => monthLabel(month) })
        )
        preparationHelp(
          toggle,
          uiMessage(
            'Expand or collapse this month. Use the purchase-month filter to change the product list.'
          )
        )
        toggle.addEventListener('click', () => {
          if (expandedMonths.has(month)) expandedMonths.delete(month)
          else expandedMonths.add(month)
          const first = matching
            .filter(({ snapshot }) =>
              expandedMonths.has(purchaseMonth(snapshot))
            )
            .findIndex(({ snapshot }) => purchaseMonth(snapshot) === month)
          orderPage = Math.max(0, Math.floor(first / 50))
          renderOrders()
        })
        section.append(toggle)
        list.append(section)
      }
      lastMonth = month
      if (!visible.has(order.orderId)) continue
      const card = node('div', undefined, 'order-card')
      card.setAttribute('role', 'option')
      bindAttribute(
        card,
        'aria-label',
        uiMessage('Order {0}', { 0: order.orderId })
      )
      card.setAttribute('aria-describedby', `order-summary-${order.orderId}`)
      preparationHelp(
        card,
        uiMessage(
          'Click to select or deselect. Shift-click selects a range. Double-click opens order details.'
        )
      )
      const summary = node('div', undefined, 'order-summary')
      summary.id = `order-summary-${order.orderId}`
      const identity = node('div', undefined, 'order-card-identity')
      identity.append(
        copyTextButton(order.sellerName, {
          label: 'Copy store name',
          className: 'order-seller',
        })
      )
      const productNames = packing?.orderNames(order.orderId) || []
      if (getLanguage() !== 'zh' && productNames.length) {
        const names = node('span', undefined, 'order-name-summary spanish-name')
        names.append(node('span', productNames[0], 'order-name-label'))
        names.tabIndex = 0
        if (productNames.length > 1)
          names.append(
            node('small', `+${productNames.length - 1}`, 'order-name-count')
          )
        preparationHelp(
          names,
          uiMessage('Product names: {0}', { 0: productNames.join(' · ') })
        )
        identity.append(names)
      }
      summary.append(identity)
      const reference = node('div', undefined, 'order-card-reference')
      reference.append(
        orderReference(order.orderId, {
          className: 'order-reference',
        }),
        node(
          'span',
          uiMessage(order.items.length === 1 ? '{0} product' : '{0} products', {
            0: () => order.items.length.toLocaleString(getLocale()),
          }),
          'order-products'
        )
      )
      const meta = node('div', undefined, 'order-card-meta')
      meta.append(
        statusBadge(order.status),
        dateBadge(order),
        revisionBadge(record.revision > 1)
      )
      if (record.tags.length) {
        const tags = node('div', undefined, 'order-card-tags')
        tags.append(
          ...record.tags.map((name) => orderTagBadge(name, orderTagDefinitions))
        )
        meta.append(tags)
      }
      summary.append(reference, meta)
      card.append(summary)
      orderSelection.bind(card, order.orderId)
      list.append(card)
    }
    orderSelection.paint()
    updateOrderActions()
  }
  function updateOrderActions() {
    const matching = scopedOrders()
    bindText(
      $('refresh-orders'),
      uiMessage('Refresh {0} order{1}', {
        0: matching.length,
        1: matching.length === 1 ? '' : 's',
      })
    )
    decorateIcon($('refresh-orders'), 'refresh')
    bindText(
      $('refresh-scope'),
      selectedOrders.size
        ? uiMessage('Selected orders')
        : selectedMonths.size
          ? uiMessage('Selected months · matching search')
          : uiMessage('All matching orders')
    )
    const running = jobs.some((job) => job.state === 'running')
    $('refresh-orders').disabled = !matching.length || running
    $('refresh-all').disabled = !records.length || running
    $('remove-orders').disabled = !selectedOrders.size
  }
  function renderRows() {
    const rows = filteredRows()
    const maxPage = Math.max(0, Math.ceil(rows.length / pageSize) - 1)
    page = Math.min(page, maxPage)
    imageObserver.disconnect()
    const body = $('sheet-body')
    body.replaceChildren()
    productSelection.detach()
    const orderCounts = new Map()
    for (const row of rows)
      orderCounts.set(row.orderId, (orderCounts.get(row.orderId) || 0) + 1)
    const orderPositions = new Map(
      [...orderCounts.keys()].map((id, index) => [id, index])
    )
    let previousOrder
    let sectionId
    const pageRows = rows.slice(page * pageSize, (page + 1) * pageSize)
    const effectiveMaterials = new Map(
      (packing?.preparedRows(pageRows) || pageRows).map((row) => [
        keyFor(row),
        {
          value: row.material ?? suggestMaterial(row),
          source: row.materialSource,
        },
      ])
    )
    for (const [index, row] of pageRows.entries()) {
      const changed = row.record.changedEntryIds.includes(row.entryId)
      const tr = node('tr', undefined, changed ? 'changed-row' : '')
      const tone =
        orderPositions.get(row.orderId) % 2
          ? 'order-tone-olive'
          : 'order-tone-clay'
      tr.classList.add(tone)
      if (previousOrder !== row.orderId) {
        const heading = node('tr', undefined, `order-section-heading ${tone}`)
        const cell = node('th')
        cell.colSpan = 6
        sectionId = `order-section-${row.orderId}`
        cell.id = sectionId
        const band = node('div', undefined, 'order-section-band')
        const shop = node('span', undefined, 'order-section-store')
        shop.append(
          icon('store'),
          copyTextButton(row.sellerName, {
            label: 'Copy store name',
            className: 'order-seller',
          })
        )
        const count = orderCounts.get(row.orderId)
        const continued =
          rows[page * pageSize + index - 1]?.orderId === row.orderId
        band.append(
          shop,
          orderReference(row.orderId, {
            className: 'order-section-number',
          }),
          dateBadge(row.record.snapshot),
          statusBadge(row.record.snapshot.status),
          revisionBadge(row.record.revision > 1),
          node(
            'span',
            uiMessage('{0} matching product{1}{2}', {
              0: () => count.toLocaleString(getLocale()),
              1: count === 1 ? '' : 's',
              2: continued ? uiMessage(' · continued') : '',
            }),
            'order-section-count'
          )
        )
        cell.append(band)
        heading.append(cell)
        body.append(heading)
      }
      tr.setAttribute('aria-describedby', sectionId)
      previousOrder = row.orderId
      const selection = node(
        'td',
        String(page * pageSize + index + 1),
        'row-number'
      )
      bindAttribute(
        tr,
        'aria-label',
        uiMessage('Product {0}', { 0: row.entryId })
      )
      productSelection.bind(tr, keyFor(row))
      const thumb = node('td', undefined, 'thumb-cell')
      const image = node('img')
      image.width = 74
      image.height = 74
      image.loading = 'lazy'
      image.alt = row.description.split('\n')[0]
      // Only image URLs are assigned, never source HTML or arbitrary protocols.
      image.dataset.thumbnail = row.thumbnail
      if (preparedImages.has(row.thumbnail))
        image.src = preparedImages.get(row.thumbnail)
      else imageObserver.observe(image)
      const zoom = node('button', undefined, 'product-photo-button')
      zoom.type = 'button'
      bindAttribute(
        zoom,
        'aria-label',
        uiMessage('Zoom product photo {0}', { 0: row.entryId })
      )
      preparationHelp(
        zoom,
        uiMessage(
          'Open the large photo. Scroll to zoom, then drag to inspect it.'
        )
      )
      zoom.disabled = !row.thumbnail
      zoom.append(image)
      zoom.addEventListener(
        'click',
        () => void photos.open(row, filteredRows())
      )
      thumb.append(
        photoCopyTile(
          zoom,
          async () => {
            const original = await send('IMAGE_GET', { url: row.thumbnail })
            await copySingleImage(
              typeof original === 'string' ? original : original.dataUrl
            )
          },
          { disabled: !row.thumbnail }
        )
      )
      const description = node('td', undefined, 'description-cell')
      description.append(createProductDescription(row))
      // Show the same effective material used by packing and exports. A manual
      // empty value is intentional; source materials remain in original details.
      const material = effectiveMaterials.get(keyFor(row))
      if (material.value || material.source === 'manual')
        for (const field of description.querySelectorAll(
          '[data-attribute="material"]'
        ))
          field.remove()
      if (material.value) {
        let attributes = description.querySelector('.product-attributes')
        if (!attributes) {
          attributes = node('dl', undefined, 'product-attributes')
          description.append(attributes)
        }
        const pair = node('div')
        pair.dataset.attribute = 'material'
        const value = node('dd', undefined, 'product-material-value')
        value.append(
          copyTextButton(translateMaterial(material.value, getLanguage()), {
            label: uiMessage('Copy material'),
          })
        )
        preparationHelp(
          value,
          uiMessage(
            'Material used for this product’s packing and exports. Edit it in Prepare packing; double-click the product to inspect the original seller data.'
          )
        )
        pair.append(node('dt', uiMessage('Material')), value)
        attributes.append(pair)
      }
      packing?.decorateRow(description, row)
      const assignedTags = row.record.productTags?.[row.entryId] || []
      if (assignedTags.length) {
        const tags = node('div', undefined, 'product-row-tags')
        tags.append(
          ...assignedTags.map((name) =>
            orderTagBadge(name, productTagDefinitions)
          )
        )
        description.append(tags)
      }
      const amount = (value) =>
        Number(value).toLocaleString(getLocale(), {
          minimumFractionDigits: 2,
          maximumFractionDigits: 4,
        })
      const discount = node('td', amount(row.discount), 'numeric discount-cell')
      if (Number(row.allocatedDiscount))
        discount.append(
          node(
            'small',
            uiMessage('incl. {0} allocated', { 0: row.allocatedDiscount })
          )
        )
      tr.append(
        selection,
        thumb,
        description,
        node('td', amount(row.price), 'numeric price-cell'),
        node(
          'td',
          Number(row.quantity).toLocaleString(getLocale(), {
            maximumFractionDigits: 4,
          }),
          'numeric quantity-cell'
        ),
        discount
      )
      body.append(tr)
    }
    $('empty-state').hidden = !!records.length
    document.querySelector('.table-scroll').hidden = !records.length
    bindText(
      $('sheet-title'),
      selectedOrders.size
        ? uiMessage('{0} selected order{1}', {
            0: selectedOrders.size,
            1: selectedOrders.size === 1 ? '' : 's',
          })
        : uiMessage('All products')
    )
    $('page-label').textContent = `${page + 1} / ${maxPage + 1}`
    $('previous-page').disabled = page === 0
    $('next-page').disabled = page === maxPage
    productSelection.paint()
    updateSelection()
    renderTotals(rows)
    updateOrderActions()
  }
  const activityTracker = createActivityTracker()
  window.addEventListener('storage', (event) => {
    if (event.key === ACTIVITY_READ_KEY || event.key === null) {
      activityTracker.reload()
      renderJobs()
    }
  })
  function renderJobs() {
    const running = jobs.some((job) => job.state === 'running')
    updateOrderActions()
    const sorted = [...jobs].sort((a, b) =>
      (b.updatedAt || '').localeCompare(a.updatedAt || '')
    )
    const visible = sorted.filter(
      (job) => !job.dismissedAt || job.state === 'running' || showDismissed
    )
    $('jobs').hidden = !jobs.length
    $('activity-empty').hidden = !!jobs.length
    const active = jobs.find((job) => job.state === 'running')
    if ($('activity-drawer').open) activityTracker.markRead(jobs)
    const activity = activityTracker.summary(jobs)
    const activityButton = $('activity-open'),
      activityCount = $('activity-count')
    activityButton.dataset.activityState = activity.running
      ? 'running'
      : activity.unread
        ? 'unread'
        : 'idle'
    activityCount.hidden = !activity.running && !activity.unread
    activityCount.setAttribute('aria-hidden', 'true')
    bindText(
      activityCount,
      activity.running
        ? uiMessage('Running')
        : uiMessage('{count} new', { count: activity.unread })
    )
    const activityHelp = activity.running
      ? uiMessage(
          '{running} ongoing import(s) · {unread} unread update(s). Open Activity to review progress and import reports.',
          activity
        )
      : activity.unread
        ? uiMessage(
            '{unread} unread import update(s). Open Activity to review completed, paused or failed imports.',
            activity
          )
        : uiMessage(
            'No unread activity. Open import history, progress and reports.'
          )
    bindAttribute(activityButton, 'aria-description', activityHelp)
    preparationHelp(activityButton, activityHelp)
    $('active-job').hidden = !active
    if (active) {
      const display = progressPresentation(active)
      $('active-job-text').textContent =
        `${display.title} · ${display.meter} · ${display.counts}`
      const bar = $('active-job-progress')
      bar.max = display.max || 1
      if (display.max) bar.value = display.value
      else bar.removeAttribute('value')
      bar.setAttribute('aria-label', display.label)
    }
    clearTimeout(jobTimer)
    if (running)
      jobTimer = setTimeout(async () => {
        try {
          ;({ jobs } = await send('JOBS_QUERY'))
          renderJobs()
        } catch (error) {
          feedback(error.message, true)
        }
      }, 2000)
    // Keep action buttons and keyboard focus intact during read/clock updates.
    const structure = JSON.stringify([
      showDismissed,
      sorted.map((job) => [job.id, job.state, job.dismissedAt]),
    ])
    if (structure === jobStructure) {
      for (const job of visible) updateJobView(job)
      return
    }
    jobStructure = structure
    jobViews.clear()
    $('jobs').replaceChildren()
    const heading = node('div', undefined, 'jobs-heading')
    heading.append(node('h2', uiMessage('Imports')))
    const controls = node('div', undefined, 'job-actions')
    if (jobs.some((job) => !job.dismissedAt && job.state !== 'running')) {
      const dismissAll = node('button', uiMessage('Dismiss all'), 'text-button')
      bindAttribute(
        dismissAll,
        'title',
        uiMessage(
          'Hide finished and paused import messages. Saved orders stay in your library.'
        )
      )
      dismissAll.addEventListener('click', async () => {
        const targets = jobs.filter(
          (job) => !job.dismissedAt && job.state !== 'running'
        )
        if (
          !(await confirmScope({
            action: 'Dismiss',
            count: targets.length,
            unit: 'activities',
            detail: 'Saved orders and labels will stay in the library.',
          }))
        )
          return
        dismissAll.disabled = true
        try {
          for (const job of targets)
            await send('IMPORT_DISMISS', { jobId: job.id })
          await refresh()
        } catch (error) {
          feedback(error.message, true)
        } finally {
          dismissAll.disabled = false
        }
      })
      controls.append(dismissAll)
    }
    if (jobs.some((job) => job.dismissedAt)) {
      const history = node(
        'button',
        showDismissed
          ? uiMessage('Hide dismissed')
          : uiMessage('Show dismissed'),
        'text-button'
      )
      history.setAttribute('aria-expanded', String(showDismissed))
      history.addEventListener('click', () => {
        showDismissed = !showDismissed
        renderJobs()
      })
      controls.append(history)
    }
    heading.append(controls)
    $('jobs').append(heading)
    for (const job of visible) {
      const container = node(
          'div',
          undefined,
          `job${job.dismissedAt ? ' dismissed-job' : ''}`
        ),
        details = node('div')
      const view = createProgressView(document)
      const errors = node('div')
      details.append(view.element, errors)
      jobViews.set(job.id, { view, errors })
      updateJobView(job)
      container.append(details)
      const actions = node('div', undefined, 'job-actions')
      const report = node('button', uiMessage('Save import report'))
      bindAttribute(
        report,
        'title',
        uiMessage(
          'Save every order status and error for this import. This does not start or retry any orders.'
        )
      )
      report.addEventListener('click', async () => {
        report.disabled = true
        try {
          const current = repository
            ? await repository.getJob(job.id)
            : (await send('JOBS_QUERY')).jobs.find((item) => item.id === job.id)
          if (!current) throw new Error('That import no longer exists.')
          const value = createImportReport(
            current,
            globalThis.chrome?.runtime?.getManifest?.().version || 'preview'
          )
          downloadJson(
            value,
            `1688-import-report-${value.exportedAt.slice(0, 10)}.json`
          )
          feedback(
            uiMessage(
              'Import report requested. Check your downloads. Use Data → Back up to save the product database too.'
            )
          )
        } catch (error) {
          feedback(error.message, true)
        } finally {
          report.disabled = false
        }
      })
      actions.append(report)
      if (job.state !== 'completed') {
        const button = node(
          'button',
          job.state === 'running'
            ? uiMessage('Pause')
            : uiMessage('Resume / retry')
        )
        button.addEventListener('click', async () => {
          button.disabled = true
          try {
            if (job.state !== 'running' && !(await confirmBulkResume(job)))
              return
            bindText(
              button,
              job.state === 'running'
                ? uiMessage('Pausing…')
                : uiMessage('Resuming…')
            )
            feedback(
              job.state === 'running'
                ? uiMessage('Pausing import…')
                : uiMessage(
                    'Resuming import. One visible detail tab will read the remaining orders.'
                  )
            )
            await send(
              job.state === 'running' ? 'IMPORT_PAUSE' : 'IMPORT_RESUME',
              { jobId: job.id }
            )
            await refresh()
          } catch (error) {
            feedback(error.message, true)
          } finally {
            button.disabled = false
            bindText(
              button,
              job.state === 'running'
                ? uiMessage('Pause')
                : uiMessage('Resume / retry')
            )
          }
        })
        actions.prepend(button)
      }
      if (job.state !== 'running' && !job.dismissedAt) {
        const dismiss = node('button', uiMessage('Dismiss'))
        bindAttribute(
          dismiss,
          'title',
          uiMessage(
            'Hide this message without removing saved orders. Find it later under Show dismissed.'
          )
        )
        dismiss.addEventListener('click', async () => {
          dismiss.disabled = true
          try {
            await send('IMPORT_DISMISS', { jobId: job.id })
            await refresh()
          } catch (error) {
            feedback(error.message, true)
            dismiss.disabled = false
          }
        })
        actions.append(dismiss)
      }
      container.append(actions)
      $('jobs').append(container)
    }
  }
  function updateJobView(job) {
    const entry = jobViews.get(job.id)
    if (!entry) return
    entry.view.update(job)
    const errors = (job.orders || [])
      .filter((item) => item.state === 'failed')
      .slice(0, 3)
    const errorSignature = JSON.stringify(
      errors.map((item) => [item.orderId, item.error])
    )
    if (entry.errorSignature !== errorSignature) {
      entry.errorSignature = errorSignature
      entry.errors.replaceChildren(
        ...errors.map((item) => {
          const row = node('p', undefined, 'job-error-line')
          row.append(
            orderReference(item.orderId),
            node('span', uiMessage(item.error || 'Could not read order'))
          )
          return row
        })
      )
    }
  }
  function render() {
    $('order-count').textContent = records.length.toLocaleString(getLocale())
    $('product-count').textContent = records
      .reduce((sum, record) => sum + record.snapshot.items.length, 0)
      .toLocaleString(getLocale())
    $('changed-count').textContent = records
      .filter((record) => record.revision > 1)
      .length.toLocaleString(getLocale())
    $('checked-at').textContent = dateLabel(
      records
        .map((record) => record.lastCheckedAt)
        .sort()
        .at(-1)
    )
    renderOrders()
    renderRows()
    renderJobs()
  }
  function updateMonthFilter() {
    try {
      localStorage.setItem(monthPreference, JSON.stringify([...selectedMonths]))
    } catch {}
    bindText(
      $('month-filter-label'),
      !selectedMonths.size
        ? uiMessage('All purchase months')
        : selectedMonths.size === 1
          ? monthLabel([...selectedMonths][0])
          : uiMessage('{0} purchase months', { 0: selectedMonths.size })
    )
    for (const button of $('month-options').querySelectorAll('button'))
      button.setAttribute(
        'aria-pressed',
        String(selectedMonths.has(button.dataset.month))
      )
    $('clear-months').setAttribute('aria-pressed', String(!selectedMonths.size))
  }
  function renderMonthOptions() {
    const months = [
      ...new Set([
        currentMonth,
        ...selectedMonths,
        ...records.map(({ snapshot }) => purchaseMonth(snapshot)),
      ]),
    ]
      .sort()
      .reverse()
    $('month-options').replaceChildren(
      ...months.map((month) => {
        const button = node('button', monthLabel(month), 'month-choice')
        button.dataset.month = month
        button.addEventListener('click', (event) => {
          if (event.shiftKey && monthAnchor && months.includes(monthAnchor)) {
            const start = months.indexOf(monthAnchor),
              end = months.indexOf(month)
            for (const value of months.slice(
              Math.min(start, end),
              Math.max(start, end) + 1
            ))
              selectedMonths.add(value)
          } else {
            if (selectedMonths.has(month)) selectedMonths.delete(month)
            else selectedMonths.add(month)
            monthAnchor = month
          }
          for (const value of selectedMonths) expandedMonths.add(value)
          orderSelection.reset()
          productSelection.reset()
          page = orderPage = 0
          updateMonthFilter()
          render()
        })
        return button
      })
    )
    updateMonthFilter()
  }
  function refresh() {
    if (refreshWork) {
      refreshPending = true
      return refreshWork
    }
    refreshWork = (async () => {
      try {
        // Every caller waits for the queued refresh too. A committed local
        // edit must not unlock actions while an older read can replace it.
        do {
          refreshPending = false
          await refreshOnce()
        } while (refreshPending)
      } finally {
        refreshWork = undefined
      }
    })()
    return refreshWork
  }
  async function refreshOnce() {
    const previousOrderIds = new Set(
      records.map((record) => record.snapshot.orderId)
    )
    const data = await send('LIBRARY_QUERY')
    records = data.orders
    productSearchMetadata = new WeakMap()
    jobs = data.jobs
    const tagPreferences = await repository?.getPackingPreferences?.()
    orderTagDefinitions = mergeOrderTags(
      tagPreferences?.orderTags,
      records.flatMap((record) => record.tags)
    )
    productTagDefinitions = mergeOrderTags(
      tagPreferences?.productTags,
      records.flatMap((record) =>
        Object.values(record.productTags || {}).flat()
      )
    )
    annotationEditor?.setDefinitions(orderTagDefinitions)
    productDetailsEditor?.setDefinitions(productTagDefinitions)
    await packing?.reload()
    const present = new Set(records.map((record) => record.snapshot.orderId))
    for (const id of selectedOrders)
      if (!present.has(id)) selectedOrders.delete(id)
    records.sort(
      (a, b) =>
        (b.snapshot.purchasedAt || '').localeCompare(
          a.snapshot.purchasedAt || ''
        ) || b.snapshot.orderId.localeCompare(a.snapshot.orderId)
    )
    renderMonthOptions()
    const oldStatus = $('status-filter').value
    $('status-filter').replaceChildren(
      new Option(t('All statuses'), ''),
      ...[...new Set(records.map((record) => record.snapshot.status))]
        .sort()
        .map((value) => new Option(t(presentOrderStatus(value).label), value))
    )
    $('status-filter').value = oldStatus
    const addedOrderIds = new Set(
      records
        .filter((record) => !previousOrderIds.has(record.snapshot.orderId))
        .map((record) => record.snapshot.orderId)
    )
    if (hasLoadedLibrary && addedOrderIds.size) {
      const addedMatchingOrders = matchingOrders().filter((record) =>
        addedOrderIds.has(record.snapshot.orderId)
      )
      if (addedMatchingOrders.length) {
        orderPage = 0
        for (const { snapshot } of addedMatchingOrders)
          expandedMonths.add(purchaseMonth(snapshot))
      }
      if (filteredRows().some((row) => addedOrderIds.has(row.orderId))) page = 0
    }
    render()
    hasLoadedLibrary = true
  }
  async function openDetails(record) {
    await flushOrderDetails()
    annotationEditor?.destroy()
    annotationEditor = undefined
    const order = record.snapshot,
      content = $('details-content')
    const metadata = node('div', undefined, 'row-meta')
    metadata.append(
      statusBadge(order.status),
      dateBadge(order),
      node(
        'span',
        uiMessage('Version {0} · Checked {1}', {
          0: record.revision,
          1: () => dateLabel(record.lastCheckedAt),
        })
      )
    )
    const identity = node('div', undefined, 'order-detail-identity')
    identity.append(
      orderReference(order.orderId, {
        className: 'order-reference',
      })
    )
    const sellerHeading = node('h2')
    sellerHeading.append(
      copyTextButton(order.sellerName, { label: 'Copy store name' })
    )
    $('order-details-heading').replaceChildren(
      identity,
      sellerHeading,
      metadata
    )
    content.replaceChildren()
    if (order.sellerUnavailable)
      content.append(
        node(
          'p',
          uiMessage(
            'Seller unavailable on the source page. Products and totals are saved. Identify the seller in Prepare packing list before assigning label codes.'
          ),
          'packing-help'
        )
      )
    const totals = node('dl')
    for (const [label, value] of [
      [
        Number(order.totals.grossIncludedCustomization) > 0
          ? 'Original total (includes customization)'
          : 'Original goods',
        order.totals.goodsGross,
      ],
      ...(order.totals.priceIncludedDiscount !== undefined
        ? [
            [
              'Wholesale discount (already in prices)',
              `−${order.totals.priceIncludedDiscount}`,
            ],
          ]
        : []),
      ['Product discounts', order.totals.sourceDiscount],
      [
        Number(order.totals.rowIncludedAdjustment) > 0
          ? 'Order adjustment (already in product discounts)'
          : 'Order adjustment (allocated)',
        order.totals.orderAdjustment,
      ],
      ...(order.totals.orderDiscount !== undefined
        ? [['Order-only discount', `−${order.totals.orderDiscount}`]]
        : []),
      ['Goods after discounts', order.totals.goodsNet],
      ['Shipping', order.totals.shipping],
      ...(order.totals.customizationService !== undefined
        ? [['Customization service', order.totals.customizationService]]
        : []),
      ...(order.totals.redPacketDiscount !== undefined
        ? [
            [
              'Red-packet discount (payment only)',
              `−${order.totals.redPacketDiscount}`,
            ],
          ]
        : []),
      ['Order total', order.totals.payable],
    ])
      totals.append(node('dt', uiMessage(label)), node('dd', `¥ ${value}`))
    content.append(
      totals,
      node(
        'p',
        uiMessage(
          'Price changes not already included in product discounts are allocated in proportion to each product’s value after its own discounts. Wholesale reductions already in prices are counted once. Order-only shop and promotion discounts, shipping, customization services and red-packet payment reductions stay separate. Discounts are totals per row.'
        )
      )
    )
    if (order.foreignCurrencyFeeUnspecified)
      content.append(
        node(
          'p',
          uiMessage(
            'Foreign-currency payment fee: amount not shown by the page. The CNY order total reconciles; no fee amount has been assumed.'
          )
        )
      )
    annotationEditor = mountOrderAnnotations(content, {
      record,
      definitions: orderTagDefinitions,
      draft: annotationDrafts.get(order.orderId),
      onDraft: (value) =>
        value
          ? annotationDrafts.set(order.orderId, value)
          : annotationDrafts.delete(order.orderId),
      save: async (value) => {
        await send('LIBRARY_NOTES', { orderId: order.orderId, ...value })
        await refresh()
      },
    })
    const history = node('details')
    history.append(node('summary', uiMessage('Previous versions')))
    content.append(history)
    $('order-details').showModal()
    const versions = await send('LIBRARY_HISTORY', { orderId: order.orderId })
    if (!versions.length)
      history.append(
        node(
          'p',
          uiMessage(
            'No earlier version yet. A changed order creates a new version automatically.'
          )
        )
      )
    for (const previous of versions) {
      const item = node('div', undefined, 'history-entry')
      item.append(
        node(
          'p',
          uiMessage('{0} · {1} products · Total ¥ {2}', {
            0: () => dateLabel(previous.snapshot.observedAt),
            1: previous.snapshot.items.length,
            2: previous.snapshot.totals.payable,
          })
        )
      )
      for (const old of previous.snapshot.items) {
        const current = order.items.find((row) => row.entryId === old.entryId)
        if (!current)
          item.append(
            node('p', uiMessage('Removed: {0}', { 0: old.description }))
          )
        else {
          const changes = [
            'description',
            'price',
            'quantity',
            'discount',
            'thumbnail',
          ].filter((field) => old[field] !== current[field])
          if (changes.length)
            item.append(
              node(
                'p',
                `${old.description.split('\n')[0]} — ${changes.map((field) => (field === 'thumbnail' ? 'thumbnail changed' : `${field}: ${old[field]} → ${current[field]}`)).join('; ')}`
              )
            )
        }
      }
      history.append(item)
    }
  }
  async function copy(mode) {
    if (copyBusy) return false
    const rows = copyRows()
    if (!rows.length) return false
    copyBusy = true
    updateSelection()
    try {
      if (mode === 'values') {
        await copyTable(rows, { headers: $('include-headers').checked })
        return true
      }
      return await copySourceImages(rows, {
        imagesOnly: mode === 'images',
        headers: $('include-headers').checked,
        loadImage: async (url) => {
          const image = await send('IMAGE_GET', { url })
          return typeof image === 'string' ? image : image.dataUrl
        },
      })
    } finally {
      copyBusy = false
      updateSelection()
    }
  }
  for (const [id, mode] of [
    ['copy-excel', 'all'],
    ['copy-values', 'values'],
    ['copy-images', 'images'],
  ])
    $(id).addEventListener('click', () =>
      copyAction($(id), (progress) => copy(mode, progress))
    )
  for (const [id, full, short, symbol] of [
    ['copy-values', 'Copy values', 'Values', 'copy'],
    ['copy-images', 'Copy images', 'Product photos', 'image'],
    ['copy-excel', 'Copy to Excel', 'Excel cells', 'table'],
    [
      'copy-preparation',
      'Copy preparation columns',
      'Chosen columns',
      'columns',
    ],
    ['copy-group-codes', 'Copy group codes', 'Group codes', 'copy'],
    ['copy-excel-image', 'Copy Excel image', 'Excel image', 'image'],
  ]) {
    bindText($(id), uiMessage(short))
    bindAttribute($(id), 'aria-label', uiMessage(full))
    decorateIcon($(id), symbol)
  }
  const labelCopies = [
    ['copy-barcodes', 'Copy barcode images', 'Barcodes', 'barcode', 'barcode'],
    [
      'copy-carton-marks',
      'Copy carton marks',
      'Carton marks',
      'carton',
      'mark',
    ],
  ].map(([id, full, short, symbol, kind]) => {
    const target = node('button', uiMessage(short))
    target.id = id
    bindAttribute(target, 'aria-label', uiMessage(full))
    decorateIcon(target, symbol)
    target.disabled = true
    target.onclick = () =>
      copyAction(target, async () => {
        const rows = copyRows()
        if (copyBusy || !packing?.canCopyLabels(rows)) return false
        copyBusy = true
        updateSelection()
        try {
          return await packing.copyLabels(kind, rows)
        } finally {
          copyBusy = false
          updateSelection()
        }
      })
    return target
  })
  mountProductCopyActions($('orders-copy-actions'), {
    image: $('copy-excel-image'),
    values: $('copy-values'),
    photos: $('copy-images'),
    cells: $('copy-excel'),
    columns: $('copy-preparation'),
    codes: $('copy-group-codes'),
    barcodes: labelCopies[0],
    marks: labelCopies[1],
    headers: $('include-headers').closest('label'),
  })
  const printButtons = [
    ['print-labels', 'Print labels…', 'barcode', 'barcode'],
    ['print-carton-marks', 'Print carton marks…', 'carton', 'mark'],
  ].map(([id, label, symbol, kind]) => {
    const target = node('button', uiMessage(label))
    target.id = id
    decorateIcon(target, symbol)
    target.disabled = true
    target.onclick = () => {
      const rows = copyRows()
      if (copyBusy || !packing?.canCopyLabels(rows)) return
      // Label validation errors carry their own resolve action.
      packing.printLabels(kind, rows).catch((error) => showErrorNotice(error))
    }
    return target
  })
  const printMenu = mountCopyActions($('orders-print-actions'), {
    label: 'Print…',
    ariaLabel: 'More print formats',
    panelLabel: 'Print formats',
    symbol: 'barcode',
    groups: [{ label: 'Print', actions: printButtons }],
  })
  preparationHelp(
    printMenu.trigger,
    uiMessage(
      'Export print-ready A4 PDFs of labels or carton marks for the selected products.'
    )
  )
  $('copy-excel-image').addEventListener('click', () =>
    copyAction($('copy-excel-image'), async () => {
      if (copyBusy) return false
      const rows = packing.preparedRows(copyRows())
      if (!rows.length) return false
      const badges = packing.getImageBadges()
      copyBusy = true
      updateSelection()
      const abort = new AbortController()
      try {
        return await copyExcelImage(rows, {
          badges,
          renderCartonMark: packing.createCartonMarkRenderer(),
          loadImage: async (url) => {
            const image = await send('IMAGE_GET', { url })
            return typeof image === 'string' ? image : image.dataUrl
          },
          signal: abort.signal,
          errorOptions: packing.errorOptions,
        })
      } finally {
        copyBusy = false
        updateSelection()
      }
    })
  )
  action('all-orders', () => {
    clearTimeout(orderSearchTimer)
    orderSelection.reset()
    productSelection.reset()
    selectedMonths.clear()
    monthAnchor = null
    updateMonthFilter()
    $('order-search').value = ''
    $('date-from').value = ''
    $('date-to').value = ''
    orderPage = 0
    page = 0
    render()
  })
  action('previous-page', () => {
    page--
    renderRows()
  })
  action('next-page', () => {
    page++
    renderRows()
  })
  async function refreshOrders(orderIds) {
    if (!orderIds.length) return
    const frozen = [...orderIds]
    if (
      frozen.length > 1 &&
      !(await confirmScope({
        action: 'Refresh',
        count: frozen.length,
        detail:
          'Each order detail page will be read in turn. You can pause from Activity.',
      }))
    )
      return
    await send('REFRESH_ORDERS', {
      orderIds: frozen,
    })
    await refresh()
    feedback(
      uiMessage('Refresh started. Pause from Activity or the progress bar.')
    )
  }
  action('refresh-orders', () =>
    refreshOrders(scopedOrders().map(({ snapshot }) => snapshot.orderId))
  )
  action('refresh-all', () =>
    refreshOrders(records.map((record) => record.snapshot.orderId))
  )
  action('clear-months', () => {
    selectedMonths.clear()
    monthAnchor = null
    orderSelection.reset()
    productSelection.reset()
    page = orderPage = 0
    updateMonthFilter()
    render()
  })
  action('activity-open', () => {
    activityTracker.markRead(jobs)
    $('activity-drawer').showModal()
    renderJobs()
  })
  action('pause-active', async () => {
    const active = jobs.find((job) => job.state === 'running')
    if (active) await send('IMPORT_PAUSE', { jobId: active.id })
    ;({ jobs } = await send('JOBS_QUERY'))
    renderJobs()
  })
  action('orders-prev', () => {
    orderPage--
    renderOrders()
  })
  action('orders-next', () => {
    orderPage++
    renderOrders()
  })
  action('remove-orders', async () => {
    if (
      !selectedOrders.size ||
      !confirm(
        t(
          'Remove {count} orders and their history from this browser? A saved backup can restore them.',
          { count: selectedOrders.size }
        )
      )
    )
      return
    await send('LIBRARY_REMOVE', { orderIds: [...selectedOrders] })
    orderSelection.reset()
    productSelection.reset()
    await refresh()
    feedback(uiMessage('Selected orders removed from the library.'))
  })
  action('backup', async () => {
    const backup = await send('BACKUP_EXPORT')
    downloadJson(
      backup,
      `1688-orders-${new Date().toISOString().slice(0, 10)}.json`
    )
    feedback(uiMessage('Backup requested. Check your downloads.'))
  })
  action('restore', () => $('backup-file').click())
  $('backup-file').addEventListener('change', async () => {
    try {
      const file = $('backup-file').files[0]
      if (!file) return
      await send('BACKUP_RESTORE', { backup: JSON.parse(await file.text()) })
      await refresh()
      feedback(uiMessage('Backup restored. Existing notes were preserved.'))
    } catch (error) {
      feedback(error.message, true)
    } finally {
      $('backup-file').value = ''
    }
  })
  $('select-rows').addEventListener('click', () => productSelection.selectAll())
  $('clear-rows').addEventListener('click', () => productSelection.clear())
  $('search').addEventListener('input', () => {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      page = 0
      productSelection.reset()
      renderRows()
    }, 150)
  })
  attachSearchSuggestions($('order-search'), () =>
    records.flatMap(({ snapshot, tags }) => {
      const day = purchaseDay(snapshot),
        from = $('date-from').value,
        to = $('date-to').value
      if (selectedMonths.size && !selectedMonths.has(purchaseMonth(snapshot)))
        return []
      if ((from || to) && (!day || (from && day < from) || (to && day > to)))
        return []
      return [
        snapshot.sellerName,
        snapshot.sellerMemberLogin,
        snapshot.orderId,
        ...tags,
      ]
    })
  )
  attachSearchSuggestions($('search'), function* () {
    for (const record of matchingOrders()) {
      const order = record.snapshot
      if (selectedOrders.size && !selectedOrders.has(order.orderId)) continue
      if ($('status-filter').value && order.status !== $('status-filter').value)
        continue
      yield order.sellerName
      yield order.orderId
      for (const item of order.items) {
        if (
          $('changes-only').checked &&
          !record.changedEntryIds.includes(item.entryId)
        )
          continue
        yield item.title || item.description?.split('\n')[0]
        yield item.productNumber
        yield* record.productTags?.[item.entryId] || []
        yield* productSearchTerms(item)
        yield* (packing?.searchText(order.orderId, item.entryId) || '').split(
          /\s+/
        )
      }
    }
  })
  $('order-search').addEventListener('input', () => {
    clearTimeout(orderSearchTimer)
    orderSelection.reset()
    productSelection.reset()
    page = 0
    orderPage = 0
    orderSearchTimer = setTimeout(() => {
      if ($('order-search').value.trim())
        for (const { snapshot } of matchingOrders())
          expandedMonths.add(purchaseMonth(snapshot))
      render()
    }, 150)
  })
  for (const id of ['status-filter', 'changes-only'])
    $(id).addEventListener('change', () => {
      page = 0
      productSelection.reset()
      renderRows()
    })
  for (const id of ['date-from', 'date-to'])
    $(id).addEventListener('change', () => {
      orderSelection.reset()
      productSelection.reset()
      page = 0
      orderPage = 0
      if ($('date-from').value || $('date-to').value)
        for (const { snapshot } of matchingOrders())
          expandedMonths.add(purchaseMonth(snapshot))
      render()
    })
  globalThis.chrome?.runtime?.onMessage?.addListener((message) => {
    // This observer never answers worker requests; an async listener would
    // race the worker by responding with undefined to unrelated messages.
    if (!['LIBRARY_CHANGED', 'IMPORT_PROGRESS'].includes(message.type)) return
    void (async () => {
      try {
        if (message.type === 'LIBRARY_CHANGED') await refresh()
        else {
          ;({ jobs } = await send('JOBS_QUERY'))
          renderJobs()
        }
      } catch (error) {
        feedback(error.message, true)
      }
    })()
  })
  addEventListener('focus', () =>
    refresh().catch((error) => feedback(error.message, true))
  )
  onLanguageChange(() => {
    productSearchMetadata = new WeakMap()
    updateLanguageButtons()
    renderMonthOptions()
    const status = $('status-filter').value
    $('status-filter').replaceChildren(
      new Option(t('All statuses'), ''),
      ...[...new Set(records.map((record) => record.snapshot.status))]
        .sort()
        .map((value) => new Option(t(presentOrderStatus(value).label), value))
    )
    $('status-filter').value = status
    // Only read-only order views are rebuilt. Packing and dialog fields stay mounted.
    jobStructure = ''
    render()
  })
  try {
    await repository?.refreshNamingSuggestions?.()
    packing = await startPackingWorkspace({
      repository: repository || (await openDatabase()),
      getRecords: () => records,
      getRows: copyRows,
      getSelectedRows: () =>
        filteredRows().filter((row) => selectedRows.has(keyFor(row))),
      headers: () => $('include-headers').checked,
      changed: ({ reload = false } = {}) => {
        if (reload) return refresh()
        renderOrders()
        renderRows()
      },
      feedback,
      setPackingExcluded: async (orderId, entryIds, excluded, accountId) => {
        const saved = await send('LIBRARY_PACKING_EXCLUSION', {
          orderId,
          entryIds,
          excluded,
          accountId,
        })
        const acceptSavedExclusion = () => {
          const record = records.find(
            ({ snapshot }) =>
              snapshot.orderId === orderId &&
              snapshot.accountId === (accountId || 'local')
          )
          if (
            record &&
            (record.packingExclusionsUpdatedAt || '') <=
              (saved.packingExclusionsUpdatedAt || '')
          ) {
            record.packingExcludedEntryIds = saved.packingExcludedEntryIds
            record.packingExclusionsUpdatedAt = saved.packingExclusionsUpdatedAt
          }
        }
        acceptSavedExclusion()
        try {
          await refresh()
        } catch (error) {
          // The write already committed. A failed read must not leave the
          // old row action visible or misreport the saved edit as a failure.
          acceptSavedExclusion()
          renderRows()
          showErrorNotice(
            uiMessage(
              'The library could not be refreshed. Your packing selection is saved; retry refreshing to update the rest of the workspace.'
            ),
            {
              key: 'packing-exclusion-refresh',
              title: uiMessage('Packing selection saved'),
              detail: error.message,
              context: { orderId },
              action: { label: uiMessage('Retry'), onClick: refresh },
            }
          )
        }
      },
      onProductDetails: showProductDetails,
      onRefreshOrder: (orderId) => refreshOrders([orderId]),
      loadImage: async (url) => {
        const result = await send('IMAGE_GET', { url })
        return typeof result === 'string' ? result : result.dataUrl
      },
    })
    await refresh()
  } catch (error) {
    feedback(error.message, true)
  }
}

if (globalThis.chrome?.runtime?.id) {
  ;(async () => {
    try {
      await startLibrary(undefined, await openDatabase())
    } catch (error) {
      showErrorNotice(error.message, { key: 'feedback' })
    }
  })()
}
