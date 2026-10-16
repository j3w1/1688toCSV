import { attributeMessage, textMessage, isMessage, message } from './i18n.js'
import { preparationHelp } from './preparation-help.js'
import { ACTION_HELP_RULES } from './ui-messages-action-help.js'

const descriptions = new Map(
  ACTION_HELP_RULES.flatMap(([actions, text]) =>
    actions.map((action) => [action, text])
  )
)
const installed = new WeakSet()
const source = (value) => (isMessage(value) ? value.source : value)

/** Use explicit UI bindings, never guess an action from seller/product text. */
export function actionHelp(target, { replace = false } = {}) {
  if (!replace && target.classList.contains('preparation-hint')) return target
  const label =
    source(attributeMessage(target, 'aria-label')) ||
    target.getAttribute('data-i18n-aria-label') ||
    source(textMessage(target)) ||
    target.getAttribute('data-i18n')
  const text = descriptions.get(label)
  if (text) preparationHelp(target, message(text))
  return target
}

/** One delegated hook also covers controls created later in settings/popups. */
export function installWorkspaceActionHelp(doc) {
  if (installed.has(doc)) return
  installed.add(doc)
  const attach = (event) => {
    const target = event.target.closest?.('button, a, summary')
    if (target) actionHelp(target)
  }
  for (const name of ['pointerover', 'focusin'])
    doc.addEventListener(name, attach, true)
}
