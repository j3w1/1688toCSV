import { element as el } from './ui.js'
import { message as m, bindAttribute, isMessage } from './i18n.js'
import { decorateIcon } from './icons.js'
import { preparationHelp } from './preparation-help.js'
import { mergeOrderTags, orderTagColors } from './order-tags.js'
import { normalizeSearch, searchMatcher } from './search-assistance.js'

export function orderTagBadge(name, definitions = []) {
  const badge = el('span', name, 'order-tag-badge')
  const colors = orderTagColors(
    definitions.find((entry) => entry.name === name) || { name }
  )
  for (const [key, value] of Object.entries(colors))
    badge.style.setProperty(`--tag-${key}`, value)
  return badge
}

/** Keep saved identities exact; rank accents and small typing mistakes as search helpers only. */
export function tagPickerChoices(query, definitions, selected = [], limit = 8) {
  const match = searchMatcher(query),
    entered = query.trim(),
    selectedNames = new Set(selected)
  const options = definitions
    .filter((entry) => !selectedNames.has(entry.name))
    .map((entry, index) => ({
      name: entry.name,
      rank: match.score(entry.name),
      index,
    }))
    .filter((entry) => Number.isFinite(entry.rank))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, limit)
    .map(({ name }) => ({ name, create: false }))
  if (
    entered &&
    ![...definitions.map((entry) => entry.name), ...selected].some(
      (name) => normalizeSearch(name) === normalizeSearch(entered)
    )
  )
    options.push({ name: entered, create: true })
  return options
}

