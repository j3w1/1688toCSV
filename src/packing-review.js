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
import { element as el, enableLightDismiss, orderReference } from './ui.js'

/** Review exact frozen changes before any allocation, restore or recoding write. */
export async function reviewPackingChanges({
  title,
  explanation,
  changes,
  proceed = 'Apply changes',
  media,
  itemKind = 'groups',
}) {
  const modal = el('dialog', undefined, 'packing-review')
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
      const codes = el('div', undefined, 'packing-review-codes')
      codes.append(
        el(
          'code',
          change.before || uiMessage('Not prepared'),
          /^CE\d/i.test(change.before || '') ? 'ce-code' : undefined
        ),
        el('span', '→'),
        el(
          'code',
          change.after || uiMessage('Next available code'),
          /^CE\d/i.test(change.after || '') ? 'ce-code' : undefined
        )
      )
      content.append(codes)
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
  actions.append(cancel, apply)
  modal.append(list, pages, actions)
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
    modal.onclose = () => {
      media?.forget(list)
      modal.remove()
      resolve(confirmed)
    }
    modal.showModal()
    cancel.focus()
  })
}
