import { appearanceTokens } from './appearance.js'

/** Keep injected controls on the workspace palette without styling the seller page. */
export function mountPanelAppearance(
  host,
  runtime = globalThis.chrome?.runtime
) {
  const view = host.ownerDocument.defaultView
  const system = view.matchMedia?.('(prefers-color-scheme: dark)')
  const defaults = {
    light: appearanceTokens({}, 'light'),
    dark: appearanceTokens({}, 'dark'),
  }
  let display = { colorScheme: 'dark', ...defaults },
    disposed = false,
    revision = 0
  function paint() {
    const mode =
      display.colorScheme === 'system'
        ? system?.matches
          ? 'dark'
          : 'light'
        : display.colorScheme === 'light'
          ? 'light'
          : 'dark'
    host.style.colorScheme = mode
    for (const [name, fallback] of Object.entries(defaults[mode])) {
      const value = display[mode]?.[name]
      host.style.setProperty(
        `--${name}`,
        typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
          ? value
          : fallback
      )
    }
  }
  function receive(message, sender) {
    if (
      disposed ||
      sender?.id !== runtime.id ||
      message?.type !== 'WORKSPACE_APPEARANCE'
    )
      return
    revision += 1
    display = message.data || {}
    paint()
  }
  async function refresh() {
    const started = revision
    try {
      const response = await runtime?.sendMessage?.({
        type: 'WORKSPACE_APPEARANCE_GET',
      })
      if (!disposed && revision === started && response?.ok) {
        display = response.data || {}
        paint()
      }
    } catch {
      // Extension reloads must not break the import controls already on screen.
    }
  }
  paint()
  runtime?.onMessage?.addListener(receive)
  system?.addEventListener('change', paint)
  view.addEventListener('focus', refresh)
  void refresh()
  return () => {
    disposed = true
    runtime?.onMessage?.removeListener(receive)
    system?.removeEventListener('change', paint)
    view.removeEventListener('focus', refresh)
  }
}
