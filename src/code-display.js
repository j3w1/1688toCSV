// Readable UI codes preserve their raw text. Excel table images explicitly
// reuse the product split; barcode-label/carton/PDF artwork stays unmarked.
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

const inputReaders = new WeakMap()
const inputMeasurers = new WeakMap()

export function refreshCodeInput(input) {
  inputReaders.get(input)?.()
}

/** Paint behind the original native value; never wrap, hide or replace it. */
export function decorateCodeInput(input) {
  if (inputReaders.has(input)) return input
  const doc = input.ownerDocument
  const refresh = () => {
    const parts = codeParts(input.value)
    const readable = Boolean(parts && input.isConnected)
    input.classList.toggle('ce-code-input-readable', readable)
    if (!readable) return
    let context = inputMeasurers.get(doc)
    if (!context) {
      context = doc.createElement('canvas').getContext('2d')
      inputMeasurers.set(doc, context)
    }
    const style = doc.defaultView.getComputedStyle(input)
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    context.fontKerning = 'none'
    const prefix = context.measureText(parts[0]).width
    const product = context.measureText(parts[1]).width
    const full = context.measureText(input.value).width
    input.style.setProperty('--ce-code-underline-width', `${product}px`)
    input.style.setProperty(
      '--ce-code-underline-shift',
      `${prefix + product / 2 - full / 2}px`
    )
  }
  for (const event of ['input', 'change', 'blur'])
    input.addEventListener(event, refresh)
  inputReaders.set(input, refresh)
  doc.defaultView.requestAnimationFrame(refresh)
  return input
}
