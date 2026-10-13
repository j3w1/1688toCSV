const panelKey = Symbol.for('1688tocsv.savePanelCleanup')

// Keep the ordinary file link in the order document, not the short-lived
// extension popup. No export data leaves this document or enters storage.
export function openSavePanel(document, file) {
  const view = document.defaultView
  view[panelKey]?.()
  const host = document.createElement('div')
  const root = host.attachShadow({ mode: 'open' })
  const url = view.URL.createObjectURL(
    new view.Blob([file.csv], { type: 'text/csv;charset=utf-8' })
  )
  function element(tag, text, parent = root) {
    const node = document.createElement(tag)
    if (text) node.textContent = text
    parent.appendChild(node)
    return node
  }
  element(
    'style',
    `
    dialog { color-scheme: light; box-sizing: border-box; width: min(420px, calc(100vw - 32px));
      max-height: calc(100vh - 32px); overflow: auto; margin: auto; padding: 24px;
      border: 1px solid #dfe3d7; border-radius: 16px; color: #252820; background: #f7f7f2;
      box-shadow: 0 12px 50px #0003; font: 14px/1.5 system-ui, sans-serif; }
    dialog::backdrop { background: #0005; }
    h2 { margin: 0 0 12px; font-size: 22px; line-height: 1.2; }
    p { margin: 12px 0; }
    .filename { overflow-wrap: anywhere; font-size: 12px; color: #58614f; }
    a, button { box-sizing: border-box; display: block; width: 100%; border-radius: 8px;
      padding: 12px; font: inherit; text-align: center; cursor: pointer; }
    a { background: #ff5b20; color: white; text-decoration: none; font-weight: 650; }
    button { margin-top: 12px; border: 1px solid #adb79e; background: white; color: #385128; }
    :focus-visible { outline: 3px solid #456fba; outline-offset: 3px; }
    .note { font-size: 12px; color: #58614f; }
  `
  )
  const dialog = element('dialog')
  dialog.setAttribute('aria-label', 'Save order CSV')
  element('h2', 'Save your order CSV', dialog)
  element('p', 'Your CSV is ready. Save it using the link below.', dialog)
  element('p', file.filename, dialog).className = 'filename'
  const link = element('a', 'Save CSV', dialog)
  link.href = url
  link.download = file.filename
  const status = element('p', 'Processed locally. No uploads.', dialog)
  status.className = 'note'
  status.setAttribute('role', 'status')
  link.addEventListener('click', () => {
    status.textContent =
      'Save requested. Complete any save dialog and check your downloads before closing this panel.'
  })
  const close = element('button', 'Close', dialog)
  close.type = 'button'
  const cleanup = () => {
    view.removeEventListener('pagehide', cleanup)
    view.URL.revokeObjectURL(url)
    host.remove()
    if (view[panelKey] === cleanup) delete view[panelKey]
  }
  view[panelKey] = cleanup
  view.addEventListener('pagehide', cleanup, { once: true })
  close.addEventListener('click', () => dialog.close())
  dialog.addEventListener('close', cleanup, { once: true })
  document.body.appendChild(host)
  try {
    dialog.showModal()
    link.focus()
  } catch (error) {
    cleanup()
    throw error
  }
}
