import { element as el } from './ui.js'
import { message as m, bindText, bindAttribute, getLanguage } from './i18n.js'
import { attachSearchSuggestions, searchMatcher } from './search-assistance.js'
import { decorateIcon } from './icons.js'
import { preparationHelp } from './preparation-help.js'
import { createVocabularyTable } from './vocabulary-table.js'
import {
  MATERIAL_VOCABULARY,
  validateMaterialVocabulary,
} from './material-vocabulary.js'

/** Edit the Settings draft; persistence stays with the Settings save action. */
export function mountMaterialVocabulary(host, value) {
  value.materialVocabulary = structuredClone(
    value.materialVocabulary ?? MATERIAL_VOCABULARY
  )
  let invalid
  const controls = new Map(),
    toolbar = el('div', undefined, 'vocabulary-toolbar'),
    searchLabel = el('label', m('Search material rules'), 'vocabulary-search'),
    search = el('input'),
    scroll = el('div', undefined, 'vocabulary-scroll'),
    table = el(
      'table',
      undefined,
      'vocabulary-table material-vocabulary-table'
    ),
    body = el('tbody'),
    navigation = el('div', undefined, 'vocabulary-status'),
    count = el('span', undefined, 'packing-help'),
    errors = el('p', undefined, 'appearance-validation')
  search.type = 'search'
  search.name = 'material-rule-search'
  search.id = `material-rule-search-${crypto.randomUUID()}`
  search.autocomplete = 'off'
  search.autocapitalize = 'off'
  search.setAttribute('autocorrect', 'off')
  search.spellcheck = false
  searchLabel.htmlFor = search.id
  searchLabel.append(search)
  preparationHelp(search, m('Filter by a seller material name or translation.'))
  search.addEventListener('input', () => {
    render(true)
  })

  function action(title, icon, help, handler, iconOnly = false) {
    const button = decorateIcon(el('button', m(title)), icon, { iconOnly })
    button.type = 'button'
    button.addEventListener('click', handler)
    preparationHelp(button, m(help))
    return button
  }
  const add = action(
    'Add material rule',
    'plus',
    'Add seller material names and their translations.',
    () => {
      if (value.materialVocabulary.length >= 500) return
      value.materialVocabulary.unshift({
        id: `custom-${crypto.randomUUID()}`,
        aliases: [],
        en: '',
        zh: '',
        es: '',
        parent: '',
      })
      search.value = ''
      render(true)
      virtual
        .reveal(value.materialVocabulary[0])
        ?.querySelector('input')
        ?.focus()
    }
  )
  count.setAttribute('role', 'status')
  errors.setAttribute('role', 'status')
  errors.id = `material-rule-errors-${crypto.randomUUID()}`
  errors.hidden = true
  navigation.append(count)
  toolbar.append(searchLabel, add)
  scroll.tabIndex = 0
  scroll.setAttribute('role', 'region')
  bindAttribute(scroll, 'aria-label', m('Material rules'))
  const columns = el('colgroup'),
    head = el('thead'),
    headings = el('tr'),
    headers = new Map()
  for (const [field, title] of [
    ['aliases', 'Seller material names'],
    ['en', 'English'],
    ['zh', 'Chinese'],
    ['es', 'Spanish'],
    ['remove', ''],
  ]) {
    const column = el('col'),
      heading = el('th', m(title))
    if (field === 'aliases') column.style.width = '32%'
    if (field === 'remove') column.style.width = '40px'
    heading.scope = 'col'
    heading.id = `material-heading-${crypto.randomUUID()}`
    headers.set(field, heading.id)
    headings.append(heading)
    columns.append(column)
  }
  head.append(headings)
  table.append(columns, head, body)
  scroll.append(table)
  host.append(
    el('h3', m('Materials')),
    el(
      'p',
      m(
        'Recognize seller material names and edit their English, Chinese and Spanish displays. Original descriptions and your manual materials, including empty values, are kept.'
      ),
      'packing-help'
    ),
    toolbar,
    errors,
    scroll,
    navigation
  )

  function clearError() {
    invalid = undefined
    errors.hidden = true
    for (const input of body.querySelectorAll('[aria-invalid]'))
      input.removeAttribute('aria-invalid')
  }
  function showError(error, index) {
    clearError()
    invalid = {
      entry: value.materialVocabulary[index],
      field: error.ruleField || 'aliases',
    }
    errors.hidden = false
    bindText(
      errors,
      error.ruleReason
        ? m('Material rule {0}: {1}', { 0: index + 1, 1: m(error.ruleReason) })
        : m(error.message)
    )
    const input = controls
      .get(value.materialVocabulary[index])
      ?.get(error.ruleField || 'aliases')
    input?.setAttribute('aria-invalid', 'true')
    return input
  }
  function renderRow(entry) {
    const row = el('tr'),
      fields = new Map()
    row.dataset.materialRule = entry.id
    for (const field of ['aliases', 'en', 'zh', 'es']) {
      const cell = el('td'),
        input = el('input')
      input.name = field
      input.dataset.ruleField = field
      input.value = field === 'aliases' ? entry.aliases.join('|') : entry[field]
      input.required = true
      input.maxLength = field === 'aliases' ? 4000 : 80
      input.autocomplete = 'off'
      input.setAttribute('aria-labelledby', headers.get(field))
      input.setAttribute('aria-describedby', errors.id)
      if (invalid?.entry === entry && invalid.field === field)
        input.setAttribute('aria-invalid', 'true')
      if (field === 'aliases') {
        input.autocapitalize = 'off'
        input.setAttribute('autocorrect', 'off')
        input.spellcheck = false
      }
      input.addEventListener('input', () => {
        if (field === 'aliases')
          entry.aliases = input.value
            .split('|')
            .map((part) => part.trim())
            .filter(Boolean)
        else entry[field] = input.value
        clearError()
      })
      preparationHelp(
        input,
        m(
          field === 'aliases'
            ? 'Match these seller material names. Separate alternatives with |.'
            : 'Display name for this material in the chosen language.'
        )
      )
      fields.set(field, input)
      cell.append(input)
      row.append(cell)
    }
    const actions = el('td')
    actions.append(
      action(
        'Remove material rule',
        'trash',
        'Remove this material rule when you save Settings.',
        () => {
          const matching = matchingRules(),
            position = matching.indexOf(entry),
            index = value.materialVocabulary.indexOf(entry)
          value.materialVocabulary.splice(index, 1)
          clearError()
          render()
          const next = matching[position + 1] || matching[position - 1]
          if (next) virtual.reveal(next)?.querySelector('button')?.focus()
          else add.focus()
        },
        true
      )
    )
    row.append(actions)
    row.addEventListener('focusout', (event) => {
      if (row.contains(event.relatedTarget)) return
      const index = value.materialVocabulary.indexOf(entry)
      try {
        validateMaterialVocabulary([entry])
      } catch (error) {
        showError(error, index)
        return
      }
      try {
        validateMaterialVocabulary(value.materialVocabulary)
      } catch (error) {
        // Other unfinished draft rows must not interrupt this row's editing.
        if (error.ruleIndex === index) showError(error, index)
      }
    })
    controls.set(entry, fields)
    return row
  }
  const virtual = createVocabularyTable({
    scroller: scroll,
    body,
    render: renderRow,
    remove: (entry) => controls.delete(entry),
    emptyMessage: m('No matching material rules.'),
  })
  function matchingRules() {
    const matches = searchMatcher(search.value)
    return value.materialVocabulary.filter((entry) =>
      matches([...entry.aliases, entry.en, entry.zh, entry.es])
    )
  }
  function render(reset = false) {
    const matching = matchingRules()
    virtual.setItems(matching, { reset })
    bindText(count, m('{0} rules', { 0: matching.length }))
    add.disabled = value.materialVocabulary.length >= 500
  }
  render()
  attachSearchSuggestions(search, () =>
    value.materialVocabulary.map((entry) => ({
      value: entry[getLanguage()] || entry.aliases[0],
      text: [...entry.aliases, entry.en, entry.zh, entry.es].join(' '),
    }))
  )
  return {
    destroy: () => virtual.destroy(),
    revealError() {
      return invalid
        ? virtual.reveal(invalid.entry)?.querySelector('[aria-invalid="true"]')
        : undefined
    },
    validate() {
      try {
        return validateMaterialVocabulary(value.materialVocabulary)
      } catch (error) {
        const index = error.ruleIndex || 0
        search.value = ''
        render(true)
        virtual.reveal(value.materialVocabulary[index])
        showError(error, index)?.focus()
        throw error
      }
    },
  }
}
