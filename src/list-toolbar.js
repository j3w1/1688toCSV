// Page UI only. Reads and job operations stay in the content/worker adapters.
export function mountListToolbar(document, { readList, send }) {
  const host = document.createElement('div')
  const root = host.attachShadow({ mode: 'open' })
  const make = (tag, text) => {
    const el = document.createElement(tag)
    if (text !== undefined) el.textContent = text
    return el
  }
  const style = make('style')
  style.textContent = `:host{all:initial;position:fixed;bottom:14px;right:14px;z-index:2147483647;display:block;max-width:calc(100vw - 28px)}aside{font:12px/1.5 system-ui,sans-serif;color:#344330;background:#fcfcf8;border:1px solid #d6dfcc;border-radius:12px;box-shadow:0 5px 25px #19351b24;padding:13px;width:360px;max-width:calc(100vw - 28px);box-sizing:border-box}strong{font-size:12px;display:block;margin-bottom:8px}nav,.actions{display:flex;gap:6px;flex-wrap:wrap}button{font:inherit;border:1px solid #d6dfcc;border-radius:6px;background:white;color:#475b3c;padding:8px 10px;cursor:pointer}.primary{background:#dd4d23;color:white;border-color:#dd4d23}button:disabled{opacity:.5;cursor:default}button:focus-visible,summary:focus-visible{outline:3px solid #598bd0;outline-offset:2px}p{margin:8px 0;overflow-wrap:anywhere;font-size:11px}p:empty,[hidden]{display:none!important}.error{color:#a13f24}details{margin-top:10px}summary{cursor:pointer;font-size:11px;color:#687761}.confirm,.progress{margin-top:10px;padding-top:10px;border-top:1px solid #d6dfcc}.confirm{border:1px solid #dfbd85;background:#fff7e8;padding:10px;border-radius:8px}.confirm strong{font-size:12px}.secondary{font-size:11px}a{color:inherit}@media(prefers-color-scheme:dark){aside{color:#e0e8db;background:#202620;border-color:#43513e}button{color:#d8e4d0;background:#2b3429;border-color:#4b5945}.primary{background:#c64522;color:#fff;border-color:#c64522}summary{color:#b4c4aa}.confirm{background:#352d1f;border-color:#71603c}.error{color:#ffb6a6}.progress{border-color:#43513e}}`
  const aside = make('aside')
  aside.setAttribute('aria-label', '1688 order library')
  const nav = make('nav')
  const feedback = make('p')
  feedback.setAttribute('role', 'status')
  const progress = make('section')
  progress.className = 'progress'
  progress.hidden = true
  const progressText = make('p')
  progressText.setAttribute('aria-live', 'polite')
  const options = make('details')
  options.append(make('summary', 'More import options'))
  const confirmation = make('section')
  confirmation.className = 'confirm'
  confirmation.hidden = true
  confirmation.setAttribute('aria-label', 'Confirm bulk import')
  const confirmationTitle = make('strong')
  const confirmationText = make('p')
  const confirmationActions = make('div')
  confirmationActions.className = 'actions'
  confirmation.append(confirmationTitle, confirmationText, confirmationActions)
  let disposed = false,
    statusTimer,
    querying = false,
    latestJob,
    confirmAction

  function report(text, error = false) {
    feedback.textContent = text
    feedback.className = error ? 'error' : ''
  }
  function button(parent, label, task, className = '') {
    const b = make('button', label)
    b.className = className
    b.addEventListener('click', async () => {
      b.disabled = true
      try {
        await task()
      } catch (error) {
        report(error.message, true)
      } finally {
        b.disabled = false
        applyRunningState()
      }
    })
    parent.append(b)
    return b
  }
  function hideConfirmation() {
    confirmation.hidden = true
    confirmAction = undefined
  }
  function showConfirmation(
    title,
    text,
    label,
    action,
    accessibleLabel = 'Confirm bulk import'
  ) {
    confirmationTitle.textContent = title
    confirmationText.textContent = text
    confirmButton.textContent = label
    confirmAction = action
    confirmation.setAttribute('aria-label', accessibleLabel)
    confirmation.hidden = false
    cancelButton.focus()
  }
  const confirmButton = button(
    confirmationActions,
    'Confirm import',
    async () => {
      const action = confirmAction
      hideConfirmation()
      if (action) await action()
    }
  )
  const cancelButton = button(confirmationActions, 'Cancel', async () => {
    hideConfirmation()
    report('Import cancelled.')
    selected.focus()
  })
  confirmation.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      hideConfirmation()
      selected.focus()
    }
  })

  const selected = button(
    nav,
    'Import selected',
    async () => {
      hideConfirmation()
      const list = readList()
      const ids = list.orders
        .filter((order) => order.selected)
        .map((order) => order.orderId)
      if (!ids.length)
        throw new Error('Select order checkboxes on this page first.')
      const startSelected = async () => {
        const current = readList()
        const currentIds = current.orders
          .filter((order) => order.selected)
          .map((order) => order.orderId)
        if (
          current.filterKey !== list.filterKey ||
          current.total !== list.total ||
          current.pageSize !== list.pageSize ||
          currentIds.length !== ids.length ||
          currentIds.some((id) => !ids.includes(id))
        )
          throw new Error(
            'The filters or selected orders changed. Review the selection again.'
          )
        latestJob = await send('IMPORT_START', {
          scope: 'selected',
          orderIds: ids,
          expectedScope: {
            filterKey: list.filterKey,
            total: list.total,
            pageSize: list.pageSize,
          },
        })
        report(
          `Starting ${ids.length} selected orders. A visible detail tab will open to read them.`
        )
        await refresh()
      }
      if (ids.length > 1)
        showConfirmation(
          `Import ${ids.length.toLocaleString()} selected orders?`,
          'Only these selected orders will be read, one at a time in a visible detail tab.',
          `Import ${ids.length.toLocaleString()} selected orders`,
          startSelected,
          'Confirm selected import'
        )
      else await startSelected()
    },
    'primary'
  )
  button(nav, 'Spreadsheet ↗', async () => {
    address.hidden = false
    openHere.hidden = false
    try {
      await send('OPEN_LIBRARY')
      report(
        'Spreadsheet tab requested. If it is not visible, choose Open spreadsheet here or use the address below.'
      )
    } catch (error) {
      report(
        `The spreadsheet could not open in a new tab. Your saved orders are kept. Choose Open spreadsheet here or use the address below. ${error.message}`,
        true
      )
    }
  })
  const address = make('input')
  address.type = 'text'
  address.readOnly = true
  address.hidden = true
  address.setAttribute('aria-label', 'Spreadsheet address')
  address.style.cssText =
    'box-sizing:border-box;width:100%;margin-top:8px;font:11px system-ui;padding:8px'
  // The caller owns the extension URL; no page-provided URL is used here.
  address.value = globalThis.chrome?.runtime?.getURL?.('library.html') || ''
  address.addEventListener('click', () => address.select())
  const fallbackActions = make('div')
  fallbackActions.className = 'actions'
  const openHere = button(
    fallbackActions,
    'Open spreadsheet here',
    async () => {
      await send('OPEN_LIBRARY_HERE')
      report('Opening the spreadsheet in this tab…')
    }
  )
  openHere.hidden = true
  const all = button(
    options,
    'Import all matching…',
    async () => {
      const list = readList()
      if (!list.total)
        throw new Error('There are no matching orders to import.')
      const pages = Math.ceil(list.total / list.pageSize)
      showConfirmation(
        `Import ${list.total.toLocaleString()} orders across ${pages} pages?`,
        'This scans every page of the current filters, then reads each full order in a visible tab. For just a few orders, cancel and use Import selected.',
        `Import all ${list.total.toLocaleString()} orders`,
        async () => {
          const current = readList()
          if (
            current.filterKey !== list.filterKey ||
            current.total !== list.total ||
            current.pageSize !== list.pageSize
          )
            throw new Error(
              'The filters or order count changed. Review the bulk import again.'
            )
          latestJob = await send('IMPORT_START', {
            scope: 'all',
            expectedScope: {
              filterKey: list.filterKey,
              total: list.total,
              pageSize: list.pageSize,
            },
          })
          options.open = false
          report(
            'Bulk import started. Keep this list open; use Pause to stop collection.'
          )
          await refresh()
        }
      )
    },
    'secondary'
  )
  const pause = button(progress, 'Pause import', async () => {
    if (!latestJob) return
    const job = latestJob
    const total = Math.max(
      job.total || 0,
      job.discovered || job.orders?.length || 0
    )
    const completed =
      job.completed ??
      job.orders?.filter((order) => order.state === 'done').length ??
      0
    const remaining = job.remaining ?? Math.max(0, total - completed)
    const bulk =
      job.scope === 'all' || job.phase === 'scan' || job.page > 0 || total > 10
    const resume = async () => {
      report('Resuming import…')
      await send('IMPORT_RESUME', { jobId: job.id })
      await refresh()
    }
    if (job.state === 'running') {
      await send('IMPORT_PAUSE', { jobId: job.id })
      report('Import paused. Saved orders are kept.')
      await refresh()
    } else if (bulk || remaining > 1) {
      showConfirmation(
        bulk ? 'Resume the bulk import?' : 'Resume the selected import?',
        `This job covers ${total.toLocaleString()} orders. ${completed.toLocaleString()} saved; ${remaining.toLocaleString()} remaining. Resume only if you want to continue that collection.`,
        `Resume ${remaining.toLocaleString()} remaining orders`,
        resume,
        bulk ? 'Confirm bulk import' : 'Confirm selected import'
      )
    } else await resume()
  })
  progress.prepend(progressText)
  function applyRunningState() {
    const running = latestJob?.state === 'running'
    selected.disabled = running
    all.disabled = running
    openHere.disabled = running
    openHere.title = running
      ? 'Pause or finish this import before leaving the order list.'
      : ''
  }
  async function refresh() {
    if (querying || disposed) return
    querying = true
    clearTimeout(statusTimer)
    try {
      const { jobs } = await send('IMPORT_STATUS')
      if (disposed) return
      latestJob = jobs.find((job) => job.state === 'running') || jobs[0]
      progress.hidden = !latestJob
      if (latestJob) {
        const job = latestJob,
          count = job.discovered ?? job.orders?.length ?? 0
        const remaining =
          job.remaining ??
          Math.max(0, Math.max(job.total || 0, count) - (job.completed || 0))
        const phase =
          job.state === 'running'
            ? job.phase === 'scan'
              ? `Finding orders · list page ${job.page || 1}`
              : 'Reading full order details'
            : job.state.replaceAll('-', ' ')
        progressText.textContent = `${phase} · ${job.completed || 0} saved / ${count} discovered · ${remaining} remaining${job.failed ? ` · ${job.failed} failed` : ''}${job.error ? ` — ${job.error}` : ''}`
        progressText.className =
          job.state === 'paused' || job.failed ? 'error' : ''
        pause.hidden = job.state === 'completed'
        pause.textContent =
          job.state === 'running' ? 'Pause import' : 'Resume / retry'
      }
      applyRunningState()
    } catch (error) {
      if (!disposed) report(error.message, true)
    } finally {
      querying = false
      if (!disposed && latestJob?.state === 'running')
        statusTimer = setTimeout(refresh, 2000)
    }
  }
  const focus = () => {
    void refresh()
  }
  document.defaultView?.addEventListener('focus', focus)
  aside.append(
    make('strong', '1688toCSV · Your order library'),
    nav,
    options,
    confirmation,
    progress,
    feedback,
    address,
    fallbackActions
  )
  root.append(style, aside)
  document.body.append(host)
  void refresh()
  return {
    host,
    refresh,
    dispose() {
      disposed = true
      clearTimeout(statusTimer)
      document.defaultView?.removeEventListener('focus', focus)
      host.remove()
    },
  }
}
