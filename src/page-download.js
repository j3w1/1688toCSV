import { createProgressView, importProgressStyles } from './import-progress.js'
import { mountFloatingPanel, floatingPanelStyles } from './floating-panel.js'
import { mountPanelAppearance } from './panel-appearance.js'

const controlKey = Symbol.for('1688topl.pageDownloadCleanup')

// Keep the native download link in the order document. Generate the current
// file synchronously during its click, before the browser follows the link.
export function mountPageDownload(document, prepareFile, actions = {}) {
  const view = document.defaultView
  view[controlKey]?.()
  const host = document.createElement('div')
  const root = host.attachShadow({ mode: 'open' })
  const releaseAppearance = mountPanelAppearance(host)
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
    aside { box-sizing: border-box; width: 240px;
      max-width: calc(100vw - 32px); padding: 12px; border: 1px solid var(--border);
      border-radius: 12px; color: var(--text); background: var(--surface);
      box-shadow: 0 4px 20px #0002; font: 13px/1.5 system-ui, sans-serif; }
    .brand { margin: 0 0 8px; font-size: 11px; font-weight: 650; color: var(--muted); }
    a { box-sizing: border-box; display: block; padding: 11px 16px;
      border-radius: 8px; background: var(--accent); color: var(--on-accent); text-decoration: none;
      text-align: center; font-weight: 650; }
    a:hover { background: var(--accent-hover); }
    a:focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; }
    .status { margin: 8px 0 0; overflow-wrap: anywhere; font-size: 12px; color: var(--muted); }
    .status:empty { margin: 0; }
    .status[data-tone='error'] { color: var(--danger-text); }
    .library-actions { display: flex; gap: 6px; margin-top: 8px; }
    button { font: inherit; cursor: pointer; flex: 1; padding: 8px 5px;
      border: 1px solid var(--border); border-radius: 6px; background: var(--field); color: var(--text); font-size: 11px; }
    button:hover { background: var(--hover); }
    button:focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; }
    [hidden] { display: none !important; }
    aside[data-importing] { width: 300px; max-height: calc(100dvh - 32px); overflow-y: auto; }
    .import-section { border-top: 1px solid var(--border); margin-top: 10px; padding-top: 10px; }
    .import-section button { width: 100%; margin-top: 6px; }
    ${importProgressStyles}
    ${floatingPanelStyles}
  `
  )
  const control = element('aside')
  control.setAttribute('aria-label', '1688toPL')
  const panelBody = element('div', '', control)
  const title = document.createElement('p')
  title.textContent = '1688toPL · Order export'
  title.className = 'brand'
  const disclosure = mountFloatingPanel(document, {
    panel: control,
    body: panelBody,
    title,
    key: 'detail',
  })
  const link = element('a', 'Download CSV', panelBody)
  link.href = '#'
  link.download = ''
  const status = element('p', '', panelBody)
  status.className = 'status'
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  if (actions.saveOrder || actions.openLibrary) {
    const buttons = element('div', '', panelBody)
    buttons.className = 'library-actions'
    for (const [label, handler] of [
      ['Save order', actions.saveOrder],
      ['Open Workspace', actions.openLibrary],
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
  const collection = element('div', '', panelBody)
  collection.className = 'import-section'
  collection.hidden = true
  const progressView = createProgressView(document)
  collection.append(progressView.element)
  let currentJob
  if (actions.pauseImport) {
    const pause = element('button', 'Pause import', collection)
    pause.addEventListener('click', async () => {
      if (!currentJob) return
      pause.disabled = true
      pause.textContent = 'Pausing…'
      try {
        await actions.pauseImport(currentJob.id)
        status.textContent =
          'Import paused. Resume from Activity or the order list.'
        status.dataset.tone = 'notice'
        updateProgress(null)
      } catch (error) {
        status.textContent = error.message
        status.dataset.tone = 'error'
      } finally {
        pause.disabled = false
        pause.textContent = 'Pause import'
      }
    })
  }
  function updateProgress(job) {
    currentJob = job
    disclosure.update(job)
    collection.hidden = !job
    control.toggleAttribute('data-importing', Boolean(job))
    if (job) progressView.update(job)
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
    view.removeEventListener('pagehide', pageHidden)
    view.removeEventListener('pageshow', pageShown)
    actions.dispose?.()
    releaseAppearance()
    releaseFile()
    host.remove()
    if (view[controlKey] === cleanup) delete view[controlKey]
  }
  function pageHidden(event) {
    if (!event.persisted) return cleanup()
    releaseFile()
    actions.suspend?.()
  }
  function pageShown(event) {
    if (event.persisted) actions.resume?.()
  }
  view[controlKey] = cleanup
  view.addEventListener('pagehide', pageHidden)
  view.addEventListener('pageshow', pageShown)
  document.body.appendChild(host)
  return { updateProgress, dispose: cleanup }
}
