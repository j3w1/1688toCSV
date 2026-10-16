import { bindAttribute, bindText, message, t, getLocale } from './i18n.js'
import { importProgress } from './import-progress.js'

export const floatingPanelStyles = `
  .floating-panel-heading { display:flex; align-items:flex-start; gap:8px; }
  .floating-panel-heading > :first-child { flex:1; min-width:0; margin:0; }
  button.floating-panel-toggle { display:grid; place-items:center; min-width:26px; width:26px; height:26px; min-height:26px; padding:0; margin:0; flex:0 0 26px; border:0; background:transparent; color:inherit; font:20px/1 system-ui,sans-serif; border-radius:4px; }
  button.floating-panel-toggle:hover { background:var(--hover); }
  button.floating-panel-toggle:focus-visible { outline:2px solid var(--focus); outline-offset:2px; }
  .floating-panel-body { margin-top:8px; }
  .floating-panel-summary { margin:5px 0 0; font-size:11px; overflow-wrap:anywhere; }
  aside.floating-panel-minimized, aside[data-importing].floating-panel-minimized { width:260px; }
  .floating-panel-summary[data-state='running'] { color:var(--info-text); }
  .floating-panel-summary[data-state='attention'] { color:var(--danger-text); }
  .floating-panel-summary[data-state='completed'] { color:var(--success-text); }
  @media(forced-colors:active) { .floating-panel-summary[data-state] {color:CanvasText;} button.floating-panel-toggle:focus-visible {outline-color:Highlight;} }
`

export function compactImportProgress(input) {
  if (!input) return { text: t('Import controls'), state: 'idle' }
  const job = importProgress(input)
  const number = (value) => value.toLocaleString(getLocale())
  const text =
    job.state === 'running' && job.phase === 'scan'
      ? t('Finding orders · {count} found', { count: number(job.discovered) })
      : t('{state} · {saved}/{total} saved', {
          state: t(
            job.state === 'running'
              ? 'Importing'
              : job.state === 'completed'
                ? 'Completed'
                : job.state === 'completed-with-errors'
                  ? 'Needs attention'
                  : 'Paused'
          ),
          saved: number(job.completed),
          total: number(job.total),
        })
  return {
    text: job.failed
      ? `${text} · ${t('{count} need attention', { count: number(job.failed) })}`
      : text,
    state:
      job.state === 'running'
        ? 'running'
        : job.state === 'completed'
          ? 'completed'
          : 'attention',
  }
}

/** Collapse presentation only; the importer and its polling keep running. */
export function mountFloatingPanel(document, { panel, body, title, key }) {
  const header = document.createElement('div'),
    toggle = document.createElement('button'),
    symbol = document.createElement('span'),
    summary = document.createElement('p')
  header.className = 'floating-panel-heading'
  toggle.className = 'floating-panel-toggle'
  toggle.type = 'button'
  symbol.setAttribute('aria-hidden', 'true')
  toggle.append(symbol)
  body.classList.add('floating-panel-body')
  body.id = `floating-body-${key}`
  toggle.setAttribute('aria-controls', body.id)
  summary.className = 'floating-panel-summary'
  summary.setAttribute('role', 'status')
  header.append(title, toggle)
  panel.prepend(header, summary)
  const storageKey = `1688-floating-panel-${key}-minimized`
  let minimized = false,
    currentJob = null
  try {
    minimized =
      document.defaultView.sessionStorage.getItem(storageKey) === 'true'
  } catch {}
  function paint() {
    panel.classList.toggle('floating-panel-minimized', minimized)
    body.hidden = minimized
    summary.hidden = !minimized
    toggle.setAttribute('aria-expanded', String(!minimized))
    bindAttribute(
      toggle,
      'aria-label',
      message(minimized ? 'Restore import panel' : 'Minimize import panel')
    )
    bindAttribute(
      toggle,
      'title',
      message(
        minimized
          ? 'Show import controls and details.'
          : 'Hide the panel controls. Import continues in the background.'
      )
    )
    symbol.textContent = minimized ? '＋' : '−'
    const display = compactImportProgress(currentJob)
    bindText(summary, () => compactImportProgress(currentJob).text)
    summary.dataset.state = display.state
  }
  toggle.addEventListener('click', () => {
    minimized = !minimized
    try {
      document.defaultView.sessionStorage.setItem(storageKey, String(minimized))
    } catch {}
    paint()
  })
  paint()
  return {
    update(job) {
      currentJob = job
      paint()
    },
    get minimized() {
      return minimized
    },
  }
}
