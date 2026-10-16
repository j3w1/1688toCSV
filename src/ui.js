import {
  message as uiMessage,
  bindText,
  bindAttribute,
  isMessage,
  t,
  getLocale,
  getLanguage,
  onLanguageChange,
  textMessage,
  attributeMessage,
} from './i18n.js'
import { decorateIcon, icon } from './icons.js'
import { preparationHelp } from './preparation-help.js'

/** Keep the full copyable order number and its source link together. */
export function orderReference(orderId, { className = '' } = {}) {
  const pair = element('span', undefined, 'order-reference-pair')
  pair.append(
    copyTextButton(orderId, { label: 'Copy order number', className })
  )
  if (!/^[1-9]\d*$/.test(String(orderId))) return pair
  const link = element('a', undefined, 'order-source-link icon-button')
  link.href = `https://air.1688.com/app/ctf-page/trade-order-detail/index.html?orderId=${orderId}`
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  decorateIcon(link, 'external', {
    iconOnly: true,
    label: uiMessage('Open order {0} in a new tab', { 0: orderId }),
  })
  preparationHelp(link, uiMessage('Open this order on 1688 in a new tab.'))
  link.addEventListener('click', (event) => event.stopPropagation())
  link.addEventListener('dblclick', (event) => event.stopPropagation())
  pair.append(link)
  return pair
}

