import { bindAttribute, message, onLanguageChange } from './i18n.js'

const documents = new Map()
export function normalizeSearch(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
}

function documentFor(value) {
  const text = Array.isArray(value) ? value.join(' ') : String(value ?? '')
  let document = documents.get(text)
  if (!document) {
    const normalized = normalizeSearch(text)
    document = {
      text: normalized,
      words: (normalized.match(/[\p{L}\p{N}]+/gu) || []).filter((word) =>
        /^[a-z]{4,}$/.test(word)
      ),
    }
    if (documents.size >= 12_000)
      documents.delete(documents.keys().next().value)
    documents.set(text, document)
  }
  return document
}

// One mistyped letter, omitted letter or adjacent transposition. Never fuzzy
// match numeric identifiers, barcode codes, measurements or short initials.
function oneTypo(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  while (i < a.length && a[i] === b[i]) i++
  if (i === a.length || i === b.length) return true
  if (a.length !== b.length)
    return a.length > b.length
      ? a.slice(i + 1) === b.slice(i)
      : a.slice(i) === b.slice(i + 1)
  return (
    a.slice(i + 1) === b.slice(i + 1) ||
    (a[i] === b[i + 1] &&
      a[i + 1] === b[i] &&
      a.slice(i + 2) === b.slice(i + 2))
  )
}

export function searchMatcher(query) {
  const normalized = normalizeSearch(query)
  const terms = normalized.split(/\s+/).filter(Boolean)
  const score = (value) => {
    if (!terms.length) return 0
    const source = documentFor(value)
    if (source.text === normalized) return 0
    if (source.text.startsWith(normalized)) return 1
    if (source.text.includes(normalized)) return 2
    let fuzzy = false
    for (const term of terms) {
      if (source.text.includes(term)) continue
      if (
        !/^[a-z]{4,}$/.test(term) ||
        !source.words.some((word) => oneTypo(term, word))
      )
        return Infinity
      fuzzy = true
    }
    return fuzzy ? 4 : 3
  }
  const matches = (value) => Number.isFinite(score(value))
  matches.score = score
  return matches
}

export function searchSuggestions(query, candidates, limit = 8) {
  const matcher = searchMatcher(query),
    seen = new Set(),
    choices = []
  for (const entry of candidates) {
    const value = String(
      typeof entry === 'string' ? entry : (entry?.value ?? '')
    ).trim()
    const identity = normalizeSearch(value)
    if (!value || seen.has(identity)) continue
    const rank = matcher.score(
      typeof entry === 'string' ? entry : entry.text || value
    )
    if (!Number.isFinite(rank)) continue
    seen.add(identity)
    choices.push({ value, rank })
    choices.sort((a, b) => a.rank - b.rank)
    if (choices.length > limit) choices.pop()
  }
  return choices.map(({ value }) => value)
}

