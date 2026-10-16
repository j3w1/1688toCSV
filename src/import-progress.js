import { t, getLocale, bindText, bindAttribute } from './i18n.js'

// Small read-only views of durable importer checkpoints. Polling never advances a job.
export function importProgress(job) {
  const orders = job.orders?.length ? job.orders : null
  const completed = orders
    ? orders.filter((order) => order.state === 'done').length
    : job.completed || job.done || 0
  const failed = orders
    ? orders.filter((order) => order.state === 'failed').length
    : job.failed || 0
  const discovered = orders?.length ?? job.discovered ?? 0
  const total = Math.max(job.total || 0, discovered)
  const counted = orders?.filter(
    (order) => order.state === 'done' && Number.isInteger(order.savedRows)
  )
  return {
    id: job.id,
    state: job.state,
    phase: job.phase,
    kind: job.kind,
    scope: job.scope,
    page: job.page || 0,
    pageSize: job.pageSize,
    total,
    discovered,
    completed,
    failed,
    remaining: Math.max(0, total - completed),
    collectedRows: counted
      ? counted.reduce((sum, order) => sum + order.savedRows, 0)
      : job.collectedRows || 0,
    countedOrders: counted?.length ?? job.countedOrders ?? 0,
    currentOrderId: job.currentOrderId,
    currentRows: job.currentRows,
    detailStage: job.detailStage,
    detailError: job.detailError,
    detailStartedAt: job.detailStartedAt,
    detailAttempts: job.detailAttempts,
    latestResult: job.latestResult,
    updatedAt: job.updatedAt,
    error: job.error || '',
  }
}

const number = (value) => value.toLocaleString(getLocale())
const age = (time, now) => {
  const seconds = Math.max(0, Math.floor((now - time) / 1000))
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

export function progressPresentation(input, now = Date.now()) {
  const job = importProgress(input)
  const running = job.state === 'running'
  const scan = job.phase === 'scan'
  const max = scan
    ? job.pageSize
      ? Math.ceil(job.total / job.pageSize)
      : 0
    : job.total
  const value = Math.min(max, scan ? job.page : job.completed + job.failed)
  const percent = max ? Math.floor((value / max) * 100) : null
  const title = t(
    running
      ? scan
        ? 'Finding orders'
        : 'Collecting product details'
      : job.state === 'completed-with-errors'
        ? 'Finished · some orders need attention'
        : job.state === 'completed'
          ? 'Collection completed'
          : 'Collection paused'
  )
  const label = t(scan ? 'List pages scanned' : 'Orders processed')
  const meter = max
    ? t('{value} / {max} {unit} · {percent}%', {
        value: number(value),
        max: number(max),
        unit: t(scan ? 'pages scanned' : 'processed'),
        percent,
      })
    : scan
      ? t('Waiting for the list count')
      : t('Waiting for the order count')
  const counts = t(
    '{saved} saved · {failed} need attention · {pending} pending',
    {
      saved: number(job.completed),
      failed: number(job.failed),
      pending: number(Math.max(0, job.total - job.completed - job.failed)),
    }
  )
  const rows =
    job.countedOrders === job.completed
      ? t('{rows} product rows saved', { rows: number(job.collectedRows) })
      : job.countedOrders
        ? t(
            '{rows} product rows counted in {counted} of {saved} saved orders',
            {
              rows: number(job.collectedRows),
              counted: number(job.countedOrders),
              saved: number(job.completed),
            }
          )
        : t('Product-row count available after resuming')
  let current = ''
  if (running) {
    if (scan)
      current = t(
        '{count} orders found · details are collected after discovery',
        { count: number(job.discovered) }
      )
    else if (job.currentOrderId && job.detailStage !== 'next') {
      const stages = {
        loading: t('Waiting for the order page'),
        reading: t('Reading products and checking totals'),
        retrying: t('Waiting to retry the page'),
        saving: t('Saving {rows} product rows', {
          rows: number(job.currentRows || 0),
        }),
      }
      current = `…${job.currentOrderId.slice(-8)} · ${stages[job.detailStage] || t('Waiting for the reader')}`
      if (job.detailAttempts)
        current += t(' · attempt {count}/3', { count: job.detailAttempts })
      if (Number.isFinite(job.detailStartedAt))
        current += t(' · {time} on this order', {
          time: age(job.detailStartedAt, now),
        })
      if (now - job.detailStartedAt >= 20000 && job.detailStage !== 'saving')
        current += t(
          ' · Taking longer; check the reader tab for sign-in or loading.'
        )
    } else current = t('Moving to the next order')
  }
  const last = job.latestResult
  let latest = ''
  if (last) {
    latest =
      last.outcome === 'saved'
        ? t('Last saved: …{order} · {rows} product rows{seller}{amount}', {
            order: last.orderId.slice(-8),
            rows: number(last.rows),
            seller: last.sellerName ? ` · ${last.sellerName}` : '',
            amount: last.payable ? ` · CNY ${last.payable}` : '',
          })
        : t('Last attempt: …{order} · not saved — {error}', {
            order: last.orderId.slice(-8),
            error: t(last.error),
          })
    const at = Date.parse(last.at)
    if (running && Number.isFinite(at))
      latest += t(' · {time} ago', { time: age(at, now) })
  }
  return {
    title,
    label,
    max,
    value,
    meter,
    counts,
    rows,
    current,
    latest,
    error: t(
      job.error ||
        (running && job.detailStage === 'retrying' ? job.detailError || '' : '')
    ),
  }
}

export const importProgressStyles = `
  .import-progress { min-width: 0; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
  .import-progress [hidden] { display: none !important; }
  .import-progress p { margin: 5px 0; font-size: 12px; line-height: 1.5; }
  .import-progress .import-title { display: block; font-size: 13px; margin: 0 0 7px; }
  .import-progress .import-meter { font-weight: 650; }
  .import-progress progress { display: block; appearance: none; width: 100%; height: 8px; border: 0; border-radius: 9px; overflow: hidden; background: var(--divider); accent-color: var(--control-accent); }
  .import-progress progress::-webkit-progress-bar { background: var(--divider); border-radius: 9px; }
  .import-progress progress::-webkit-progress-value { background: var(--control-accent); border-radius: 9px; }
  .import-progress .import-current, .import-progress .import-latest { opacity: .85; }
  .import-progress .import-error { color: var(--danger-text); border-left: 3px solid var(--danger-text); padding-left: 8px; }
`

export function createProgressView(document) {
  const element = document.createElement('section')
  element.className = 'import-progress'
  bindAttribute(element, 'aria-label', 'Import progress')
  const fields = {}
  for (const [key, tag] of [
    ['title', 'strong'],
    ['bar', 'progress'],
    ['meter', 'p'],
    ['counts', 'p'],
    ['rows', 'p'],
    ['current', 'p'],
    ['latest', 'p'],
    ['error', 'p'],
  ]) {
    const field = document.createElement(tag)
    field.className = `import-${key}`
    fields[key] = field
    element.append(field)
  }
  // Announce checkpoints, not every elapsed-time tick.
  fields.counts.setAttribute('role', 'status')
  return {
    element,
    update(job, now) {
      const display = progressPresentation(job, now)
      fields.bar.max = display.max || 1
      if (display.max) fields.bar.value = display.value
      else fields.bar.removeAttribute('value')
      fields.bar.setAttribute('aria-label', display.label)
      fields.bar.setAttribute('aria-valuetext', display.meter)
      for (const [key, value] of Object.entries(display)) {
        if (!fields[key]) continue
        if (fields[key].textContent !== value) fields[key].textContent = value
        fields[key].hidden = !value
      }
    },
  }
}
