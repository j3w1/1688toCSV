import { element, copied } from './ui.js'
import { decorateIcon } from './icons.js'
import { preparationHelp } from './preparation-help.js'

/** Sibling controls keep copying independent of opening or selecting a photo. */
export function photoCopyTile(
  photoButton,
  copyTask,
  {
    disabled = false,
    label = 'Copy image',
    help = 'Copy the full-size product picture. Paste it into Excel or a message.',
    onError,
  } = {}
) {
  const tile = element('div', undefined, 'photo-copy-tile')
  if (
    photoButton.matches(
      '.preparation-photo, .product-photo-button, .store-import-photo-button'
    )
  )
    tile.classList.add('photo-copy-square')
  photoButton.classList.add('photo-copy-source')
  const copy = element('button', undefined, 'photo-copy-button')
  copy.type = 'button'
  copy.disabled = disabled || !copyTask
  decorateIcon(copy, 'copy', { iconOnly: true, label })
  preparationHelp(copy, help)
  copy.addEventListener('click', (event) => {
    event.stopPropagation()
    void copied(copy, copyTask, { onError })
  })
  copy.addEventListener('dblclick', (event) => event.stopPropagation())
  tile.append(photoButton, copy)
  return tile
}
