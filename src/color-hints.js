import { getItemColorHints } from './color-vocabulary.js'
import { bindText, bindAttribute, getLanguage, message } from './i18n.js'

/** Display-only translations; never replace the seller's variant description. */
export function createColorHints(item) {
  const hints = colorHints([item])
  return hints.childElementCount ? hints : null
}

export function colorHints(items) {
  const getHints = () => [
    ...new Map(
      items
        .flatMap((item) => getItemColorHints(item, getLanguage()))
        .map((hint) => [hint.id, hint])
    ).values(),
  ]
  const hints = getHints()
  const list = document.createElement('span')
  list.className = 'product-color-hints'
  for (const hint of hints) {
    const chip = document.createElement('span')
    chip.className = 'product-color-hint'
    chip.dataset.color = hint.id
    bindAttribute(
      chip,
      'title',
      message('Seller color: {source}', { source: hint.source })
    )
    if (hint.swatch) {
      const swatch = document.createElement('i')
      swatch.setAttribute('aria-hidden', 'true')
      swatch.style.backgroundColor = hint.swatch
      chip.append(swatch)
    }
    const label = document.createElement('span')
    bindText(
      label,
      () =>
        getHints().find((value) => value.id === hint.id)?.label || hint.source
    )
    chip.append(label)
    list.append(chip)
  }
  return list
}
