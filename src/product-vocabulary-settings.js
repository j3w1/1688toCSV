import { element as el } from './ui.js'
import { message as m, bindText, bindAttribute } from './i18n.js'
import { decorateIcon } from './icons.js'
import { preparationHelp } from './preparation-help.js'
import { attachSearchSuggestions, searchMatcher } from './search-assistance.js'
import { createVocabularyTable } from './vocabulary-table.js'

/** Product naming rules share the Settings draft and its single save action. */
export function mountProductVocabulary(host, value) {
  const toolbar = el('div', undefined, 'vocabulary-toolbar'),
    searchLabel = el('label', m('Search naming rules'), 'vocabulary-search'),
    search = el('input'),
    scroll = el('div', undefined, 'vocabulary-scroll'),
    table = el('table', undefined, 'vocabulary-table'),
    body = el('tbody'),
    head = el('thead'),
    headings = el('tr'),
    status = el('p', undefined, 'vocabulary-status packing-help')
  search.id = `naming-rule-search-${crypto.randomUUID()}`
  search.type = 'search'
  searchLabel.htmlFor = search.id
  searchLabel.append(search)
  search.addEventListener('input', () => render(true))
  for (const title of [
    'Title includes',
    'Skip if it includes',
    'Spanish name',
    'Chinese category',
    '',
  ]) {
    const heading = el('th', m(title))
    heading.scope = 'col'
    headings.append(heading)
  }
  head.append(headings)
  table.append(head, body)
  scroll.append(table)
  scroll.tabIndex = 0
  scroll.setAttribute('role', 'region')
  bindAttribute(scroll, 'aria-label', m('Naming rules'))
  status.setAttribute('role', 'status')
  const action = (title, icon, handler, iconOnly = false) => {
    const button = decorateIcon(el('button', m(title)), icon, { iconOnly })
    button.type = 'button'
    button.addEventListener('click', handler)
    return button
  }
  const add = action('Add rule', 'plus', () => {
    const entry = { match: '', spanishName: '', category: '' }
    value.vocabulary.unshift(entry)
    search.value = ''
    render(true)
    virtual.reveal(entry)?.querySelector('input')?.focus()
  })
  toolbar.append(searchLabel, add)
  host.append(toolbar, scroll, status)
  function matchingRules() {
    const matches = searchMatcher(search.value)
    return value.vocabulary.filter((entry) =>
      matches([entry.match, entry.exclude, entry.spanishName, entry.category])
    )
  }
  function renderRow(entry) {
    const row = el('tr')
    for (const [key, title] of [
      ['match', 'Title includes'],
      ['exclude', 'Skip if it includes'],
      ['spanishName', 'Spanish name'],
      ['category', 'Chinese category'],
    ]) {
      const cell = el('td'),
        input = el('input')
      input.value = entry[key] || ''
      bindAttribute(input, 'aria-label', m(title))
      input.addEventListener(
        'input',
        () =>
          (entry[key] =
            key === 'spanishName' ? input.value.toUpperCase() : input.value)
      )
      preparationHelp(
        input,
        m(
          key === 'match'
            ? 'Words to match in the original title. Separate alternatives with |.'
            : key === 'exclude'
              ? 'Ignore this rule if the title includes any of these words. Separate alternatives with |.'
              : key === 'spanishName'
                ? 'Short uppercase name printed on the barcode.'
                : 'Chinese category printed on the carton mark.'
        )
      )
      cell.append(input)
      row.append(cell)
    }
    const cell = el('td'),
      remove = action(
        'Remove naming rule',
        'trash',
        () => {
          const matching = matchingRules(),
            position = matching.indexOf(entry)
          value.vocabulary = value.vocabulary.filter((item) => item !== entry)
          render()
          const next = matching[position + 1] || matching[position - 1]
          if (next) virtual.reveal(next)?.querySelector('button')?.focus()
          else add.focus()
        },
        true
      )
    preparationHelp(
      remove,
      m('Remove this naming rule when you save Settings.')
    )
    cell.append(remove)
    row.append(cell)
    return row
  }
  const virtual = createVocabularyTable({
    scroller: scroll,
    body,
    render: renderRow,
    emptyMessage: m('No matching rules.'),
  })
  function render(reset = false) {
    const matching = matchingRules()
    virtual.setItems(matching, { reset })
    bindText(status, m('{0} rules', { 0: matching.length }))
  }
  render()
  attachSearchSuggestions(search, () =>
    value.vocabulary.flatMap((entry) => [
      entry.spanishName,
      entry.category,
      ...String(entry.match || '').split('|'),
      ...String(entry.exclude || '').split('|'),
    ])
  )
  return { destroy: () => virtual.destroy() }
}
