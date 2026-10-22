import { normalizeCartonConfirmation } from './carton-confirmations.js'
import { mountCartonNumber } from './carton-measurements-ui.js'

export function mountCartonConfirmation(host, { field, value, onSave }) {
  const editor = mountCartonNumber(host, {
    field,
    value,
    onSave,
    normalize(value) {
      const count = normalizeCartonConfirmation(value)
      return count === null ? '' : String(count)
    },
    label: field === 'received' ? 'Received boxes' : 'Loaded boxes',
    help:
      field === 'received'
        ? 'Confirmed boxes received for this packing month. Blank means unknown; zero means none. Shared supplier rows are counted once. Saves automatically.'
        : 'Confirmed boxes loaded into the container for this packing month. Blank means unknown; zero means none. Shared supplier rows are counted once. Saves automatically.',
    inputMode: 'numeric',
    pattern: '[0-9]+',
  })
  editor.control.classList.add('carton-confirmation')
  return editor
}
