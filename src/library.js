import { copyTable, copySingleImage, pngThumbnail } from './clipboard.js'
import { openDatabase } from './database.js'

const $ = (id) => document.getElementById(id)
const keyFor = (row) => `${row.orderId}/${row.entryId}`
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
  if (text !== undefined) element.textContent = text
  if (className) element.className = className
  return element
}

export async function startLibrary(
  transport = (message) => chrome.runtime.sendMessage(message),
  repository = null
) {
  let records = [],
    jobs = [],
    page = 0,
    loading = false,
    refreshPending = false,
    copyBusy = false
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
  let jobTimer, searchTimer
  async function send(type, data = {}) {
    // Extension pages share IndexedDB with the worker. Large libraries and
    // image backups must not cross Chrome's runtime message size limit.
    if (repository) {
      if (type === 'LIBRARY_QUERY')
        return {
          orders: await repository.listOrders(),
          jobs: await repository.listJobs(),
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
  function feedback(message, error = false) {
    $('feedback').textContent = message
    $('feedback').className = error ? 'error' : ''
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
  function filteredRows() {
    const search = $('search').value.trim().toLocaleLowerCase()
    const status = $('status-filter').value
    const changedOnly = $('changes-only').checked
    return records.flatMap((record) => {
      const order = record.snapshot
      if (selectedOrders.size && !selectedOrders.has(order.orderId)) return []
      if (status && order.status !== status) return []
      return order.items
        .filter((item) => {
          if (changedOnly && !record.changedEntryIds.includes(item.entryId))
            return false
          return (
            !search ||
            `${item.description} ${order.sellerName} ${order.orderId} ${record.notes} ${record.tags.join(' ')}`
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
    for (const record of records) {
      const order = record.snapshot
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
      : 'Refresh all'
    $('refresh-orders').disabled = !records.length
    $('remove-orders').disabled = !selectedOrders.size
  }
  function renderRows() {
    const rows = filteredRows()
    const maxPage = Math.max(0, Math.ceil(rows.length / pageSize) - 1)
    page = Math.min(page, maxPage)
    imageObserver.disconnect()
    const body = $('sheet-body')
    body.replaceChildren()
    for (const row of rows.slice(page * pageSize, (page + 1) * pageSize)) {
      const changed = row.record.changedEntryIds.includes(row.entryId)
      const tr = node('tr', undefined, changed ? 'changed-row' : '')
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
      imageButton.addEventListener('click', async () => {
        try {
          const original = await send('IMAGE_GET', { url: row.thumbnail })
          await copySingleImage(
            typeof original === 'string' ? original : original.dataUrl
          )
          feedback('Image copied. Paste it into Excel.')
        } catch (error) {
          feedback(error.message, true)
        }
      })
      thumb.append(image, imageButton)
      const description = node('td', undefined, 'description-cell')
      description.append(
        node('div', row.description, 'product-title'),
        node(
          'small',
          `${row.sellerName} · …${row.orderId.slice(-8)}${changed ? ' · Changed since previous version' : ''}`
        )
      )
      const discount = node('td', row.discount, 'numeric discount-cell')
      if (Number(row.allocatedDiscount))
        discount.append(
          node('small', `incl. ${row.allocatedDiscount} allocated`)
        )
      tr.append(
        selection,
        thumb,
        description,
        node('td', row.price, 'numeric'),
        node('td', row.quantity, 'numeric'),
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
    $('jobs').replaceChildren()
    const visible = jobs.slice(-5).reverse()
    $('jobs').hidden = !visible.length
    for (const job of visible) {
      const container = node('div', undefined, 'job'),
        details = node('div')
      const done =
        job.orders?.filter((order) => order.state === 'done').length || 0
      const failed =
        job.orders?.filter((order) => order.state === 'failed').length || 0
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
          `${done} saved · ${job.orders?.length || 0} discovered${failed ? ` · ${failed} need attention` : ''}${job.page ? ` · list page ${job.page}` : ''}`
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
      if (job.state !== 'completed') {
        const button = node(
          'button',
          job.state === 'running' ? 'Pause' : 'Resume / retry'
        )
        button.addEventListener('click', async () => {
          try {
            await send(
              job.state === 'running' ? 'IMPORT_PAUSE' : 'IMPORT_RESUME',
              { jobId: job.id }
            )
            await refresh()
          } catch (error) {
            feedback(error.message, true)
          }
        })
        container.append(button)
      }
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
      const present = new Set(records.map((record) => record.snapshot.orderId))
      for (const id of selectedOrders)
        if (!present.has(id)) selectedOrders.delete(id)
      records.sort((a, b) =>
        b.snapshot.orderId.localeCompare(a.snapshot.orderId)
      )
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
        `${order.status} · Version ${record.revision} · Checked ${dateLabel(record.lastCheckedAt)}`
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
      ['Goods after discounts', order.totals.goodsNet],
      ['Shipping', order.totals.shipping],
      ['Order total', order.totals.payable],
    ])
      totals.append(node('dt', label), node('dd', `¥ ${value}`))
    content.append(
      totals,
      node(
        'p',
        'Order-wide reductions are allocated in proportion to each product’s value after its own discounts. Shipping stays separate. Discounts are totals per row.'
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
  async function copy(mode) {
    if (copyBusy) return
    const rows = copyRows()
    copyBusy = true
    updateSelection()
    try {
      const images = []
      if (mode !== 'values') {
        for (let index = 0; index < rows.length; index++) {
          if (index % 10 === 0)
            feedback(
              `Preparing images ${index + 1}–${Math.min(rows.length, index + 10)} of ${rows.length}…`
            )
          images.push(await imageData(rows[index].thumbnail))
        }
      }
      await copyTable(rows, {
        images,
        imagesOnly: mode === 'images',
        headers: $('include-headers').checked,
      })
      feedback(
        `${rows.length} ${mode === 'images' ? 'separate pictures' : 'product rows'} copied. Paste into Excel${mode === 'values' ? ' (the Thumbnail column is left blank)' : ''}.`
      )
    } finally {
      copyBusy = false
      updateSelection()
    }
  }
  action('copy-excel', () => copy('all'))
  action('copy-values', () => copy('values'))
  action('copy-images', () => copy('images'))
  action('all-orders', () => {
    selectedOrders.clear()
    selectedRows.clear()
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
  action('refresh-orders', async () => {
    await send('REFRESH_ORDERS', {
      orderIds: selectedOrders.size
        ? [...selectedOrders]
        : records.map((record) => record.snapshot.orderId),
    })
    await refresh()
    feedback('Refresh started. You can pause it from the progress bar.')
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
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(backup)], { type: 'application/json' })
    )
    const a = node('a')
    a.href = url
    a.download = `1688-orders-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 60000)
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
  globalThis.chrome?.runtime?.onMessage?.addListener((message) => {
    if (message.type === 'LIBRARY_CHANGED')
      refresh().catch((error) => feedback(error.message, true))
  })
  addEventListener('focus', () =>
    refresh().catch((error) => feedback(error.message, true))
  )
  try {
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
