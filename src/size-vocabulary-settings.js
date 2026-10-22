import {
  message as uiMessage,
  bindText,
  bindAttribute,
  isMessage,
  t,
  getLocale,
  getLanguage,
  onLanguageChange,
} from './i18n.js'
import { decorateIcon } from './icons.js'
import { preparationHelp } from './preparation-help.js'
import { createVocabularyTable } from './vocabulary-table.js'
import { element as el } from './ui.js'
import { attachSearchSuggestions, searchMatcher } from './search-assistance.js'
import {
  DEFAULT_SIZE_VOCABULARY,
  validateSizeVocabulary,
} from './size-vocabulary.js'

/** Edit the Settings draft; persistence stays with the Settings save action. */
export function mountSizeVocabulary(host, value) {
  value.sizeVocabulary ??= DEFAULT_SIZE_VOCABULARY.map((entry) => ({
    ...entry,
  }))
  const errors = new Map(),
    controls = new Map(),
    toolbar = el('div', undefined, 'vocabulary-toolbar'),
    searchLabel = el(
      'label',
      uiMessage('Search size rules'),
      'vocabulary-search'
    ),
    search = el('input'),
    scroll = el('div', undefined, 'vocabulary-scroll'),
    table = el('table', undefined, 'vocabulary-table size-vocabulary-table'),
    body = el('tbody'),
    navigation = el('div', undefined, 'vocabulary-status'),
    count = el('span', undefined, 'packing-help')
  search.type = 'search'
  search.id = `size-search-${crypto.randomUUID()}`
  searchLabel.htmlFor = search.id
  search.autocomplete = 'off'
  search.spellcheck = false
  searchLabel.append(search)
  preparationHelp(search, uiMessage('Filter by a size name or barcode ending.'))
  search.addEventListener('input', () => {
    render(true)
  })

  function action(label, name, help, handler, iconOnly = false) {
    const button = decorateIcon(el('button', label), name, { iconOnly })
    button.type = 'button'
    button.addEventListener('click', handler)
    preparationHelp(button, help)
    return button
  }
  const add = action(
    uiMessage('Add size rule'),
    'plus',
    'Add size names and their shared barcode ending.',
    () => {
      if (value.sizeVocabulary.length >= 500) return
      value.sizeVocabulary.unshift({ match: '', suffix: '' })
      search.value = ''
      render(true)
      virtual.reveal(value.sizeVocabulary[0])?.querySelector('input')?.focus()
    }
  )
  count.setAttribute('role', 'status')
  navigation.append(count)
  toolbar.append(searchLabel, add)
  scroll.tabIndex = 0
  scroll.setAttribute('role', 'region')
  bindAttribute(scroll, 'aria-label', uiMessage('Size rules'))
  table.style.minWidth = '360px'
  const columns = el('colgroup'),
    namesColumn = el('col'),
    codeColumn = el('col'),
    removeColumn = el('col'),
    head = el('thead'),
    headingRow = el('tr'),
    headers = new Map()
  codeColumn.style.width = '120px'
  removeColumn.style.width = '40px'
  columns.append(namesColumn, codeColumn, removeColumn)
  for (const [key, label] of [
    ['match', 'Size names'],
    ['suffix', 'Size code'],
    ['remove', ''],
  ]) {
    const heading = el('th', uiMessage(label))
    if (key === 'match') {
      const arrow = el('span', ' →')
      arrow.setAttribute('aria-hidden', 'true')
      heading.append(arrow)
    }
    heading.scope = 'col'
    heading.id = `size-heading-${crypto.randomUUID()}`
    headers.set(key, heading.id)
    headingRow.append(heading)
  }
  head.append(headingRow)
  table.append(columns, head, body)
  scroll.append(table)

  function rowError(entry, message) {
    if (message) errors.set(entry, message)
    else errors.delete(entry)
    const row = controls.get(entry)
    if (!row) return
    bindText(row.error, message || '')
    row.error.hidden = !message
    for (const input of row.inputs) {
      if (message) input.setAttribute('aria-invalid', 'true')
      else input.removeAttribute('aria-invalid')
    }
  }
  function validateRow(entry) {
    try {
      const [normalized] = validateSizeVocabulary([entry])
      // Other incomplete draft rows must not prevent this row's feedback.
      const complete = value.sizeVocabulary.filter((item) => {
        if (item === entry) return false
        try {
          validateSizeVocabulary([item])
          return true
        } catch {
          return false
        }
      })
      validateSizeVocabulary([entry, ...complete])
      Object.assign(entry, normalized)
      for (const input of controls.get(entry)?.inputs || [])
        input.value = entry[input.name]
      rowError(entry, '')
    } catch (error) {
      rowError(entry, error.message.replace(/^Size rule \d+ /, 'This rule '))
    }
  }
  function renderRow(entry) {
    const row = el('tr'),
      error = el('p', undefined, 'packing-error'),
      inputs = []
    error.id = `size-error-${crypto.randomUUID()}`
    error.setAttribute('role', 'alert')
    error.hidden = true
    for (const key of ['match', 'suffix']) {
      const cell = el('td'),
        input = el('input')
      input.name = key
      input.value = entry[key] || ''
      input.required = true
      input.maxLength = key === 'match' ? 1000 : 12
      input.autocomplete = 'off'
      input.autocapitalize = 'off'
      input.setAttribute('autocorrect', 'off')
      input.spellcheck = false
      input.setAttribute('aria-labelledby', headers.get(key))
      input.setAttribute('aria-describedby', error.id)
      if (key === 'suffix') input.pattern = '[A-Za-z0-9]{1,12}'
      input.addEventListener('input', () => {
        entry[key] = input.value
        rowError(entry, '')
      })
      preparationHelp(
        input,
        key === 'match'
          ? uiMessage(
              'Exact size names. Separate alternatives with |, such as 小号|小码.'
            )
          : uiMessage(
              'Barcode ending: 1–12 letters or numbers, such as S or XL.'
            )
      )
      cell.append(input)
      if (key === 'match') cell.append(error)
      row.append(cell)
      inputs.push(input)
    }
    const removeCell = el('td')
    removeCell.append(
      action(
        uiMessage('Remove size rule'),
        'trash',
        'Remove this size rule when you save Settings.',
        () => {
          const matching = matchingRules(),
            index = value.sizeVocabulary.indexOf(entry),
            position = matching.indexOf(entry)
          if (index < 0) return
          value.sizeVocabulary.splice(index, 1)
          errors.delete(entry)
          render()
          const next = matching[position + 1] || matching[position - 1]
          if (next) virtual.reveal(next)?.querySelector('button')?.focus()
          else add.focus()
        },
        true
      )
    )
    row.append(removeCell)
    row.addEventListener('focusout', (event) => {
      if (!row.contains(event.relatedTarget)) validateRow(entry)
    })
    controls.set(entry, { inputs, error })
    rowError(entry, errors.get(entry))
    return row
  }
  const virtual = createVocabularyTable({
    scroller: scroll,
    body,
    render: renderRow,
    remove: (entry) => controls.delete(entry),
    emptyMessage: uiMessage('No matching size rules.'),
  })
  function matchingRules() {
    const matches = searchMatcher(search.value)
    return value.sizeVocabulary.filter((entry) =>
      matches([entry.match, entry.suffix])
    )
  }
  function render(reset = false) {
    const matching = matchingRules()
    virtual.setItems(matching, { reset })
    bindText(count, uiMessage('{0} rules', { 0: matching.length }))
    add.disabled = value.sizeVocabulary.length >= 500
  }
  host.replaceChildren(
    el('h3', uiMessage('Automatic size codes')),
    el(
      'p',
      uiMessage(
        'Map seller size names to barcode endings. Measurements are compared automatically; unclear or mixed sizes stay for review.'
      ),
      'packing-help'
    ),
    toolbar,
    scroll,
    navigation
  )
  render()
  attachSearchSuggestions(search, () =>
    value.sizeVocabulary.flatMap((entry) => [
      ...String(entry.match || '').split('|'),
      entry.suffix,
    ])
  )
  return {
    destroy: () => virtual.destroy(),
    revealError() {
      const entry = value.sizeVocabulary.find((entry) => errors.has(entry))
      return entry
        ? virtual.reveal(entry)?.querySelector('[aria-invalid="true"]')
        : undefined
    },
    validate() {
      try {
        return validateSizeVocabulary(value.sizeVocabulary)
      } catch (error) {
        // Locate the first failing prefix so offscreen duplicate aliases
        // are revealed too; the shared validator remains the single contract.
        let index = 0
        for (; index < value.sizeVocabulary.length; index++) {
          try {
            validateSizeVocabulary(value.sizeVocabulary.slice(0, index + 1))
          } catch {
            break
          }
        }
        const entry = value.sizeVocabulary[index]
        if (entry) {
          errors.set(entry, error.message)
          search.value = ''
          render(true)
          virtual.reveal(entry)
          controls.get(entry)?.inputs[0].focus()
        }
        throw error
      }
    },
  }
}
