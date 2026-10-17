import { bindText, bindAttribute, message } from './i18n.js'
import { decorateIcon, icon } from './icons.js'
import { actionHelp } from './workspace-action-help.js'

/** One format order for Orders and Preparation; only Preparation adds backup. */
export function mountProductCopyActions(host, actions) {
  const groups = [
    ['Products', ['values', 'photos', 'cells']],
    ['Packing', ['columns', 'codes']],
    ['Labels & codes', ['barcodes', 'marks']],
    ['Options', ['headers']],
    ['Backup', ['backup']],
  ].flatMap(([label, keys]) => {
    const available = keys.map((key) => actions[key]).filter(Boolean)
    return available.length ? [{ label, actions: available }] : []
  })
  return mountCopyActions(host, { image: actions.image, groups })
}

/** Move the existing actions into a native popover; their handlers stay intact. */
export function mountCopyActions(
  host,
  {
    image,
    groups,
    label = 'Copy…',
    ariaLabel = 'More copy formats',
    panelLabel = 'Copy formats',
    symbol = 'copy',
  }
) {
  const trigger = document.createElement('button')
  trigger.type = 'button'
  trigger.className = 'copy-actions-trigger'
  bindText(trigger, message(label))
  bindAttribute(trigger, 'aria-label', message(ariaLabel))
  decorateIcon(trigger, symbol)
  trigger.append(icon('chevron'))
  actionHelp(trigger)
  if (image) actionHelp(image, { replace: true })
  const panel = document.createElement('div')
  panel.className = 'copy-actions-panel'
  panel.id = `copy-actions-${crypto.randomUUID()}`
  panel.setAttribute('popover', 'auto')
  panel.setAttribute('role', 'group')
  bindAttribute(panel, 'aria-label', message(panelLabel))
  trigger.setAttribute('popovertarget', panel.id)
  const anchor = `--${panel.id}`
  trigger.style.setProperty('anchor-name', anchor)
  panel.style.setProperty('position-anchor', anchor)
  for (const { label, actions } of groups) {
    for (const action of actions) actionHelp(action, { replace: true })
    const group = document.createElement('div')
    group.className = 'copy-format-group'
    group.setAttribute('role', 'group')
    bindAttribute(group, 'aria-label', message(label))
    const heading = document.createElement('span')
    heading.className = 'copy-format-heading'
    bindText(heading, message(label))
    group.append(heading, ...actions)
    panel.append(group)
  }
  host.classList.add('compact-copy-actions')
  host.replaceChildren(...[image, trigger, panel].filter(Boolean))
  let positioning
  const nativeAnchor =
    CSS.supports('position-area', 'block-end span-inline-end') &&
    CSS.supports('position-try-fallbacks', 'flip-block, flip-inline')
  panel.classList.toggle('native-anchor', nativeAnchor)
  const position = () => {
    if (!panel.matches(':popover-open')) return
    const anchor = trigger.getBoundingClientRect()
    const bounds = panel.getBoundingClientRect()
    panel.style.left = `${Math.max(8, Math.min(anchor.left, innerWidth - bounds.width - 8))}px`
    panel.style.top = `${Math.max(8, anchor.bottom + bounds.height + 14 <= innerHeight ? anchor.bottom + 6 : anchor.top - bounds.height - 6)}px`
  }
  panel.addEventListener('toggle', (event) => {
    positioning?.abort()
    positioning = null
    if (event.newState !== 'open' || nativeAnchor) return
    positioning = new AbortController()
    position()
    addEventListener('resize', position, { signal: positioning.signal })
    addEventListener('scroll', position, {
      capture: true,
      signal: positioning.signal,
    })
  })
  panel.addEventListener('keydown', dismissCopyActionsOnEscape)
  return {
    trigger,
    panel,
    destroy() {
      positioning?.abort()
      if (panel.matches(':popover-open')) panel.hidePopover()
      panel.remove()
      trigger.remove()
    },
  }
}

/** Packing's view-level Escape must dismiss this panel before leaving the view. */
export function dismissCopyActionsOnEscape(event) {
  if (event.key !== 'Escape') return false
  const panel = document.querySelector('.copy-actions-panel:popover-open')
  if (!panel) return false
  event.preventDefault()
  event.stopPropagation()
  panel.hidePopover()
  document.querySelector(`[popovertarget="${panel.id}"]`)?.focus()
  return true
}
