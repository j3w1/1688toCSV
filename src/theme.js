// Runs before CSS so a saved preference also colors the initial canvas.
// This external classic script complies with the extension's script-src CSP.
;(() => {
  const key = '1688-library-color-scheme'
  const appearanceKey = '1688-workspace-appearance'
  const meta = document.querySelector('meta[name="color-scheme"]')
  const system = matchMedia('(prefers-color-scheme: dark)')
  let appearance = null
  const customTokens = new Set()
  try {
    appearance = JSON.parse(localStorage.getItem(appearanceKey))
  } catch {}
  function paint() {
    const mode = ['light', 'dark'].includes(meta.content)
      ? meta.content
      : system.matches
        ? 'dark'
        : 'light'
    for (const name of customTokens)
      document.documentElement.style.removeProperty(name)
    customTokens.clear()
    for (const [name, value] of Object.entries(appearance?.[mode] || {})) {
      if (!/^[a-z-]{1,60}$/.test(name) || !/^#[0-9a-f]{6}$/i.test(value))
        continue
      document.documentElement.style.setProperty(`--${name}`, value)
      customTokens.add(`--${name}`)
    }
  }
  const normalize = (value) =>
    ['light', 'dark', 'system'].includes(value) ? value : 'dark'
  let preference = 'dark'
  try {
    preference = normalize(localStorage.getItem(key))
  } catch {}
  function apply(value) {
    preference = normalize(value)
    meta.content = preference === 'system' ? 'light dark' : preference
    paint()
    share()
  }
  function share() {
    try {
      globalThis.chrome?.runtime
        ?.sendMessage({
          type: 'WORKSPACE_APPEARANCE_CHANGED',
          colorScheme: preference,
        })
        ?.catch(() => {})
    } catch {
      /* Local previews and an extension reload still retain their own theme. */
    }
  }
  apply(preference)
  document.addEventListener(
    'DOMContentLoaded',
    () => {
      apply(preference)
      document.querySelector('#theme-toggle').addEventListener('click', () => {
        const systemScheme = system.matches ? 'dark' : 'light'
        const rendered = preference === 'system' ? systemScheme : preference
        const target = rendered === 'dark' ? 'light' : 'dark'
        apply(target)
        try {
          if (preference === 'system') localStorage.removeItem(key)
          else localStorage.setItem(key, preference)
        } catch {
          /* The selected scheme still applies when storage is unavailable. */
        }
      })
    },
    { once: true }
  )
  system.addEventListener('change', () => apply(preference))
  new MutationObserver(paint).observe(meta, {
    attributes: true,
    attributeFilter: ['content'],
  })
  window.addEventListener('workspace-appearance-change', (event) => {
    appearance = event.detail
    paint()
    share()
  })
  window.addEventListener('storage', (event) => {
    if (event.key === key || event.key === null) apply(event.newValue)
    if (event.key === appearanceKey || event.key === null) {
      try {
        appearance = JSON.parse(event.newValue)
      } catch {
        appearance = null
      }
      paint()
      share()
    }
  })
})()
