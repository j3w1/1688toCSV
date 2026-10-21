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
  element as el,
  enableLightDismiss,
  orderReference,
  pinDialogActions,
} from './ui.js'
import { preparationHelp } from './preparation-help.js'

/** A shared, explicitly labelled comparison; colour reinforces the words. */
export function packingValueComparison(
  values,
  {
    beforeLabel = 'Before',
    afterLabel = 'After applying',
    hideUnchanged = false,
  } = {}
) {
  const wrapper = el('div', undefined, 'packing-value-comparison')
  const table = el('table', undefined, 'packing-value-table')
  const head = el('thead'),
    heading = el('tr')
  const labelled = values.some((value) => value.label)
  table.classList.toggle('has-row-labels', labelled)
  if (labelled) {
    const field = el(
      'th',
      uiMessage('Changes to labels'),
      'packing-value-field-heading'
    )
    field.setAttribute('scope', 'col')
    heading.append(field)
  }
  for (const [side, label] of [
    ['before', beforeLabel],
    ['arrow', ''],
    ['after', afterLabel],
  ]) {
    const cell = el(
      'th',
      label ? (isMessage(label) ? label : uiMessage(label)) : '',
      `packing-value-caption packing-value-${side}-heading`
    )
    cell.setAttribute('scope', 'col')
    if (side === 'arrow') cell.setAttribute('aria-hidden', 'true')
    heading.append(cell)
  }
  head.append(heading)
  const body = el('tbody')
  let unchanged = 0
  for (const value of values) {
    const same = String(value.before ?? '') === String(value.after ?? '')
    if (same && hideUnchanged) {
      unchanged++
      continue
    }
    const row = el('tr', undefined, 'packing-value-row')
    if (labelled) {
      const label = el('th', undefined, 'packing-value-label')
      label.setAttribute('scope', 'row')
      label.append(
        el(
          'span',
          value.label
            ? isMessage(value.label)
              ? value.label
              : uiMessage(value.label)
            : ''
        )
      )
      // Seller descriptions identify the affected variant; they are source
      // context, not a field being replaced by its proposed barcode.
      if (value.context)
        label.append(
          el('small', String(value.context), 'packing-value-context')
        )
      row.append(label)
    }
    row.dataset.changed = String(!same)
    for (const side of ['before', 'after']) {
      if (side === 'after') {
        const arrow = el('td', same ? '=' : '→', 'packing-value-arrow')
        arrow.setAttribute('aria-hidden', 'true')
        row.append(arrow)
      }
      const cell = el(
        'td',
        undefined,
        `packing-value-cell packing-value-${side}`
      )
      const content = el('div', undefined, 'packing-value-content')
      const entries = Array.isArray(value[side]) ? value[side] : [value[side]]
      for (const entry of entries.length ? entries : ['']) {
        const text =
          entry === undefined || entry === null || entry === ''
            ? uiMessage('None')
            : entry
        const code = value.kind === 'code' && /^CE\d/i.test(String(text))
        content.append(
          el(
            code ? 'code' : 'span',
            text,
            code ? 'ce-code' : 'packing-value-text'
          )
        )
      }
      cell.append(content)
      row.append(cell)
    }
    body.append(row)
  }
  if (body.hasChildNodes()) {
    table.append(head, body)
    wrapper.append(table)
  }
  if (unchanged)
    wrapper.append(
      el(
        'small',
        uiMessage('{0} unchanged', { 0: unchanged }),
        'packing-value-unchanged'
      )
    )
  return wrapper
}