/** One reusable picker for order and source-product assignments. Persistence belongs to its owner. */
export function mountTagPicker(
  host,
  {
    label = m('Tags'),
    definitions = [],
    selected = [],
    onChange = () => {},
  } = {}
) {
  const wrapper = el('div', undefined, 'tag-picker'),
    heading = el('label', isMessage(label) ? label : m(label)),
    chips = el('div', undefined, 'order-tag-selected tag-picker-chips'),
    input = el('input'),
    list = el('div', undefined, 'tag-picker-options'),
    scopeId = `tag-picker-${crypto.randomUUID()}`
  let known = mergeOrderTags(definitions, selected),
    names = [...selected],
    choices = [],
    active = -1,
    composing = false,
    open = false,
    openListeners,
    observer
  input.id = scopeId
  input.type = 'text'
  input.autocomplete = 'off'
  input.spellcheck = false
  heading.htmlFor = input.id
  input.setAttribute('role', 'combobox')
  input.setAttribute('aria-autocomplete', 'list')
  input.setAttribute('aria-expanded', 'false')
  list.id = `${scopeId}-options`
  list.setAttribute('role', 'listbox')
  list.setAttribute('popover', 'manual')
  input.setAttribute('aria-controls', list.id)
  bindAttribute(input, 'placeholder', m('Select or create a tag'))
  bindAttribute(list, 'aria-label', isMessage(label) ? label : m(label))
  function position() {
    const box = chips.getBoundingClientRect(),
      viewport = input.ownerDocument.defaultView
    list.style.inlineSize = `${Math.min(Math.max(box.width, 220), viewport.innerWidth - 24)}px`
    list.style.left = `${Math.max(12, Math.min(box.left, viewport.innerWidth - list.offsetWidth - 12))}px`
    const roomBelow = viewport.innerHeight - box.bottom - 12
    const below =
      roomBelow >= Math.min(220, list.scrollHeight) || box.top < roomBelow
    list.style.maxBlockSize = `${Math.max(80, Math.min(300, below ? roomBelow : box.top - 12))}px`
    list.style.top = `${below ? box.bottom + 4 : Math.max(12, box.top - list.offsetHeight - 4)}px`
  }
  function close() {
    if (open && list.isConnected && list.matches(':popover-open'))
      list.hidePopover()
    open = false
    input.setAttribute('aria-expanded', 'false')
    input.removeAttribute('aria-activedescendant')
    active = -1
    openListeners?.abort()
    observer?.disconnect()
  }
  function select(index) {
    if (!choices[index]) return
    const { name } = choices[index]
    names = [...new Set([...names, name])]
    known = mergeOrderTags(known, names)
    input.value = ''
    renderChips()
    onChange([...names])
    input.focus()
    show()
  }
  function highlight(index) {
    if (!choices.length) return
    active = (index + choices.length) % choices.length
    for (const [i, option] of [...list.children].entries())
      option.setAttribute('aria-selected', String(i === active))
    input.setAttribute('aria-activedescendant', list.children[active].id)
    list.children[active].scrollIntoView({ block: 'nearest' })
  }
  function show() {
    if (composing || !input.isConnected || document.activeElement !== input)
      return close()
    choices = tagPickerChoices(input.value, known, names)
    if (!choices.length) return close()
    active = -1
    input.removeAttribute('aria-activedescendant')
    list.replaceChildren(
      ...choices.map((choice, index) => {
        const option = el('div', undefined, 'tag-picker-option')
        option.id = `${list.id}-${index}`
        option.setAttribute('role', 'option')
        option.setAttribute('aria-selected', 'false')
        if (choice.create)
          option.append(
            el('span', m('Create')),
            orderTagBadge(choice.name, known)
          )
        else option.append(orderTagBadge(choice.name, known))
        option.onpointerdown = (event) => event.preventDefault()
        option.onclick = () => select(index)
        return option
      })
    )
    if (!open) list.showPopover()
    open = true
    input.setAttribute('aria-expanded', 'true')
    position()
    if (input.value.trim()) highlight(0)
    openListeners?.abort()
    openListeners = new AbortController()
    const { signal } = openListeners
    input.ownerDocument.defaultView.addEventListener('resize', position, {
      signal,
    })
    input.ownerDocument.addEventListener('scroll', position, {
      capture: true,
      signal,
    })
    input.ownerDocument.addEventListener(
      'pointerdown',
      (event) => {
        if (!wrapper.contains(event.target)) close()
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
      attributeFilter: ['hidden', 'open'],
    })
  }
  function renderChips() {
    for (const chip of chips.querySelectorAll(':scope > .order-tag-badge'))
      chip.remove()
    if (!input.parentNode) chips.append(input)
    chips.prepend(
      ...names.map((name) => {
        const chip = orderTagBadge(name, known),
          remove = decorateIcon(
            el('button', m('Remove tag {name}', { name })),
            'close',
            { iconOnly: true }
          )
        remove.type = 'button'
        preparationHelp(
          remove,
          m(
            'Remove this assignment. A tag disappears from the catalog after its last assignment is removed.'
          )
        )
        remove.onclick = () => {
          names = names.filter((entry) => entry !== name)
          renderChips()
          onChange([...names])
          input.focus()
        }
        chip.append(remove)
        return chip
      })
    )
  }
  function commit({ raw = false } = {}) {
    const entered = input.value.trim()
    if (!entered && active < 0) return false
    choices = tagPickerChoices(entered, known, names)
    if (raw) {
      const exact = known.find(
        (entry) => normalizeSearch(entry.name) === normalizeSearch(entered)
      )
      const name = exact?.name || entered
      if (!name || names.includes(name)) {
        input.value = ''
        close()
        return false
      }
      choices = [{ name, create: !exact }]
      select(0)
    } else if (choices.length) select(active >= 0 ? active : 0)
    else return false
    return true
  }
  input.addEventListener('input', show)
  input.addEventListener('focus', show)
  input.addEventListener('blur', close)
  input.addEventListener('compositionstart', () => {
    composing = true
    close()
  })
  input.addEventListener('compositionend', () => {
    composing = false
    show()
  })
  input.addEventListener('keydown', (event) => {
    if (event.isComposing) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const wasOpen = open
      if (!open) show()
      if (!choices.length || !open) return
      event.preventDefault()
      event.stopPropagation()
      highlight(
        !wasOpen
          ? event.key === 'ArrowDown'
            ? 0
            : choices.length - 1
          : active + (event.key === 'ArrowDown' ? 1 : active < 0 ? 0 : -1)
      )
    } else if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      commit()
    } else if (event.key === 'Escape' && open) {
      event.preventDefault()
      event.stopPropagation()
      close()
    } else if (event.key === 'Tab') close()
  })
  preparationHelp(
    input,
    m(
      'Type to filter tags. Use ↑ or ↓ to choose, Enter to add or create, and Escape to close suggestions.'
    )
  )
  wrapper.append(heading, chips, list)
  host.append(wrapper)
  renderChips()
  return {
    setDefinitions(next) {
      known = mergeOrderTags(next, names)
      renderChips()
      if (open) show()
    },
    setSelected(next) {
      names = [...next]
      known = mergeOrderTags(known, names)
      renderChips()
      if (open) show()
    },
    focus: () => input.focus(),
    close,
    commit,
    commitInput: () => commit({ raw: true }),
    dirty: () => Boolean(input.value.trim()),
    pending: () => Boolean(input.value.trim()),
    input,
    element: wrapper,
    destroy() {
      close()
      wrapper.remove()
    },
  }
}
