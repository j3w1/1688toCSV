import { attributeMessage, textMessage, isMessage, message } from './i18n.js'
import { preparationHelp } from './preparation-help.js'
import { ACTION_HELP_RULES } from './ui-messages-action-help.js'

const descriptions = new Map(
  ACTION_HELP_RULES.flatMap(([actions, text]) =>
    actions.map((action) => [action, text])
  )
)
const stableDescriptions = new Map([
  [
    'review-recovered-carton-draft',
    'This draft uses an earlier order revision or amendment. Review every retained value against the current order before using it. Physical identities and revision checks still apply.',
  ],
  [
    'review-recovered-carton-report',
    'This report draft belongs to an earlier amendment. Review its original source and decisions before using it in the current review.',
  ],
  [
    'review-purchase-codes',
    'Review codes in Orders using each original purchase month. No codes are reserved until assignment.',
  ],
  [
    'include-container-orders',
    'Reserve the current eligible remainder of whole orders. Loading decisions remain unconfirmed.',
  ],
  [
    'preview-carton-paste',
    'Preview every source key and value before changing the draft. Changed filters or edits invalidate this alignment.',
  ],
  [
    'confirm-order-cartons',
    'Confirm the physical arrangement once for this order. Capacity-only edits remain proposals until confirmation.',
  ],
  [
    'mark-all-loaded',
    'Mark all included logical cartons loaded, including rows outside the current display filter.',
  ],
  [
    'review-container-seal',
    'Check quantities, exclusivity and current evidence before sealing this complete container revision.',
  ],
  [
    'export-packing-list',
    'Export the full container revision. Display filters and product selections do not reduce its membership.',
  ],
  [
    'edit-in-orders',
    'Open the corresponding source in Orders and retain the container return route.',
  ],
])
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
  const text =
    stableDescriptions.get(target.dataset.action) || descriptions.get(label)
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