/** Review exact frozen changes before any allocation, restore or recoding write. */
export async function reviewPackingChanges({
  title,
  explanation,
  changes,
  proceed = 'Apply changes',
  alternate,
  media,
  itemKind = 'groups',
  overview = false,
}) {
  const modal = el('dialog', undefined, 'packing-review packing-change-dialog')
  modal.classList.toggle('packing-review-overview', overview)
  bindAttribute(modal, 'aria-label', title)
  modal.append(
    el('h2', isMessage(title) ? title : uiMessage(title)),
    el('p', isMessage(explanation) ? explanation : uiMessage(explanation))
  )
  const list = el('div', undefined, 'packing-review-list')
  // Bound live photos while making every affected group available by page.
  let page = 0
  const pageStatus = el('span')
  const previous = el('button', uiMessage('Previous')),
    next = el('button', uiMessage('Next'))
  const fitHost = overview
    ? el('div', undefined, 'packing-review-overview-fit')
    : null
  let fitObserver,
    fitFrame,
    columns = 1
  const valuesFor = (change) =>
    change.values || [
      {
        before: change.before || uiMessage('Not prepared'),
        after: change.after || uiMessage('Next available code'),
        kind: 'code',
      },
    ]
  function renderOverview(change, index) {
    const card = el(
      'article',
      undefined,
      'packing-review-item packing-review-overview-item'
    )
    if (change.photo && media) card.append(media.photo(change.photo))
    const select = el('button', undefined, 'packing-review-overview-select')
    select.type = 'button'
    select.setAttribute('aria-haspopup', 'dialog')
    select.setAttribute('aria-expanded', 'false')
    const code = change.after || change.before
    if (code)
      select.append(
        el(
          /^CE\d/i.test(String(code)) ? 'code' : 'span',
          code,
          /^CE\d/i.test(String(code))
            ? 'ce-code'
            : 'packing-review-overview-code'
        )
      )
    select.append(
      el(
        'span',
        change.sourceDescription || change.name || uiMessage('Product group'),
        'packing-review-overview-name'
      )
    )
    const changed = valuesFor(change).filter(
      (value) => String(value.before ?? '') !== String(value.after ?? '')
    )
    if (changed.length) {
      const summary = el('span', undefined, 'packing-review-overview-summary')
      summary.append(el('b', `+${changed.length}`))
      const labels = [
        ...new Set(
          changed
            .map((value) =>
              isMessage(value.label) ? value.label.source : value.label
            )
            .filter(Boolean)
        ),
      ]
      for (const [index, label] of labels.slice(0, 2).entries()) {
        if (index) summary.append(' · ')
        summary.append(el('span', uiMessage(label)))
      }
      bindAttribute(
        summary,
        'aria-label',
        uiMessage('{0}: {1}', {
          0: uiMessage('Changes to labels'),
          1: changed.length,
        })
      )
      select.append(summary)
    }
    const detail = el('div', undefined, 'packing-review-detail')
    detail.id = `packing-review-detail-${crypto.randomUUID()}`
    detail.setAttribute('role', 'dialog')
    detail.setAttribute('popover', 'auto')
    select.setAttribute('aria-controls', detail.id)
    const nativePopover = typeof detail.showPopover === 'function'
    if (!nativePopover) {
      detail.removeAttribute('popover')
      detail.hidden = true
    }
    const heading = el('div', undefined, 'packing-review-detail-heading'),
      name = el('strong', change.name || uiMessage('Product group')),
      close = el('button', '×', 'packing-review-detail-close')
    name.id = `${detail.id}-title`
    detail.setAttribute('aria-labelledby', name.id)
    close.type = 'button'
    bindAttribute(close, 'aria-label', uiMessage('Close'))
    heading.append(name, close)
    detail.append(heading)
    if (change.order) detail.append(el('small', change.order))
    if (change.sourceDescription && change.sourceDescription !== change.name)
      detail.append(el('p', change.sourceDescription))
    detail.append(packingValueComparison(valuesFor(change)))
    if (change.detail)
      detail.append(
        el(
          'p',
          isMessage(change.detail) ? change.detail : uiMessage(change.detail)
        )
      )
    const hide = () => {
      if (nativePopover) detail.hidePopover()
      else detail.hidden = true
      select.setAttribute('aria-expanded', 'false')
      select.focus()
    }
    close.onclick = hide
    detail.addEventListener('toggle', (event) =>
      select.setAttribute('aria-expanded', String(event.newState === 'open'))
    )
    detail.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      hide()
    })
    select.onclick = () => {
      for (const open of list.querySelectorAll('.packing-review-detail')) {
        if (open === detail) continue
        if (nativePopover && open.matches(':popover-open')) open.hidePopover()
        else if (!nativePopover) open.hidden = true
      }
      if (nativePopover) detail.showPopover()
      else detail.hidden = false
      select.setAttribute('aria-expanded', 'true')
      close.focus()
    }
    select.onkeydown = (event) => {
      const offset = {
        ArrowLeft: -1,
        ArrowRight: 1,
        ArrowUp: -columns,
        ArrowDown: columns,
      }[event.key]
      if (!offset) return
      event.preventDefault()
      const buttons = list.querySelectorAll('.packing-review-overview-select')
      buttons[
        Math.max(0, Math.min(buttons.length - 1, index + offset))
      ]?.focus()
    }
    card.append(select, detail)
    return card
  }
  function fitOverview() {
    if (!fitHost?.clientWidth || !fitHost.clientHeight) return
    columns = Math.max(1, Math.floor(fitHost.clientWidth / 175))
    list.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`
    const scale = Math.min(
      1,
      fitHost.clientHeight / Math.max(1, list.scrollHeight)
    )
    list.style.setProperty('--packing-review-scale', String(scale))
    modal.dataset.overviewScale = String(scale)
  }
  function render() {
    media?.forget(list)
    list.replaceChildren()
    if (overview) {
      list.append(...changes.map(renderOverview))
      return
    }
    for (const change of changes.slice(page * 12, (page + 1) * 12)) {
      const card = el('article', undefined, 'packing-review-item')
      if (change.photo && media) card.append(media.photo(change.photo))
      const content = el('div')
      content.append(el('strong', change.name || uiMessage('Product group')))
      if (change.order) content.append(el('small', change.order))
      if (change.orderId)
        content.append(
          orderReference(change.orderId, { sourceType: change.sourceType })
        )
      content.append(packingValueComparison(valuesFor(change)))
      if (change.detail)
        content.append(
          el(
            'p',
            isMessage(change.detail) ? change.detail : uiMessage(change.detail)
          )
        )
      card.append(content)
      list.append(card)
    }
    previous.disabled = page === 0
    next.disabled = (page + 1) * 12 >= changes.length
    bindText(
      pageStatus,
      uiMessage(
        itemKind === 'products'
          ? '{0}–{1} of {2} products'
          : '{0}–{1} of {2} groups',
        {
          0: Math.min(changes.length, page * 12 + 1),
          1: Math.min(changes.length, (page + 1) * 12),
          2: changes.length,
        }
      )
    )
  }
  previous.onclick = () => {
    page--
    render()
  }
  next.onclick = () => {
    page++
    render()
  }
  const pages = el('div', undefined, 'dialog-actions')
  if (!overview && changes.length > 12) pages.append(previous, pageStatus, next)
  const actions = el('div', undefined, 'dialog-actions')
  const cancel = el('button', uiMessage('Cancel')),
    apply = el(
      'button',
      isMessage(proceed) ? proceed : uiMessage(proceed),
      'primary'
    )
  const secondary = alternate
    ? el(
        'button',
        isMessage(alternate.label)
          ? alternate.label
          : uiMessage(alternate.label)
      )
    : null
  if (secondary && alternate.help) preparationHelp(secondary, alternate.help)
  // Stable names whatever the visible wording (see docs/automation.md).
  cancel.dataset.action = 'review-cancel'
  apply.dataset.action = 'review-proceed'
  if (secondary) secondary.dataset.action = `review-${alternate.value}`
  actions.append(cancel)
  if (secondary) actions.append(secondary)
  actions.append(apply)
  if (overview) {
    fitHost.append(list)
    modal.append(fitHost, actions)
  } else modal.append(list, pages, actions)
  pinDialogActions(modal, actions)
  enableLightDismiss(modal)
  document.body.append(modal)
  render()
  return new Promise((resolve) => {
    let confirmed = false
    cancel.onclick = () => modal.close()
    apply.onclick = () => {
      confirmed = true
      modal.close()
    }
    if (secondary)
      secondary.onclick = () => {
        confirmed = alternate.value
        modal.close()
      }
    modal.onclose = () => {
      fitObserver?.disconnect()
      if (fitFrame !== undefined) cancelAnimationFrame(fitFrame)
      media?.forget(list)
      modal.remove()
      resolve(confirmed)
    }
    modal.showModal()
    if (overview && typeof ResizeObserver === 'function') {
      fitObserver = new ResizeObserver(() => {
        if (fitFrame !== undefined) cancelAnimationFrame(fitFrame)
        fitFrame = requestAnimationFrame(fitOverview)
      })
      fitObserver.observe(fitHost)
      fitObserver.observe(list)
      fitOverview()
    }
    cancel.focus()
  })
}
