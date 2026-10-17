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
  { beforeLabel = 'Before', afterLabel = 'After applying' } = {}
) {
  const table = el('div', undefined, 'packing-value-comparison')
  for (const value of values) {
    const row = el('div', undefined, 'packing-value-row')
    if (value.label)
      row.append(
        el(
          'strong',
          isMessage(value.label) ? value.label : uiMessage(value.label),
          'packing-value-label'
        )
      )
    const same = String(value.before ?? '') === String(value.after ?? '')
    row.dataset.changed = String(!same)
    for (const [side, label] of [
      ['before', beforeLabel],
      ['after', afterLabel],
    ]) {
      const cell = el(
        'div',
        undefined,
        `packing-value-cell packing-value-${side}`
      )
      cell.append(
        el(
          'span',
          isMessage(label) ? label : uiMessage(label),
          'packing-value-caption'
        )
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
    table.append(row)
  }
  return table
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
}) {
  const modal = el('dialog', undefined, 'packing-review packing-change-dialog')
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
  function render() {
    media?.forget(list)
    list.replaceChildren()
    for (const change of changes.slice(page * 12, (page + 1) * 12)) {
      const card = el('article', undefined, 'packing-review-item')
      if (change.photo && media) card.append(media.photo(change.photo))
      const content = el('div')
      content.append(el('strong', change.name || uiMessage('Product group')))
      if (change.order) content.append(el('small', change.order))
      if (change.orderId) content.append(orderReference(change.orderId))
      content.append(
        packingValueComparison(
          change.values || [
            {
              before: change.before || uiMessage('Not prepared'),
              after: change.after || uiMessage('Next available code'),
              kind: 'code',
            },
          ]
        )
      )
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
  if (changes.length > 12) pages.append(previous, pageStatus, next)
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
  actions.append(cancel)
  if (secondary) actions.append(secondary)
  actions.append(apply)
  modal.append(list, pages, actions)
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
      media?.forget(list)
      modal.remove()
      resolve(confirmed)
    }
    modal.showModal()
    cancel.focus()
  })
}
