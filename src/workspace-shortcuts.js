import { attributeMessage, textMessage, isMessage } from './i18n.js'
import { actionHelp } from './workspace-action-help.js'
import { preparationShortcut } from './preparation-help.js'

const commands = [
  { id: 'copy', labels: ['More copy formats'], keys: ['Alt+Shift+C'] },
  { id: 'excel-image', labels: ['Copy Excel image'], keys: ['Alt+Shift+E'] },
  {
    id: 'product-search',
    elementId: 'search',
    keys: ['Alt+Shift+F'],
    view: 'orders',
    focus: true,
  },
  {
    id: 'order-search',
    elementId: 'order-search',
    keys: ['Alt+Shift+R'],
    view: 'orders',
    focus: true,
  },
  { id: 'settings', elementId: 'packing-settings', keys: ['Alt+Shift+S'] },
  { id: 'activity', elementId: 'activity-open', keys: ['Alt+Shift+T'] },
  {
    id: 'restore',
    elementId: 'restore-packing',
    keys: ['Alt+Shift+I'],
    view: 'orders',
  },
  { id: 'orders', labels: ['Orders'], keys: ['Alt+Shift+O'], view: 'packing' },
  {
    id: 'undo',
    labels: ['Undo'],
    keys: ['Control+Z', 'Meta+Z'],
  },
  {
    id: 'redo',
    labels: ['Redo'],
    keys: ['Control+Y', 'Control+Shift+Z', 'Meta+Shift+Z'],
  },
  // Selection stays with the existing controller, which remembers whether the
  // user last operated on orders, products or packing groups.
  {
    id: 'select-all',
    labels: ['Select all', 'Select all rows'],
    keys: ['Control+A', 'Meta+A'],
    delegated: true,
  },
  {
    id: 'clear-selection',
    labels: ['Clear selection'],
    keys: ['Control+D', 'Meta+D'],
    delegated: true,
  },
]

const installed = new WeakSet()
const source = (value) => (isMessage(value) ? value.source : value)

function commandFor(target) {
  const label =
    source(attributeMessage(target, 'aria-label')) ||
    target.getAttribute('data-i18n-aria-label') ||
    source(textMessage(target)) ||
    target.getAttribute('data-i18n')
  return commands.find((command) =>
    command.elementId
      ? command.elementId === target.id
      : command.labels?.includes(label)
  )
}

function matches(event, chord) {
  const parts = chord.toLowerCase().split('+')
  return (
    event.key.toLowerCase() === parts.at(-1) &&
    Boolean(event.ctrlKey) === parts.includes('control') &&
    Boolean(event.metaKey) === parts.includes('meta') &&
    Boolean(event.altKey) === parts.includes('alt') &&
    Boolean(event.shiftKey) === parts.includes('shift')
  )
}

function usable(target, doc, view) {
  if (
    target.matches(':disabled, [aria-disabled="true"]') ||
    target.closest('[hidden], [inert], dialog') ||
    (target.closest('#packing-view') && view !== 'packing') ||
    (target.closest('#orders-view') && view !== 'orders')
  )
    return false
  if (target.getClientRects().length) return true
  // A copy/backup action may live inside its current view's closed popover.
  // Use the same enabled button and handler, without changing its data scope.
  const panel = target.closest('[popover]')
  const trigger =
    panel &&
    [...doc.querySelectorAll('[popovertarget]')].find(
      (button) => button.getAttribute('popovertarget') === panel.id
    )
  return Boolean(
    trigger &&
    !trigger.disabled &&
    !trigger.closest('[hidden], [inert]') &&
    trigger.getClientRects().length
  )
}

/** Contextual accelerators invoke existing controls and retain all their guards. */
export function installWorkspaceShortcuts(doc) {
  if (installed.has(doc)) return
  installed.add(doc)
  const annotate = (root) => {
    const controls = [
      ...(root.matches?.('button, input[type="search"]') ? [root] : []),
      ...(root.querySelectorAll?.('button, input[type="search"]') || []),
    ]
    for (const target of controls) {
      if (target.closest('dialog')) continue
      const command = commandFor(target)
      if (!command || target.dataset.workspaceCommand === command.id) continue
      target.dataset.workspaceCommand = command.id
      actionHelp(target)
      preparationShortcut(target, command.keys)
    }
  }
  annotate(doc)
  const observer = new MutationObserver((changes) => {
    for (const change of changes)
      for (const node of change.addedNodes)
        if (node.nodeType === 1) annotate(node)
  })
  observer.observe(doc.body, { childList: true, subtree: true })
  doc.addEventListener('keydown', (event) => {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.repeat ||
      event.getModifierState?.('AltGraph') ||
      doc.querySelector('dialog[open]') ||
      event.target.closest?.(
        'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]), textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"]'
      )
    )
      return
    const view =
      doc.getElementById('packing-view')?.hidden === false
        ? 'packing'
        : 'orders'
    const command = commands.find(
      (item) =>
        !item.delegated &&
        (!item.view || item.view === view) &&
        item.keys.some((chord) => matches(event, chord))
    )
    if (!command) return
    const targets = doc.querySelectorAll(
      `[data-workspace-command="${command.id}"]`
    )
    const target = [...targets].find((item) => usable(item, doc, view))
    // A recognized shortcut must not fall through to an unrelated focused
    // button's native Enter action when its own action is unavailable.
    event.preventDefault()
    if (!target) return
    if (command.focus) {
      target.focus()
      target.select?.()
    } else {
      if (target.getClientRects().length) target.focus({ preventScroll: true })
      target.click()
    }
  })
}
