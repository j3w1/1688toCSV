const controlKey = Symbol.for('1688tocsv.pageDownloadCleanup')

// Keep the native download link in the order document. Generate the current
// file synchronously during its click, before the browser follows the link.
export function mountPageDownload(document, prepareFile, actions = {}) {
  const view = document.defaultView
  view[controlKey]?.()
  const host = document.createElement('div')
  const root = host.attachShadow({ mode: 'open' })
  let url
  function element(tag, text, parent = root) {
    const node = document.createElement(tag)
    if (text) node.textContent = text
    parent.appendChild(node)
    return node
  }
  element(
    'style',
    `
    :host { all: initial; position: fixed; inset: auto 16px 16px auto;
      z-index: 2147483647; display: block; max-width: calc(100vw - 32px); }
    aside { color-scheme: light; box-sizing: border-box; width: 240px;
      max-width: calc(100vw - 32px); padding: 12px; border: 1px solid #dfe3d7;
      border-radius: 12px; color: #252820; background: #f7f7f2;
      box-shadow: 0 4px 20px #0002; font: 13px/1.5 system-ui, sans-serif; }
    .brand { margin: 0 0 8px; font-size: 11px; font-weight: 650; color: #58614f; }
    a { box-sizing: border-box; display: block; padding: 11px 16px;
      border-radius: 8px; background: #e64b10; color: white; text-decoration: none;
      text-align: center; font-weight: 650; }
    a:hover { background: #c93e08; }
    a:focus-visible { outline: 3px solid #456fba; outline-offset: 3px; }
    .status { margin: 8px 0 0; overflow-wrap: anywhere; font-size: 12px; color: #58614f; }
    .status:empty { margin: 0; }
    .status[data-tone='error'] { color: #972e21; }
    .library-actions { display: flex; gap: 6px; margin-top: 8px; }
    button { font: inherit; cursor: pointer; flex: 1; padding: 8px 5px;
      border: 1px solid #d9dfd2; border-radius: 6px; background: white; color: #52634b; font-size: 11px; }
    button:hover { background: #e9eee2; }
    button:focus-visible { outline: 3px solid #456fba; outline-offset: 3px; }
  `
  )
  const control = element('aside')
  control.setAttribute('aria-label', '1688toCSV')
  element('p', '1688toCSV · Order export', control).className = 'brand'
  const link = element('a', 'Download CSV', control)
  link.href = '#'
  link.download = ''
  const status = element('p', '', control)
  status.className = 'status'
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  if (actions.saveOrder || actions.openLibrary) {
    const buttons = element('div', '', control)
    buttons.className = 'library-actions'
    for (const [label, handler] of [
      ['Save order', actions.saveOrder],
      ['Spreadsheet ↗', actions.openLibrary],
    ]) {
      if (!handler) continue
      const button = element('button', label, buttons)
      button.addEventListener('click', async () => {
        button.disabled = true
        try {
          status.dataset.tone = 'notice'
          status.textContent = (await handler()) || ''
        } catch (error) {
          status.dataset.tone = 'error'
          status.textContent = error.message
        } finally {
          button.disabled = false
        }
      })
    }
  }
  function releaseFile() {
    if (url) view.URL.revokeObjectURL(url)
    url = undefined
    link.href = '#'
    link.download = ''
  }
  link.addEventListener('click', (event) => {
    releaseFile()
    try {
      const file = prepareFile()
      url = view.URL.createObjectURL(
        new view.Blob([file.csv], { type: 'text/csv;charset=utf-8' })
      )
      link.href = url
      link.download = file.filename
      status.dataset.tone = 'notice'
      status.textContent = `Save requested: ${file.filename}. Check your downloads.`
    } catch (error) {
      event.preventDefault()
      releaseFile()
      status.dataset.tone = 'error'
      status.textContent =
        error.message || 'Could not read the order. Refresh and try again.'
    }
  })
  function cleanup() {
    view.removeEventListener('pagehide', releaseFile)
    releaseFile()
    host.remove()
    if (view[controlKey] === cleanup) delete view[controlKey]
  }
  view[controlKey] = cleanup
  view.addEventListener('pagehide', releaseFile)
  document.body.appendChild(host)
}
