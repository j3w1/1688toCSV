import { decorateIcon } from './icons.js'

const dismissibleDialogs = new WeakSet()

export function enableLightDismiss(dialog) {
  if (dismissibleDialogs.has(dialog)) return
  dismissibleDialogs.add(dialog)
  dialog.setAttribute('closedby', 'any')
  if ('closedBy' in HTMLDialogElement.prototype) return

  // Chrome 120: a backdrop click targets the dialog itself, as does its padding.
  // Require both ends outside so selecting text or dragging out cannot dismiss.
  let startedOutside = false
  const outside = (event) => {
    if (event.target !== dialog) return false
    const rect = dialog.getBoundingClientRect()
    return (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
  }
  dialog.addEventListener('pointerdown', (event) => {
    startedOutside = event.button === 0 && outside(event)
  })
  dialog.addEventListener('pointercancel', () => {
    startedOutside = false
  })
  dialog.addEventListener('close', () => {
    startedOutside = false
  })
  dialog.addEventListener('click', (event) => {
    const dismiss = startedOutside && outside(event)
    startedOutside = false
    if (!dismiss || !dialog.open) return
    if (typeof dialog.requestClose === 'function') dialog.requestClose()
    else if (dialog.dispatchEvent(new Event('cancel', { cancelable: true })))
      dialog.close()
  })
}

export function element(tag, text, className) {
  const node = document.createElement(tag)
  if (tag === 'dialog') enableLightDismiss(node)
  if (text !== undefined) node.textContent = text
  if (className) node.className = className
  return node
}

export function confirmScope({
  action,
  count,
  unit = 'orders',
  detail = '',
  name = 'Confirm operation',
}) {
  if (!count) return Promise.resolve(false)
  const dialog = element('dialog', undefined, 'scope-dialog')
  dialog.setAttribute('aria-label', name)
  const cancel = element('button', 'Cancel')
  const proceed = element(
    'button',
    `${action} ${count.toLocaleString()} ${unit}`,
    'primary'
  )
  const actions = element('div', undefined, 'dialog-actions')
  actions.append(cancel, proceed)
  dialog.append(
    element('h2', `${action} ${count.toLocaleString()} ${unit}?`),
    element(
      'p',
      `This will iterate over ${count.toLocaleString()} ${unit}. ${detail}`
    ),
    actions
  )
  document.body.append(dialog)
  return new Promise((resolve) => {
    let confirmed = false
    cancel.onclick = () => dialog.close()
    proceed.onclick = () => {
      confirmed = true
      dialog.close()
    }
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

const copyTimers = new WeakMap()

export async function copied(button, task) {
  if (button.disabled) return
  const label = (button.dataset.copyLabel ||= button.textContent)
  clearTimeout(copyTimers.get(button))
  button.disabled = true
  button.textContent = 'Copying…'
  button.classList.remove('copied', 'copy-failed')
  button.nextElementSibling?.matches('.copy-error') &&
    button.nextElementSibling.remove()
  try {
    await task()
    button.textContent = 'Copied'
    button.classList.add('copied')
  } catch (error) {
    const message = element('span', error.message, 'copy-error')
    message.setAttribute('role', 'alert')
    button.after(message)
    button.textContent = 'Try again'
    button.classList.add('copy-failed')
  } finally {
    button.disabled = false
    copyTimers.set(
      button,
      setTimeout(() => {
        button.textContent = label
        if (button.dataset.icon) decorateIcon(button, button.dataset.icon)
        button.classList.remove('copied', 'copy-failed')
      }, 3000)
    )
  }
}

export const yieldUI = () =>
  globalThis.scheduler?.yield
    ? scheduler.yield()
    : new Promise((resolve) => setTimeout(resolve, 0))
