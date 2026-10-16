import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { mountPanelAppearance } from '../src/panel-appearance.js'
import { appearanceTokens } from '../src/appearance.js'

function setup() {
  const { document, window } = parseHTML('<html><body></body></html>')
  const host = document.createElement('div')
  document.body.append(host)
  const listeners = new Set(),
    systemListeners = new Set()
  let respond
  const system = {
    matches: false,
    addEventListener(type, listener) {
      systemListeners.add(listener)
    },
    removeEventListener(type, listener) {
      systemListeners.delete(listener)
    },
  }
  window.matchMedia = () => system
  const runtime = {
    id: 'synthetic',
    onMessage: {
      addListener: (listener) => listeners.add(listener),
      removeListener: (listener) => listeners.delete(listener),
    },
    sendMessage: () =>
      new Promise((resolve) => {
        respond = resolve
      }),
  }
  const dispose = mountPanelAppearance(host, runtime)
  return {
    host,
    listeners,
    systemListeners,
    dispose,
    response: (value) => respond({ ok: true, data: value }),
    broadcast(data) {
      for (const listener of listeners)
        listener({ type: 'WORKSPACE_APPEARANCE', data }, { id: runtime.id })
    },
    systemChange(dark) {
      system.matches = dark
      for (const listener of systemListeners) listener()
    },
  }
}
const display = (colorScheme) => ({
  colorScheme,
  light: appearanceTokens({ lightTheme: '1688' }, 'light'),
  dark: appearanceTokens({ darkTheme: 'terracotta' }, 'dark'),
})

test('list/detail appearance honors explicit mode, reacts to palette and system changes, and cleans up', async () => {
  const panel = setup()
  assert.equal(panel.host.style.getPropertyValue('--surface'), '#24211d')
  panel.response(display('light'))
  await Promise.resolve()
  assert.equal(panel.host.style.colorScheme, 'light')
  assert.equal(panel.host.style.getPropertyValue('--surface'), '#fffcf8')
  panel.systemChange(true)
  assert.equal(panel.host.style.colorScheme, 'light')
  panel.broadcast(display('dark'))
  panel.systemChange(false)
  assert.equal(panel.host.style.colorScheme, 'dark')
  assert.equal(panel.host.style.getPropertyValue('--surface'), '#2d221e')
  panel.broadcast(display('system'))
  assert.equal(panel.host.style.colorScheme, 'light')
  panel.systemChange(true)
  assert.equal(panel.host.style.colorScheme, 'dark')
  panel.dispose()
  assert.equal(panel.listeners.size, 0)
  assert.equal(panel.systemListeners.size, 0)
})

test('a late initial reply cannot undo a newer live theme and invalid CSS remains excluded', async () => {
  const panel = setup()
  panel.broadcast(display('light'))
  panel.response(display('dark'))
  await Promise.resolve()
  assert.equal(panel.host.style.colorScheme, 'light')
  panel.broadcast({
    colorScheme: 'light',
    light: { text: 'url(secret)', surface: '#ffffff', unknown: '#123456' },
  })
  assert.equal(panel.host.style.getPropertyValue('--text'), '#2c2723')
  assert.equal(panel.host.style.getPropertyValue('--surface'), '#ffffff')
  assert.ok(!panel.host.style.getPropertyValue('--unknown'))
  panel.dispose()
})
