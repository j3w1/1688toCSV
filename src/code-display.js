// Workspace-only reading aids. Renderers/exporters always use the raw code
// and the shared black/white artwork in code-design.js.
export const CODE_READING_HELP =
  'The underline identifies the four-digit product number. CE and year/month stay together; code values are unchanged.'

export function codeParts(value) {
  const match = /^(CE\d{4})(\d{4})([A-Z0-9]*)$/.exec(String(value ?? ''))
  return match ? match.slice(1).filter(Boolean) : null
}

/** No inserted characters: textContent, selections and copy values stay exact. */
export function setCodeText(element, value) {
  const text = String(value ?? '')
  const parts = codeParts(text)
  element.classList.toggle('ce-code-readable', Boolean(parts))
  if (!parts) {
    element.textContent = text
    return false
  }
  element.replaceChildren(
    ...parts.map((part, index) => {
      const span = element.ownerDocument.createElement('span')
      span.className = 'ce-code-part'
      span.dataset.codePart = ['prefix-period', 'product', 'ending'][index]
      span.textContent = part
      return span
    })
  )
  return true
}
