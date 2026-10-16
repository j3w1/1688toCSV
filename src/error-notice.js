import { message, isMessage } from './i18n.js'
import { decorateIcon } from './icons.js'
import { element, orderReference } from './ui.js'

const notices = new WeakMap()
const visible = new Set()
let listening = false

function currentScope() {
  return (
    [...document.querySelectorAll('dialog[open]')].at(-1) ||
    document.querySelector('#packing-view:not([hidden])') ||
    document.querySelector('#orders-view:not([hidden])') ||
    document.body
  )
}

const translated = (value) => (isMessage(value) ? value : message(value))

/** Nonmodal feedback: leave focus and draft values exactly where they are. */
export function showErrorNotice(
  text,
  {
    scope = currentScope(),
    key = 'operation',
    title = 'Could not complete',
    detail = '',
    action,
    context,
    deduplicate = false,
  } = {}
) {
  if (
    text instanceof Error ||
    (text && typeof text === 'object' && !isMessage(text) && text.message)
  ) {
    const error = text
    text = error.message
    const options = error.noticeOptions || {}
    detail ||= options.detail || ''
    action ||= options.action
    context ||= options.context
  }
  if (
    !scope?.isConnected ||
    scope.closest('[hidden]') ||
    (scope.matches('dialog') && !scope.open)
  )
    return
  const signature = [title, text, detail].map(String).join('\n')
  const previous = notices.get(scope)
  // Repeated autosave/status updates must not reopen a dismissed error.
  if (
    previous?.key === key &&
    previous.signature === signature &&
    (deduplicate || previous.panel.isConnected)
  )
    return
  previous?.dismiss()
  const panel = element('aside', undefined, 'error-notice')
  const heading = element('strong', translated(title), 'error-notice-title')
  const body = element('p', translated(text), 'error-notice-message')
  const content = element('div', undefined, 'error-notice-content')
  content.setAttribute('role', 'alert')
  content.setAttribute('aria-atomic', 'true')
  content.append(heading, body)
  if (context) {
    const identity = element('div', undefined, 'error-notice-product')
    if (context.thumbnail) {
      const image = element('img')
      image.alt = ''
      image.width = image.height = 48
      identity.append(image)
      void (async () => {
        try {
          const url = await (typeof context.thumbnail === 'function'
            ? context.thumbnail()
            : context.thumbnail)
          if (image.isConnected) image.src = url
        } catch {
          image.remove()
        }
      })()
    }
    const values = element('div')
    if (context.seller) values.append(element('div', String(context.seller)))
    if (context.orderId) values.append(orderReference(context.orderId))
    if (context.code)
      values.append(element('code', String(context.code), 'ce-code'))
    if (context.variant) values.append(element('div', String(context.variant)))
    identity.append(values)
    content.append(identity)
  }
  if (detail)
    content.append(element('p', translated(detail), 'error-notice-detail'))
  panel.append(content)
  const state = { key, signature, panel, scope, dismiss: null }
  const dismiss = () => {
    panel.remove()
    observer.disconnect()
    visible.delete(state)
  }
  state.dismiss = dismiss
  const close = decorateIcon(
    element('button', undefined, 'error-notice-close'),
    'close',
    { iconOnly: true, label: message('Dismiss error') }
  )
  close.type = 'button'
  close.addEventListener('click', dismiss)
  panel.append(close)
  if (action) {
    const resolve = element(
      'button',
      translated(action.label),
      'error-notice-action'
    )
    resolve.type = 'button'
    resolve.addEventListener('pointerdown', (event) => {
      if (event.button === 0) event.preventDefault()
    })
    resolve.addEventListener('click', async () => {
      dismiss()
      try {
        await action.onClick()
      } catch (error) {
        clearErrorNotice({ scope, key })
        const nextScope =
          scope.isConnected &&
          !scope.closest('[hidden]') &&
          (!scope.matches('dialog') || scope.open)
            ? scope
            : currentScope()
        showErrorNotice(error, {
          scope: nextScope,
          key,
          title,
          detail,
          action,
          context,
        })
      }
    })
    panel.append(resolve)
  }
  const observer = new MutationObserver(() => {
    if (
      !scope.isConnected ||
      scope.closest('[hidden]') ||
      (scope.matches('dialog') && !scope.open) ||
      !panel.isConnected
    )
      clearErrorNotice({ scope, key })
  })
  notices.set(scope, state)
  visible.add(state)
  scope.append(panel)
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['hidden', 'open'],
  })
  if (!listening) {
    listening = true
    document.addEventListener(
      'keydown',
      (event) => {
        if (
          event.key !== 'Escape' ||
          event.defaultPrevented ||
          document.querySelector('[popover="auto"]:popover-open') ||
          event.target.closest?.('.label-editor-field, .label-code-part')
        )
          return
        const active = [...visible].findLast(
          (notice) => notice.scope === currentScope()
        )
        if (!active) return
        active.dismiss()
        event.preventDefault()
        event.stopPropagation()
      },
      true
    )
  }
}

export function clearErrorNotice({
  scope = currentScope(),
  key = 'operation',
} = {}) {
  const notice = notices.get(scope)
  if (!notice || notice.key !== key) return
  notice.dismiss()
  notices.delete(scope)
}

export function clearErrorNotices(scope = currentScope()) {
  const notice = notices.get(scope)
  notice?.dismiss()
  notices.delete(scope)
}
