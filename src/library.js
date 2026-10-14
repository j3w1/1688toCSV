import {
  copyTable,
  copySingleImage,
  pngThumbnail,
  pngImage,
} from './clipboard.js'
import { openDatabase } from './database.js'
import { confirmScope, yieldUI, enableLightDismiss } from './ui.js'
import { startPackingWorkspace } from './packing-workspace.js'
import { createImportReport, importJobView } from './import-report.js'

const $ = (id) => document.getElementById(id)
const keyFor = (row) => `${row.orderId}/${row.entryId}`
const headerPreference = '1688-library-include-headers'
const purchaseDay = (order) => order.purchasedAt?.slice(0, 10) || ''
const purchaseMonth = (order) => purchaseDay(order).slice(0, 7) || 'unknown'
const monthLabel = (month) =>
  month === 'unknown'
    ? 'Date unavailable'
    : new Date(`${month}-01T12:00:00Z`).toLocaleDateString('en-GB', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      })
const purchaseLabel = (order) =>
  purchaseDay(order)
    ? new Date(`${purchaseDay(order)}T12:00:00Z`).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : 'Date unavailable'
const dateLabel = (value) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—'
function node(tag, text, className) {
  const element = document.createElement(tag)
  if (tag === 'dialog') enableLightDismiss(element)
  if (text !== undefined) element.textContent = text
  if (className) element.className = className
  return element
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
  dialog.setAttribute('aria-label', 'Confirm bulk import')
  dialog.append(
    node('h2', `Resume collection of ${count.toLocaleString()} orders?`),
    node(
      'p',
      'This resumes the previous bulk import, using one visible detail tab to collect the remaining orders. Cancel if you only want a few selected orders.'
    )
  )
  const cancel = node('button', 'Cancel'),
    proceed = node(
      'button',
      `Resume ${count.toLocaleString()} orders`,
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
  for (const dialog of document.querySelectorAll('dialog'))
    enableLightDismiss(dialog)
  let records = [],
    jobs = [],
    page = 0,
    loading = false,
    refreshPending = false,
    copyBusy = false,
    showDismissed = false,
    orderPage = 0
  let packing
  const selectedOrders = new Set(),
    selectedRows = new Set(),
    preparedImages = new Map(),
    loadingImages = new Map()
  const imageObserver = new IntersectionObserver(
    async (entries) => {
      for (const entry of entries)
        if (entry.isIntersecting) {
          imageObserver.unobserve(entry.target)
          try {
            entry.target.src = await imageData(entry.target.dataset.thumbnail)
          } catch {
            entry.target.alt = 'Image unavailable offline'
          }
        }
    },
    { rootMargin: '150px' }
  )
  const pageSize = 100
  const copyTimers = new WeakMap()
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
  let jobTimer, searchTimer
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
        ['BACKUP_RESTORE', 'LIBRARY_NOTES', 'LIBRARY_REMOVE'].includes(type)
      ) {
        if (
          type !== 'LIBRARY_NOTES' &&
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
    const close = node('button', '×')
    close.setAttribute('aria-label', 'Dismiss notification')
    close.onclick = () => {
      clearTimeout(feedbackTimer)
      $('feedback').replaceChildren()
    }
    $('feedback').replaceChildren(node('span', message), close)
    $('feedback').className = error ? 'error' : ''
    feedbackTimer = setTimeout(
      () => $('feedback').replaceChildren(),
      error ? 8000 : 4000
    )
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
    if (button.disabled) return
    const label = (button.dataset.copyLabel ||= button.textContent)
    clearTimeout(copyTimers.get(button))
    button.nextElementSibling?.matches('.copy-error') &&
      button.nextElementSibling.remove()
    button.disabled = true
    button.classList.remove('copied', 'copy-failed')
    button.textContent = 'Copying…'
    button.setAttribute('aria-live', 'polite')
    button.setAttribute('aria-busy', 'true')
    try {
      const completed = await handler((message) => {
        button.textContent = message
      })
      if (completed === false) {
        button.textContent = label
        return
      }
      button.textContent = 'Copied'
      button.classList.add('copied')
    } catch (error) {
      button.textContent = 'Try again'
      button.classList.add('copy-failed')
      const message = node('span', error.message, 'copy-error')
      message.setAttribute('role', 'alert')
      button.after(message)
    } finally {
      button.disabled = false
      button.removeAttribute('aria-busy')
      if (button.closest('.copy-actions')) updateSelection()
      copyTimers.set(
        button,
        setTimeout(() => {
          button.textContent = label
          button.classList.remove('copied', 'copy-failed')
        }, 3000)
      )
    }
  }
  function ordersInMonth() {
    const month = $('month-filter').value
    const from = $('date-from').value,
      to = $('date-to').value
    return records.filter((record) => {
      const day = purchaseDay(record.snapshot)
      return (
        (!month || purchaseMonth(record.snapshot) === month) &&
        (!(from || to) || (day && (!from || day >= from) && (!to || day <= to)))
      )
    })
  }
  function filteredRows() {
    const search = $('search').value.trim().toLocaleLowerCase()
    const status = $('status-filter').value
    const changedOnly = $('changes-only').checked
    return ordersInMonth().flatMap((record) => {
      const order = record.snapshot
      if (selectedOrders.size && !selectedOrders.has(order.orderId)) return []
      if (status && order.status !== status) return []
      return order.items
        .filter((item) => {
          if (changedOnly && !record.changedEntryIds.includes(item.entryId))
            return false
          return (
            !search ||
            `${item.description} ${order.sellerName} ${order.orderId} ${record.notes} ${record.tags.join(' ')} ${packing?.searchText(order.orderId, item.entryId) || ''}`
              .toLocaleLowerCase()
              .includes(search)
          )
        })
        .map((item) => ({
          ...item,
          orderId: order.orderId,
          sellerName: order.sellerName,
          record,
        }))
    })
  }
  function copyRows() {
    const rows = filteredRows()
    const selected = rows.filter((row) => selectedRows.has(keyFor(row)))
    return selected.length ? selected : rows
  }
  function updateSelection() {
    packing?.updateActions()
    const rows = filteredRows(),
      selected = rows.filter((row) => selectedRows.has(keyFor(row)))
    $('selection-summary').textContent =
      `${rows.length.toLocaleString()} rows${selected.length ? ` · ${selected.length.toLocaleString()} selected` : ' · all filtered rows will copy'}`
    $('select-rows').checked = !!rows.length && selected.length === rows.length
    $('select-rows').indeterminate =
      !!selected.length && selected.length < rows.length
    for (const id of ['copy-excel', 'copy-values', 'copy-images'])
      $(id).disabled = !rows.length || copyBusy
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
              typeof data === 'string' ? data : data.dataUrl
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
    let lastMonth
    const matching = ordersInMonth()
    orderPage = Math.min(
      orderPage,
      Math.max(0, Math.ceil(matching.length / 50) - 1)
    )
    $('orders-page').textContent =
      `${orderPage + 1} / ${Math.max(1, Math.ceil(matching.length / 50))}`
    $('orders-prev').disabled = orderPage === 0
    $('orders-next').disabled = (orderPage + 1) * 50 >= matching.length
    for (const record of matching.slice(orderPage * 50, (orderPage + 1) * 50)) {
      const order = record.snapshot
      const month = purchaseMonth(order)
      if (month !== lastMonth)
        list.append(node('h3', monthLabel(month), 'order-month'))
      lastMonth = month
      const card = node(
        'div',
        undefined,
        `order-card${selectedOrders.has(order.orderId) ? ' active' : ''}`
      )
      const check = node('input')
      check.type = 'checkbox'
      check.checked = selectedOrders.has(order.orderId)
      check.setAttribute('aria-label', `Select order ${order.orderId}`)
      check.addEventListener('change', () => {
        if (check.checked) selectedOrders.add(order.orderId)
        else selectedOrders.delete(order.orderId)
        selectedRows.clear()
        page = 0
        render()
      })
      const button = node('button', order.sellerName)
      button.append(
        node(
          'small',
          `…${order.orderId.slice(-8)} · ${order.items.length} products`
        )
      )
      button.append(node('small', order.status))
      button.append(node('small', purchaseLabel(order), 'purchase-date'))
      button.addEventListener('click', () =>
        openDetails(record).catch((error) => feedback(error.message, true))
      )
      const badge = node(
        'span',
        record.revision > 1 ? 'Updated' : 'Saved',
        `badge${record.revision > 1 ? ' changed' : ''}`
      )
      card.append(check, button, badge)
      list.append(card)
    }
    $('refresh-orders').textContent = selectedOrders.size
      ? `Refresh ${selectedOrders.size}`
      : 'Refresh selected'
    const running = jobs.some((job) => job.state === 'running')
    $('refresh-orders').disabled = !selectedOrders.size || running
    $('refresh-all').disabled = !records.length || running
    $('refresh-filtered').disabled = !matching.length || running
    $('refresh-filtered').textContent =
      `Refresh ${matching.length} matching orders`
    $('remove-orders').disabled = !selectedOrders.size
  }
  function renderRows() {
    const rows = filteredRows()
    const maxPage = Math.max(0, Math.ceil(rows.length / pageSize) - 1)
    page = Math.min(page, maxPage)
    imageObserver.disconnect()
    const body = $('sheet-body')
    body.replaceChildren()
    let previousOrder
    for (const row of rows.slice(page * pageSize, (page + 1) * pageSize)) {
      const changed = row.record.changedEntryIds.includes(row.entryId)
      const tr = node('tr', undefined, changed ? 'changed-row' : '')
      if (previousOrder && previousOrder !== row.orderId)
        tr.classList.add('order-boundary')
      previousOrder = row.orderId
      const selection = node('td', undefined, 'select-col')
      const check = node('input')
      check.type = 'checkbox'
      check.checked = selectedRows.has(keyFor(row))
      check.setAttribute('aria-label', `Select product ${row.entryId}`)
      check.addEventListener('change', () => {
        if (check.checked) selectedRows.add(keyFor(row))
        else selectedRows.delete(keyFor(row))
        updateSelection()
      })
      selection.append(check)
      const thumb = node('td', undefined, 'thumb-cell')
      const image = node('img')
      image.width = 54
      image.height = 54
      image.loading = 'lazy'
      image.alt = row.description.split('\n')[0]
      // Only image URLs are assigned, never source HTML or arbitrary protocols.
      image.dataset.thumbnail = row.thumbnail
      if (preparedImages.has(row.thumbnail))
        image.src = preparedImages.get(row.thumbnail)
      else imageObserver.observe(image)
      const imageButton = node('button', 'Copy image')
      imageButton.addEventListener('click', () =>
        copyAction(imageButton, async () => {
          const original = await send('IMAGE_GET', { url: row.thumbnail })
          await copySingleImage(
            typeof original === 'string' ? original : original.dataUrl
          )
        })
      )
      thumb.append(image, imageButton)
      const description = node('td', undefined, 'description-cell')
      description.append(
        node('div', row.description, 'product-title'),
        node(
          'small',
          `${row.sellerName} · …${row.orderId.slice(-8)} · ${purchaseLabel(row.record.snapshot)}${changed ? ' · Changed since previous version' : ''}`
        )
      )
      packing?.decorateRow(description, row)
      const amount = (value) =>
        Number(value).toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 4,
        })
      const discount = node('td', amount(row.discount), 'numeric discount-cell')
      if (Number(row.allocatedDiscount))
        discount.append(
          node('small', `incl. ${row.allocatedDiscount} allocated`)
        )
      tr.append(
        selection,
        thumb,
        description,
        node('td', amount(row.price), 'numeric'),
        node(
          'td',
          Number(row.quantity).toLocaleString('en-US', {
            maximumFractionDigits: 4,
          }),
          'numeric'
        ),
        discount
      )
      body.append(tr)
    }
    $('empty-state').hidden = !!records.length
    document.querySelector('.table-scroll').hidden = !records.length
    $('sheet-title').textContent = selectedOrders.size
      ? `${selectedOrders.size} selected order${selectedOrders.size === 1 ? '' : 's'}`
      : 'All products'
    $('page-label').textContent = `${page + 1} / ${maxPage + 1}`
    $('previous-page').disabled = page === 0
    $('next-page').disabled = page === maxPage
    updateSelection()
  }
  function renderJobs() {
    const running = jobs.some((job) => job.state === 'running')
    $('refresh-orders').disabled = !selectedOrders.size || running
    $('refresh-all').disabled = !records.length || running
    $('refresh-filtered').disabled = !ordersInMonth().length || running
    $('jobs').replaceChildren()
    const sorted = [...jobs].sort((a, b) =>
      (b.updatedAt || '').localeCompare(a.updatedAt || '')
    )
    const visible = sorted.filter(
      (job) => !job.dismissedAt || job.state === 'running' || showDismissed
    )
    $('jobs').hidden = !jobs.length
    $('activity-empty').hidden = !!jobs.length
    const active = jobs.find((job) => job.state === 'running')
    $('activity-count').textContent = active
      ? '●'
      : jobs.some((job) => job.state !== 'completed' && !job.dismissedAt)
        ? '!'
        : ''
    $('active-job').hidden = !active
    if (active)
      $('active-job-text').textContent =
        `Reading orders · ${active.done ?? active.orders?.filter((order) => order.state === 'done').length ?? 0} saved / ${active.total || active.discovered || active.orders?.length || 0} orders`
    const heading = node('div', undefined, 'jobs-heading')
    heading.append(node('h2', 'Imports'))
    const controls = node('div', undefined, 'job-actions')
    if (jobs.some((job) => !job.dismissedAt && job.state !== 'running')) {
      const dismissAll = node('button', 'Dismiss all', 'text-button')
      dismissAll.title =
        'Hide finished and paused import messages. Saved orders stay in your library.'
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
        showDismissed ? 'Hide dismissed' : 'Show dismissed',
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
      const done =
        job.done ??
        job.orders?.filter((order) => order.state === 'done').length ??
        0
      const failed =
        job.failed ??
        job.orders?.filter((order) => order.state === 'failed').length ??
        0
      details.append(
        node(
          'strong',
          job.state === 'running'
            ? job.phase === 'scan'
              ? 'Finding your orders…'
              : 'Collecting product details…'
            : job.state.replaceAll('-', ' ')
        )
      )
      details.append(
        node(
          'p',
          `${done} saved · ${job.discovered ?? job.orders?.length ?? 0} discovered${failed ? ` · ${failed} need attention` : ''}${job.page ? ` · list page ${job.page}` : ''}`
        )
      )
      if (job.error) details.append(node('p', job.error))
      for (const item of (job.orders || [])
        .filter((item) => item.state === 'failed')
        .slice(0, 3))
        details.append(
          node(
            'p',
            `…${item.orderId.slice(-8)}: ${item.error || 'Could not read order'}`
          )
        )
      container.append(details)
      const actions = node('div', undefined, 'job-actions')
      const report = node('button', 'Save import report', 'text-button')
      report.title =
        'Save every order status and error for this import. This does not start or retry any orders.'
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
            'Import report requested. Check your downloads. Use Data → Back up to save the product database too.'
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
          job.state === 'running' ? 'Pause' : 'Resume / retry'
        )
        button.addEventListener('click', async () => {
          button.disabled = true
          try {
            if (job.state !== 'running' && !(await confirmBulkResume(job)))
              return
            button.textContent =
              job.state === 'running' ? 'Pausing…' : 'Resuming…'
            feedback(
              job.state === 'running'
                ? 'Pausing import…'
                : 'Resuming import. One visible detail tab will read the remaining orders.'
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
            button.textContent =
              job.state === 'running' ? 'Pause' : 'Resume / retry'
          }
        })
        actions.append(button)
      }
      if (job.state !== 'running' && !job.dismissedAt) {
        const dismiss = node('button', 'Dismiss', 'text-button')
        dismiss.title =
          'Hide this message without removing saved orders. Find it later under Show dismissed.'
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
    clearTimeout(jobTimer)
    if (jobs.some((job) => job.state === 'running'))
      jobTimer = setTimeout(async () => {
        try {
          ;({ jobs } = await send('JOBS_QUERY'))
          renderJobs()
        } catch (error) {
          feedback(error.message, true)
        }
      }, 2000)
  }
  function render() {
    $('order-count').textContent = records.length.toLocaleString()
    $('product-count').textContent = records
      .reduce((sum, record) => sum + record.snapshot.items.length, 0)
      .toLocaleString()
    $('changed-count').textContent = records
      .filter((record) => record.revision > 1)
      .length.toLocaleString()
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
  async function refresh() {
    if (loading) {
      refreshPending = true
      return
    }
    loading = true
    try {
      const data = await send('LIBRARY_QUERY')
      records = data.orders
      jobs = data.jobs
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
      const oldMonth = $('month-filter').value
      const months = [
        ...new Set(records.map((record) => purchaseMonth(record.snapshot))),
      ]
      $('month-filter').replaceChildren(
        new Option('All purchase months', ''),
        ...months.map((month) => new Option(monthLabel(month), month))
      )
      $('month-filter').value = months.includes(oldMonth) ? oldMonth : ''
      const oldStatus = $('status-filter').value
      $('status-filter').replaceChildren(
        new Option('All statuses', ''),
        ...[...new Set(records.map((record) => record.snapshot.status))]
          .sort()
          .map((value) => new Option(value, value))
      )
      $('status-filter').value = oldStatus
      render()
    } finally {
      loading = false
    }
    if (refreshPending) {
      refreshPending = false
      await refresh()
    }
  }
  async function openDetails(record) {
    const order = record.snapshot,
      content = $('details-content')
    content.replaceChildren(
      node('p', `ORDER ${order.orderId}`, 'eyebrow'),
      node('h2', order.sellerName),
      node(
        'p',
        `${order.status} · Purchased ${purchaseLabel(order)} · Version ${record.revision} · Checked ${dateLabel(record.lastCheckedAt)}`
      )
    )
    const link = node('a', 'Open original order ↗')
    link.href = order.sourceUrl
    link.target = '_blank'
    link.rel = 'noreferrer'
    content.append(link)
    const totals = node('dl')
    for (const [label, value] of [
      ['Original goods', order.totals.goodsGross],
      ['Product discounts', order.totals.sourceDiscount],
      ['Order adjustment (allocated)', order.totals.orderAdjustment],
      ...(order.totals.orderDiscount !== undefined
        ? [['Shop discount (order only)', `−${order.totals.orderDiscount}`]]
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
      totals.append(node('dt', label), node('dd', `¥ ${value}`))
    content.append(
      totals,
      node(
        'p',
        'Order-wide price changes are allocated in proportion to each product’s value after its own discounts. Order-only shop discounts, shipping, customization services and red-packet payment reductions stay separate. Discounts are totals per row.'
      )
    )
    if (order.foreignCurrencyFeeUnspecified)
      content.append(
        node(
          'p',
          'Foreign-currency payment fee: amount not shown by the page. The CNY order total reconciles; no fee amount has been assumed.'
        )
      )
    const notesLabel = node('label', 'Your notes'),
      notes = node('textarea')
    notes.id = 'order-notes'
    notesLabel.htmlFor = notes.id
    notes.value = record.notes
    const tagsLabel = node('label', 'Tags (comma separated)'),
      tags = node('input')
    tags.type = 'text'
    tags.id = 'order-tags'
    tagsLabel.htmlFor = tags.id
    tags.value = record.tags.join(', ')
    const save = node('button', 'Save notes', 'primary')
    save.addEventListener('click', async () => {
      try {
        await send('LIBRARY_NOTES', {
          orderId: order.orderId,
          notes: notes.value,
          tags: tags.value
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean),
        })
        $('order-details').close()
        await refresh()
        feedback('Notes saved. Source refreshes will preserve them.')
      } catch (error) {
        feedback(error.message, true)
      }
    })
    content.append(notesLabel, notes, tagsLabel, tags, save)
    const history = node('details')
    history.append(node('summary', 'Previous versions'))
    content.append(history)
    $('order-details').showModal()
    const versions = await send('LIBRARY_HISTORY', { orderId: order.orderId })
    if (!versions.length)
      history.append(
        node(
          'p',
          'No earlier version yet. A changed order creates a new version automatically.'
        )
      )
    for (const previous of versions) {
      const item = node('div', undefined, 'history-entry')
      item.append(
        node(
          'p',
          `${dateLabel(previous.snapshot.observedAt)} · ${previous.snapshot.items.length} products · Total ¥ ${previous.snapshot.totals.payable}`
        )
      )
      for (const old of previous.snapshot.items) {
        const current = order.items.find((row) => row.entryId === old.entryId)
        if (!current) item.append(node('p', `Removed: ${old.description}`))
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
  async function copy(mode, progress) {
    if (copyBusy) return
    let rows = copyRows()
    if (!rows.length) return false
    const count = new Set(rows.map((row) => row.orderId)).size
    if (
      rows.length > 1 &&
      !(await confirmScope({
        action: 'Copy',
        count: rows.length,
        unit: mode === 'values' ? 'product rows' : 'product images',
        detail: `From ${count} orders. ${mode === 'values' ? '' : 'Original images will be prepared for Excel.'}`,
      }))
    )
      return false
    if (mode !== 'values' && rows.length > 20) {
      const chosen = await packing.chooseImageBatch(rows)
      if (!chosen) return false
      rows = chosen
    }
    copyBusy = true
    updateSelection()
    try {
      const images = []
      const originals = new Map()
      if (mode !== 'values') {
        let imageBytes = 0
        for (let index = 0; index < rows.length; index++) {
          if (index % 10 === 0)
            progress(
              `Preparing images ${index + 1}–${Math.min(rows.length, index + 10)} of ${rows.length}…`
            )
          const url = rows[index].thumbnail
          if (!originals.has(url)) {
            const original = await send('IMAGE_GET', { url })
            originals.set(
              url,
              await pngImage(
                typeof original === 'string' ? original : original.dataUrl
              )
            )
          }
          // Every row embeds the PNG again in clipboard HTML, even when its
          // conversion is shared with another variant of the same product.
          imageBytes += originals.get(url).length * 2
          if (imageBytes > 32 * 1024 * 1024) {
            const batchSize = Math.max(
              1,
              Math.floor(((index + 1) * 32 * 1024 * 1024) / imageBytes)
            )
            originals.clear()
            images.length = 0
            if (rows.length === 1)
              throw new Error(
                'This photo exceeds the clipboard memory budget. Copy its values separately.'
              )
            const batch = await packing.chooseImageBatch(
              rows,
              Math.min(rows.length - 1, batchSize)
            )
            if (!batch) return false
            rows = batch
            index = -1
            imageBytes = 0
            continue
          }
          images.push(originals.get(url))
          await yieldUI()
        }
      }
      await copyTable(rows, {
        images,
        imagesOnly: mode === 'images',
        headers: $('include-headers').checked,
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
  action('all-orders', () => {
    selectedOrders.clear()
    selectedRows.clear()
    $('month-filter').value = ''
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
    feedback('Refresh started. Pause from Activity or the progress bar.')
  }
  action('refresh-orders', () => refreshOrders([...selectedOrders]))
  action('refresh-all', () =>
    refreshOrders(records.map((record) => record.snapshot.orderId))
  )
  action('refresh-filtered', () =>
    refreshOrders(ordersInMonth().map((record) => record.snapshot.orderId))
  )
  action('activity-open', () => $('activity-drawer').showModal())
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
        `Remove ${selectedOrders.size} orders and their history from this browser? A saved backup can restore them.`
      )
    )
      return
    await send('LIBRARY_REMOVE', { orderIds: [...selectedOrders] })
    selectedOrders.clear()
    selectedRows.clear()
    await refresh()
    feedback('Selected orders removed from the library.')
  })
  action('backup', async () => {
    const backup = await send('BACKUP_EXPORT')
    downloadJson(
      backup,
      `1688-orders-${new Date().toISOString().slice(0, 10)}.json`
    )
    feedback('Backup requested. Check your downloads.')
  })
  action('restore', () => $('backup-file').click())
  $('backup-file').addEventListener('change', async () => {
    try {
      const file = $('backup-file').files[0]
      if (!file) return
      await send('BACKUP_RESTORE', { backup: JSON.parse(await file.text()) })
      await refresh()
      feedback('Backup restored. Existing notes were preserved.')
    } catch (error) {
      feedback(error.message, true)
    } finally {
      $('backup-file').value = ''
    }
  })
  $('select-rows').addEventListener('change', () => {
    for (const row of filteredRows())
      if ($('select-rows').checked) selectedRows.add(keyFor(row))
      else selectedRows.delete(keyFor(row))
    renderRows()
  })
  $('search').addEventListener('input', () => {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      page = 0
      renderRows()
    }, 150)
  })
  for (const id of ['status-filter', 'changes-only'])
    $(id).addEventListener('change', () => {
      page = 0
      renderRows()
    })
  for (const id of ['month-filter', 'date-from', 'date-to'])
    $(id).addEventListener('change', () => {
      selectedOrders.clear()
      selectedRows.clear()
      page = 0
      orderPage = 0
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
  try {
    packing = await startPackingWorkspace({
      repository: repository || (await openDatabase()),
      getRecords: () => records,
      getRows: copyRows,
      headers: () => $('include-headers').checked,
      changed: () => {
        renderRows()
      },
      feedback,
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
      $('feedback').textContent = error.message
      $('feedback').className = 'error'
    }
  })()
}
