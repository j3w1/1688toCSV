import {
  bindAttribute,
  textMessage,
  attributeMessage,
  message,
  isMessage,
} from './i18n.js'

const paths = {
  settings:
    'M10 2h4l.5 3 1.5.6L18.5 4 20 5.5 18.4 8l.6 1.5 3 .5v4l-3 .5-.6 1.5 1.6 2.5-1.5 1.5-2.5-1.6-1.5.6-.5 3h-4l-.5-3-1.5-.6L5.5 20 4 18.5 5.6 16 5 14.5 2 14v-4l3-.5L5.6 8 4 5.5 5.5 4 8 5.6 9.5 5zM15 12a3 3 0 1 0-6 0 3 3 0 0 0 6 0',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  copy: 'M9 8h11v13H9zM5 16H3V3h11v2',
  image: 'M3 3h18v18H3zM3 17l6-6 4 4 3-3 5 5M8 7h.01',
  barcode: 'M3 4v16M6 4v16M10 4v16M12 4v16M16 4v16M18 4v16M21 4v16',
  carton: 'M12 2 23 22H1zM10.2 12a3 3 0 1 0 0 6M17 12h-4v6h4M13 15h3',
  table: 'M3 3h18v18H3zM3 9h18M9 9v12',
  store:
    'M3 10v11h18V10M2 6l2-4h16l2 4v4a3 3 0 0 1-5 2 3 3 0 0 1-5 0 3 3 0 0 1-5 0 3 3 0 0 1-5-2V6zM9 21v-6h6v6',
  packing: 'M3 7l9-5 9 5v11l-9 4-9-4zM3 7l9 5 9-5M12 12v10M7 5l10 5',
  refresh: 'M20 7a9 9 0 1 0 1 8M20 2v5h-5',
  trash: 'M3 6h18M8 6V3h8v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
  close: 'M6 6l12 12M18 6 6 18',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  upload: 'M12 15V3m-5 5 5-5 5 5M4 16v5h16v-5',
  undo: 'M8 4 3 9l5 5M3 9h10a7 7 0 0 1 0 14',
  redo: 'M16 4l5 5-5 5M21 9H11a7 7 0 0 0 0 14',
  chevron: 'm7 10 5 5 5-5',
  search: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14M15 15l6 6',
  text: 'M4 5h16M12 5v15M8 20h8',
  plus: 'M12 5v14M5 12h14',
  previous: 'm14 5-7 7 7 7',
  next: 'm10 5 7 7-7 7',
  check: 'm4 12 5 5L20 6',
  external: 'M14 3h7v7M21 3 10 14M10 3H3v18h18v-7',
  edit: 'm14 4 6 6M3 21l5-1L21 7l-5-5L3 15z',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1',
  moon: 'M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11',
}

export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.7')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  svg.classList.add('ui-icon')
  const path = document.createElementNS(svg.namespaceURI, 'path')
  path.setAttribute('d', paths[name] || paths.copy)
  svg.append(path)
  return svg
}

export function decorateIcon(button, name, { iconOnly = false, label } = {}) {
  button.querySelector(':scope > .ui-icon')?.remove()
  button.dataset.icon = name
  if (iconOnly) {
    const accessible =
      label ||
      attributeMessage(button, 'aria-label') ||
      textMessage(button) ||
      button.textContent.trim()
    button.replaceChildren()
    bindAttribute(
      button,
      'aria-label',
      isMessage(accessible) ? accessible : message(accessible)
    )
    bindAttribute(
      button,
      'title',
      isMessage(accessible) ? accessible : message(accessible)
    )
    button.classList.add('icon-button')
  }
  button.prepend(icon(name))
  return button
}
