import { element as el } from './ui.js'
import { message as m, bindText, bindAttribute, getLanguage } from './i18n.js'
import { attachSearchSuggestions, searchMatcher } from './search-assistance.js'
import { decorateIcon } from './icons.js'
import { preparationHelp } from './preparation-help.js'
import {
  MATERIAL_VOCABULARY,
  validateMaterialVocabulary,
} from './material-vocabulary.js'

/** Edit the Settings draft; persistence stays with the Settings save action. */
export function mountMaterialVocabulary(host, value) {
  value.materialVocabulary = structuredClone(
    value.materialVocabulary ?? MATERIAL_VOCABULARY
  )
  const pageSize = 8,
    controls = new Map(),
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
    navigation = el('div', undefined, 'vocabulary-navigation'),
    count = el('span', undefined, 'packing-help'),
    errors = el('p', undefined, 'appearance-validation')
  let page = 0
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
    page = 0
    render()
  })

  function action(title, icon, help, handler, iconOnly = false) {
    const button = decorateIcon(el('button', m(title)), icon, { iconOnly })
    button.type = 'button'
    button.addEventListener('click', handler)
    preparationHelp(button, m(help))
    return button
  }
  const previous = action(
      'Previous material rules',
      'previous',
      'Previous page of material rules.',
      () => {
        page--
        render()
      },
      true
    ),
    next = action(
      'Next material rules',
      'next',
      'Next page of material rules.',
      () => {
        page++
        render()
      },
      true
    ),
    add = action(
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
        page = 0
        render()
        body.querySelector('input')?.focus()
      }
    )
  count.setAttribute('role', 'status')
  errors.setAttribute('role', 'status')
  errors.id = `material-rule-errors-${crypto.randomUUID()}`
  errors.hidden = true
  navigation.append(previous, count, next)
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
    errors.hidden = true
    for (const input of body.querySelectorAll('[aria-invalid]'))
      input.removeAttribute('aria-invalid')
  }
  function showError(error, index) {
    clearError()
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
  function render() {
    const matches = searchMatcher(search.value),
      matching = value.materialVocabulary.filter((entry) =>
        matches([...entry.aliases, entry.en, entry.zh, entry.es])
      )
    page = Math.max(
      0,
      Math.min(page, Math.ceil(matching.length / pageSize) - 1)
    )
    controls.clear()
    body.replaceChildren()
    for (const entry of matching.slice(
      page * pageSize,
      (page + 1) * pageSize
    )) {
      const row = el('tr'),
        fields = new Map()
      row.dataset.materialRule = entry.id
      for (const field of ['aliases', 'en', 'zh', 'es']) {
        const cell = el('td'),
          input = el('input')
        input.name = field
        input.dataset.ruleField = field
        input.value =
          field === 'aliases' ? entry.aliases.join('|') : entry[field]
        input.required = true
        input.maxLength = field === 'aliases' ? 4000 : 80
        input.autocomplete = 'off'
        input.setAttribute('aria-labelledby', headers.get(field))
        input.setAttribute('aria-describedby', errors.id)
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
            const index = value.materialVocabulary.indexOf(entry)
            value.materialVocabulary.splice(index, 1)
            clearError()
            render()
            const remaining = [...body.querySelectorAll('button')]
            remaining[Math.min(remaining.length - 1, index % pageSize)]?.focus()
            if (!remaining.length) add.focus()
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
      body.append(row)
      controls.set(entry, fields)
    }
    if (!matching.length) {
      const row = el('tr'),
        cell = el('td', m('No matching material rules.'), 'vocabulary-empty')
      cell.colSpan = 5
      row.append(cell)
      body.append(row)
    }
    bindText(
      count,
      m('{0}–{1} of {2} rules', {
        0: matching.length ? page * pageSize + 1 : 0,
        1: Math.min((page + 1) * pageSize, matching.length),
        2: matching.length,
      })
    )
    previous.disabled = page === 0
    next.disabled = (page + 1) * pageSize >= matching.length
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
    validate() {
      try {
        return validateMaterialVocabulary(value.materialVocabulary)
      } catch (error) {
        const index = error.ruleIndex || 0
        search.value = ''
        page = Math.floor(index / pageSize)
        render()
        showError(error, index)?.focus()
        throw error
      }
    },
  }
}