/** Copy the visible source text without changing its size, label or selection. */
export function copyTextButton(
  value,
  { label = 'Copy text', className = '' } = {}
) {
  const sourceLabel = isMessage(label) ? label.source : label
  const button = element(
    'button',
    String(value ?? ''),
    `copyable-text ${className}`.trim()
  )
  button.type = 'button'
  bindAttribute(
    button,
    'aria-label',
    uiMessage('{0}: {1}', {
      0: isMessage(label) ? label : uiMessage(label),
      1: value,
    })
  )
  preparationHelp(
    button,
    uiMessage(
      sourceLabel === 'Copy order number'
        ? 'Click to copy the order number.'
        : sourceLabel === 'Copy store name'
          ? 'Click to copy the store name.'
          : 'Click to copy this value.'
    )
  )
  const status = element('span', undefined, 'copy-text-feedback')
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  status.hidden = true
  button.append(status)
  let timer,
    copying = false
  button.addEventListener('dblclick', (event) => {
    event.preventDefault()
    event.stopPropagation()
  })
  button.addEventListener('click', async (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (copying) return
    copying = true
    clearTimeout(timer)
    status.hidden = true
    status.querySelector('.ui-icon')?.remove()
    button.setAttribute('aria-busy', 'true')
    try {
      await navigator.clipboard.writeText(String(value ?? ''))
      bindText(status, 'Copied')
      status.prepend(icon('check'))
      status.classList.remove('copy-text-error')
    } catch (error) {
      bindText(status, error.message || 'Could not copy. Try again.')
      status.classList.add('copy-text-error')
    } finally {
      copying = false
      button.removeAttribute('aria-busy')
      status.hidden = false
      timer = setTimeout(() => {
        status.hidden = true
      }, 1800)
    }
  })
  return button
}

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
  if (isMessage(text)) bindText(node, text)
  else if (text !== undefined) node.textContent = text
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
  bindAttribute(dialog, 'aria-label', name)
  const cancel = element('button', uiMessage('Cancel'))
  const proceed = element(
    'button',
    uiMessage('{0} {1} {2}', {
      0: uiMessage(action),
      1: () => count.toLocaleString(getLocale()),
      2: uiMessage(unit),
    }),
    'primary'
  )
  const actions = element('div', undefined, 'dialog-actions')
  actions.append(cancel, proceed)
  dialog.append(
    element(
      'h2',
      uiMessage('{0} {1} {2}?', {
        0: uiMessage(action),
        1: () => count.toLocaleString(getLocale()),
        2: uiMessage(unit),
      })
    ),
    element(
      'p',
      uiMessage('This will iterate over {0} {1}. {2}', {
        0: () => count.toLocaleString(getLocale()),
        1: uiMessage(unit),
        2: uiMessage(detail),
      })
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
const copyStates = new WeakMap()

/** A changed batch or preview must not keep the previous copy's success state. */
export function resetCopyFeedback(button) {
  clearTimeout(copyTimers.get(button))
  copyTimers.delete(button)
  const state = copyStates.get(button)
  state?.clearDetail?.()
  state?.reset?.()
}

/** Keep the action's footprint while short feedback and detailed progress change. */
export async function copied(button, task, { onError } = {}) {
  if (button.disabled) return
  let state = copyStates.get(button)
  if (!state) {
    state = {
      label:
        textMessage(button) ||
        (button.dataset.copyLabel ||= button.textContent),
      iconOnly: button.classList.contains('icon-button'),
      ariaLabel:
        attributeMessage(button, 'aria-label') ||
        button.getAttribute('aria-label'),
      title: button.hasAttribute('title')
        ? attributeMessage(button, 'title') || button.getAttribute('title')
        : null,
      inlineSize: button.style.inlineSize,
      blockSize: button.style.blockSize,
    }
    copyStates.set(button, state)
  }
  clearTimeout(copyTimers.get(button))
  state.clearDetail?.()
  button.disabled = true
  button.classList.remove('copied', 'copy-failed')
  const bounds = button.getBoundingClientRect?.()
  if (bounds?.width && bounds.height) {
    button.style.inlineSize = `${bounds.width}px`
    button.style.blockSize = `${bounds.height}px`
  }
  button.classList.add('copy-active')
  button.setAttribute('aria-live', 'polite')
  button.setAttribute('aria-busy', 'true')
  const show = (label, iconName) => {
    bindText(button, label)
    if (state.iconOnly) {
      decorateIcon(button, iconName, {
        iconOnly: true,
        label: uiMessage('{0}: {1}', {
          0: state.ariaLabel || state.label,
          1: uiMessage(label),
        }),
      })
    } else {
      decorateIcon(button, iconName)
      if (state.ariaLabel !== null) bindAttribute(button, 'aria-label', label)
    }
  }
  const reset = () => {
    bindText(button, state.label)
    if (state.icon)
      decorateIcon(button, state.icon, {
        iconOnly: state.iconOnly,
        label: state.ariaLabel || state.label,
      })
    else {
      button.querySelector(':scope > .ui-icon')?.remove()
      delete button.dataset.icon
    }
    if (state.ariaLabel === null) button.removeAttribute('aria-label')
    else bindAttribute(button, 'aria-label', state.ariaLabel)
    if (state.title === null) button.removeAttribute('title')
    else bindAttribute(button, 'title', state.title)
    button.style.inlineSize = state.inlineSize
    button.style.blockSize = state.blockSize
    button.classList.remove('copy-active', 'copied', 'copy-failed')
    if (!state.clearDetail) copyStates.delete(button)
  }
  state.reset = reset
  if (!Object.hasOwn(state, 'icon')) state.icon = button.dataset.icon
  const detail = (message, { error = false, cancel } = {}) => {
    if (
      state.detail &&
      !error &&
      state.detail.classList.contains('copy-progress')
    ) {
      bindText(state.detail.querySelector('.copy-detail-text'), message)
      if (cancel && cancel.parentElement !== state.detail)
        state.detail.append(cancel)
      state.positionDetail?.()
      return
    }
    state.clearDetail?.()
    const content = element(
      'span',
      undefined,
      error ? 'copy-error' : 'copy-progress'
    )
    content.append(
      element(
        'span',
        isMessage(message) ? message : uiMessage(message),
        'copy-detail-text'
      )
    )
    if (cancel) content.append(cancel)
    state.detail = content
    content.id = `copy-detail-${crypto.randomUUID()}`
    content.setAttribute('role', error ? 'alert' : 'status')
    content.setAttribute('aria-live', error ? 'assertive' : 'polite')
    const description = button.getAttribute('aria-describedby') || ''
    button.setAttribute(
      'aria-describedby',
      `${description} ${content.id}`.trim()
    )
    button.after(content)
    const view = button.ownerDocument.defaultView
    const events = new AbortController()
    const position = () => {
      if (!button.isConnected) return state.clearDetail?.()
      const anchor = button.getBoundingClientRect?.()
      if (!anchor) return
      const width = view.innerWidth,
        height = view.innerHeight
      const visible =
        button.getClientRects?.().length !== 0 &&
        anchor.bottom > 0 &&
        anchor.top < height &&
        anchor.right > 0 &&
        anchor.left < width
      if (content.hidden === visible) content.hidden = !visible
      if (!visible) {
        if (content.hidePopover && content.matches(':popover-open'))
          content.hidePopover()
        return
      }
      if (content.showPopover && !content.matches(':popover-open'))
        content.showPopover()
      const box = content.getBoundingClientRect()
      content.style.left = `${Math.max(8, Math.min(anchor.left, width - box.width - 8))}px`
      content.style.top = `${Math.max(8, anchor.bottom + box.height + 12 <= height ? anchor.bottom + 6 : anchor.top - box.height - 6)}px`
    }
    state.clearDetail = () => {
      events.abort()
      observer?.disconnect()
      resizeObserver?.disconnect()
      content.remove()
      const ids = (button.getAttribute('aria-describedby') || '')
        .split(/\s+/)
        .filter((id) => id && id !== content.id)
      if (ids.length) button.setAttribute('aria-describedby', ids.join(' '))
      else button.removeAttribute('aria-describedby')
      state.detail = null
      state.positionDetail = null
      state.clearDetail = null
    }
    const observer =
      globalThis.MutationObserver && new MutationObserver(position)
    const resizeObserver =
      globalThis.ResizeObserver && new ResizeObserver(position)
    resizeObserver?.observe(button)
    observer?.observe(button.ownerDocument, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden'],
    })
    if (content.showPopover) content.setAttribute('popover', 'manual')
    view?.addEventListener('resize', position, { signal: events.signal })
    view?.addEventListener('scroll', position, {
      signal: events.signal,
      capture: true,
    })
    state.positionDetail = position
    position()
  }
  show('Copying…', 'refresh')
  let completed = false
  try {
    completed = (await task(detail)) !== false
    state.clearDetail?.()
    if (!completed) return false
    show('Copied', 'check')
    button.classList.add('copied')
    return true
  } catch (error) {
    if (onError) onError(error)
    else detail(error.message, { error: true })
    show('Try again', 'refresh')
    button.classList.add('copy-failed')
    return false
  } finally {
    button.disabled = false
    button.removeAttribute('aria-busy')
    if (!completed && !button.classList.contains('copy-failed')) reset()
    else copyTimers.set(button, setTimeout(reset, 3000))
  }
}

export const yieldUI = () =>
  globalThis.scheduler?.yield
    ? scheduler.yield()
    : new Promise((resolve) => setTimeout(resolve, 0))
