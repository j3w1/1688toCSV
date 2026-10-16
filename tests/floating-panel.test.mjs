import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import {
  mountFloatingPanel,
  compactImportProgress,
} from '../src/floating-panel.js'
import { setLanguage } from '../src/i18n.js'

test('minimizing preserves active import progress and only changes presentation', () => {
  const { document } = parseHTML(
    '<html><body><aside><div id="body"><button>Pause import</button></div></aside></body></html>'
  )
  const panel = document.querySelector('aside'),
    body = document.querySelector('#body'),
    title = document.createElement('strong')
  title.textContent = 'Synthetic import'
  const disclosure = mountFloatingPanel(document, {
    panel,
    body,
    title,
    key: 'synthetic',
  })
  const job = {
      id: 'synthetic',
      state: 'running',
      phase: 'details',
      total: 12,
      completed: 3,
      failed: 1,
    },
    before = structuredClone(job)
  disclosure.update(job)
  const toggle = panel.querySelector('.floating-panel-toggle')
  toggle.click()
  assert.equal(disclosure.minimized, true)
  assert.equal(body.hidden, true)
  assert.equal(toggle.getAttribute('aria-expanded'), 'false')
  assert.match(
    panel.querySelector('.floating-panel-summary').textContent,
    /Importing · 3\/12 saved · 1 need attention/
  )
  disclosure.update({ ...job, completed: 8 })
  assert.match(
    panel.querySelector('.floating-panel-summary').textContent,
    /8\/12/
  )
  toggle.click()
  assert.equal(body.hidden, false)
  assert.equal(disclosure.minimized, false)
  assert.deepEqual(job, before)
})
test('compact importing, scanning and paused summaries translate into each workspace language', () => {
  const current = {
    state: 'running',
    phase: 'details',
    total: 10,
    completed: 4,
  }
  try {
    setLanguage('es', { persist: false })
    assert.match(
      compactImportProgress(current).text,
      /Importando · 4\/10 guardados/
    )
    setLanguage('zh', { persist: false })
    assert.match(compactImportProgress(current).text, /正在导入 · 已保存 4\/10/)
    setLanguage('en', { persist: false })
    assert.match(
      compactImportProgress({ ...current, phase: 'scan', discovered: 8 }).text,
      /Finding orders · 8 found/
    )
    assert.match(
      compactImportProgress({ ...current, state: 'paused' }).text,
      /Paused/
    )
  } finally {
    setLanguage('en', { persist: false })
  }
})
