import { element, copied } from './ui.js'
import { decorateIcon } from './icons.js'
import { preparationHelp } from './preparation-help.js'

/** Sibling controls keep copying independent of opening or selecting a photo. */
export function photoCopyTile(
  photoButton,
  copyTask,
  { disabled = false } = {}
) {
  const tile = element('div', undefined, 'photo-copy-tile')
  const copy = element('button', undefined, 'photo-copy-button')
  copy.type = 'button'
  copy.disabled = disabled || !copyTask
  decorateIcon(copy, 'copy', { iconOnly: true, label: 'Copy image' })
  preparationHelp(
    copy,
    'Copy the full-size product picture. Paste it into Excel or a message.'
  )
  copy.addEventListener('click', (event) => {
    event.stopPropagation()
    void copied(copy, copyTask)
  })
  copy.addEventListener('dblclick', (event) => event.stopPropagation())
  tile.append(photoButton, copy)
  return tile
}