/** Local-only editable combobox. Focus remains in the native search input. */
export function attachSearchSuggestions(
  input,
  getCandidates,
  { showOnFocus = false } = {}
) {
  const inlineHost = input.closest('.orders-pane .search')
  const list = document.createElement('div')
  list.id = `search-suggestions-${crypto.randomUUID()}`
  list.className = 'search-suggestions'
  list.setAttribute('role', 'listbox')
  if (inlineHost) list.hidden = true
  else list.setAttribute('popover', 'manual')
  bindAttribute(list, 'aria-label', message('Search suggestions'))
  input.setAttribute('role', 'combobox')
  input.setAttribute('aria-autocomplete', 'list')
  input.setAttribute('aria-controls', list.id)
  input.setAttribute('aria-expanded', 'false')
  input.autocomplete = 'off'
  const scope = input.closest('dialog') || document.body
  if (inlineHost) inlineHost.append(list)
  else scope.append(list)
  let values = [],
    current = -1,
    timer,
    composing = false,
    pointerExit = false,
    openListeners,
    observer
  const isOpen = () =>
    inlineHost ? !list.hidden : list.matches(':popover-open')
  const position = () => {
    if (inlineHost) return
    const box = input.getBoundingClientRect()
    list.style.inlineSize = `${Math.min(Math.max(box.width, 230), innerWidth - 24)}px`
    list.style.left = `${Math.max(12, Math.min(box.left, innerWidth - list.offsetWidth - 12))}px`
    const roomBelow = innerHeight - box.bottom - 12
    const below =
      roomBelow >= Math.min(200, list.scrollHeight) || box.top < roomBelow
    list.style.maxBlockSize = `${Math.max(80, Math.min(300, below ? roomBelow : box.top - 12))}px`
    list.style.top = `${below ? box.bottom + 4 : Math.max(12, box.top - list.offsetHeight - 4)}px`
  }
  const close = () => {
    clearTimeout(timer)
    if (inlineHost) list.hidden = true
    else if (isOpen()) list.hidePopover()
    input.setAttribute('aria-expanded', 'false')
    input.removeAttribute('aria-activedescendant')
    current = -1
    pointerExit = false
    openListeners?.abort()
    observer?.disconnect()
  }
  const choose = (index) => {
    if (!values[index]) return
    input.value = values[index]
    input.dispatchEvent(new Event('input', { bubbles: true }))
    close()
  }
  const active = (index) => {
    current = (index + values.length) % values.length
    for (const [i, option] of [...list.children].entries())
      option.setAttribute('aria-selected', String(i === current))
    input.setAttribute('aria-activedescendant', list.children[current].id)
    list.children[current].scrollIntoView({ block: 'nearest' })
  }
  const show = (allowEmpty = false) => {
    clearTimeout(timer)
    if (
      composing ||
      document.activeElement !== input ||
      !input.isConnected ||
      (!allowEmpty && !input.value.trim())
    )
      return close()
    values = searchSuggestions(input.value, getCandidates())
    if (!values.length) return close()
    current = -1
    input.removeAttribute('aria-activedescendant')
    list.replaceChildren(
      ...values.map((value, index) => {
        const option = document.createElement('div')
        option.id = `${list.id}-${index}`
        option.setAttribute('role', 'option')
        option.setAttribute('aria-selected', 'false')
        option.textContent = value
        option.title = value
        option.onpointerdown = (event) => event.preventDefault()
        option.onclick = () => choose(index)
        return option
      })
    )
    if (inlineHost) list.hidden = false
    else if (!isOpen()) list.showPopover()
    input.setAttribute('aria-expanded', 'true')
    position()
    openListeners?.abort()
    openListeners = new AbortController()
    const signal = openListeners.signal
    addEventListener('resize', position, { signal })
    addEventListener('scroll', position, { capture: true, signal })
    document.addEventListener(
      'pointerdown',
      (event) => {
        if (event.target !== input && !list.contains(event.target)) {
          // Inline suggestions reserve space. Keep that space until click has
          // its target, so dismissing cannot move a month chip before release.
          if (inlineHost) pointerExit = true
          else close()
        }
      },
      { capture: true, signal }
    )
    if (inlineHost)
      document.addEventListener(
        'click',
        (event) => {
          if (event.target !== input && !list.contains(event.target)) close()
        },
        { capture: true, signal }
      )
    observer?.disconnect()
    observer = new MutationObserver(() => {
      if (!input.isConnected || !input.checkVisibility()) close()
    })
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden'],
    })
  }
  input.addEventListener('input', () => {
    clearTimeout(timer)
    if (input.ownerDocument.activeElement === input)
      timer = setTimeout(() => show(showOnFocus), 100)
  })
  input.addEventListener('focus', () => show(showOnFocus))
  input.addEventListener('blur', () => {
    if (!inlineHost || !pointerExit) close()
  })
  input.addEventListener('compositionstart', () => {
    composing = true
    close()
  })
  input.addEventListener('compositionend', () => {
    composing = false
    show(showOnFocus)
  })
  input.addEventListener('keydown', (event) => {
    if (event.isComposing) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!isOpen()) show(true)
      if (!values.length || !isOpen()) return
      event.preventDefault()
      active(
        current + (event.key === 'ArrowDown' ? 1 : current === -1 ? 0 : -1)
      )
    } else if (event.key === 'Enter' && current >= 0 && isOpen()) {
      event.preventDefault()
      choose(current)
    } else if (event.key === 'Escape' && isOpen()) {
      event.preventDefault()
      event.stopPropagation()
      close()
    } else if (event.key === 'Tab') close()
  })
  const stopLanguage = onLanguageChange(close)
  const destroy = () => {
    close()
    stopLanguage()
    list.remove()
    scope.removeEventListener('close', destroy)
  }
  if (scope.matches('dialog'))
    scope.addEventListener('close', destroy, { once: true })
  return destroy
}
