// Runs before CSS so a saved preference also colors the initial canvas.
// This external classic script complies with the extension's script-src CSP.
;(() => {
  const key = '1688-library-color-scheme'
  const meta = document.querySelector('meta[name="color-scheme"]')
  const system = matchMedia('(prefers-color-scheme: dark)')
  const normalize = (value) =>
    ['light', 'dark'].includes(value) ? value : 'system'
  let preference = 'system'
  try {
    preference = normalize(localStorage.getItem(key))
  } catch {}
  function apply(value) {
    preference = normalize(value)
    meta.content = preference === 'system' ? 'light dark' : preference
    const control = document.querySelector('#theme-preference')
    if (control) {
      control.value = preference
      control.querySelector('[value="system"]').textContent =
        `System (currently ${system.matches ? 'dark' : 'light'})`
    }
  }
  apply(preference)
  document.addEventListener(
    'DOMContentLoaded',
    () => {
      apply(preference)
      document
        .querySelector('#theme-preference')
        .addEventListener('change', (event) => {
          apply(event.target.value)
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
  window.addEventListener('storage', (event) => {
    if (event.key === key || event.key === null) apply(event.newValue)
  })
})()
