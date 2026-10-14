export function element(tag, text, className) {
  const node = document.createElement(tag)
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
        button.classList.remove('copied', 'copy-failed')
      }, 3000)
    )
  }
}

export const yieldUI = () =>
  globalThis.scheduler?.yield
    ? scheduler.yield()
    : new Promise((resolve) => setTimeout(resolve, 0))
