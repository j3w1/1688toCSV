import { element as el, enableLightDismiss } from './ui.js'

/** Review exact frozen changes before any allocation, restore or recoding write. */
export async function reviewPackingChanges({
  title,
  explanation,
  changes,
  proceed = 'Apply changes',
  media,
}) {
  const modal = el('dialog', undefined, 'packing-review')
  modal.setAttribute('aria-label', title)
  modal.append(el('h2', title), el('p', explanation))
  const list = el('div', undefined, 'packing-review-list')
  // Bound live photos while making every affected group available by page.
  let page = 0
  const pageStatus = el('span')
  const previous = el('button', 'Previous'),
    next = el('button', 'Next')
  function render() {
    media?.forget(list)
    list.replaceChildren()
    for (const change of changes.slice(page * 12, (page + 1) * 12)) {
      const card = el('article', undefined, 'packing-review-item')
      if (change.photo && media) card.append(media.photo(change.photo))
      const content = el('div')
      content.append(el('strong', change.name || 'Product group'))
      if (change.order) content.append(el('small', change.order))
      const codes = el('div', undefined, 'packing-review-codes')
      codes.append(
        el('code', change.before || 'Not prepared'),
        el('span', '→'),
        el('code', change.after || 'Next available code')
      )
      content.append(codes)
      if (change.detail) content.append(el('p', change.detail))
      card.append(content)
      list.append(card)
    }
    previous.disabled = page === 0
    next.disabled = (page + 1) * 12 >= changes.length
    pageStatus.textContent = `${Math.min(changes.length, page * 12 + 1)}–${Math.min(changes.length, (page + 1) * 12)} of ${changes.length} groups`
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
  const cancel = el('button', 'Cancel'),
    apply = el('button', proceed, 'primary')
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
