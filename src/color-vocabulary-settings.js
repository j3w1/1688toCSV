import { element as el } from './ui.js'
import { message as m, bindText, bindAttribute, getLanguage } from './i18n.js'
import { attachSearchSuggestions, searchMatcher } from './search-assistance.js'
import { decorateIcon } from './icons.js'
import { preparationHelp } from './preparation-help.js'
import {
  COLOR_VOCABULARY,
  validateColorVocabulary,
} from './color-vocabulary.js'

export function mountColorVocabulary(host, value) {
  value.colorVocabulary = structuredClone(
    value.colorVocabulary ?? COLOR_VOCABULARY
  )
  let page = 0
  const pageSize = 8
  const toolbar = el('div', undefined, 'vocabulary-toolbar'),
    searchLabel = el('label', m('Search color rules'), 'vocabulary-search'),
    search = el('input')
  search.id = 'color-rule-search'
  search.type = 'search'
  searchLabel.htmlFor = search.id
  searchLabel.append(search)
  search.oninput = () => {
    page = 0
    render()
  }
  const table = el(
      'table',
      undefined,
      'vocabulary-table color-vocabulary-table'
    ),
    head = el('thead'),
    headings = el('tr'),
    body = el('tbody'),
    scroll = el('div', undefined, 'vocabulary-scroll')
  for (const title of [
    'Seller color names',
    'English',
    'Chinese',
    'Spanish',
    'Swatch',
    '',
  ]) {
    const cell = el('th', m(title))
    cell.scope = 'col'
    headings.append(cell)
  }
  head.append(headings)
  table.append(head, body)
  scroll.append(table)
  scroll.tabIndex = 0
  scroll.setAttribute('role', 'region')
  bindAttribute(scroll, 'aria-label', m('Product color rules'))
  const status = el('span', undefined, 'packing-help'),
    navigation = el('div', undefined, 'vocabulary-navigation'),
    errors = el('p', undefined, 'appearance-validation')
  errors.setAttribute('role', 'status')
  errors.hidden = true
  function action(title, icon, help, handler, iconOnly = false) {
    const button = decorateIcon(el('button', m(title)), icon, { iconOnly })
    button.type = 'button'
    button.onclick = handler
    preparationHelp(button, m(help))
    return button
  }
  const previous = action(
      'Previous color rules',
      'previous',
      'Previous page of color rules.',
      () => {
        page--
        render()
      },
      true
    ),
    next = action(
      'Next color rules',
      'next',
      'Next page of color rules.',
      () => {
        page++
        render()
      },
      true
    )
  status.setAttribute('role', 'status')
  navigation.append(previous, status, next)
  const add = action(
    'Add color rule',
    'plus',
    'Add a seller color name, translations and an optional swatch.',
    () => {
      value.colorVocabulary.unshift({
        id: `custom-${crypto.randomUUID()}`,
        aliases: [],
        labels: { en: '', zh: '', es: '' },
        swatch: '#d9985c',
        kind: 'color',
      })
      search.value = ''
      page = 0
      render()
      body.querySelector('input')?.focus()
    }
  )
  toolbar.append(searchLabel, add)
  host.append(
    el('h3', m('Product colors')),
    el(
      'p',
      m(
        'Translate seller color names and adjust their swatches. These helpers never change original descriptions, saved label names or codes.'
      ),
      'packing-help'
    ),
    toolbar,
    errors,
    scroll,
    navigation
  )
  function render() {
    const matches = searchMatcher(search.value),
      matching = value.colorVocabulary.filter((entry) =>
        matches([...entry.aliases, ...Object.values(entry.labels)])
      )
    page = Math.max(
      0,
      Math.min(page, Math.ceil(matching.length / pageSize) - 1)
    )
    body.replaceChildren()
    for (const entry of matching.slice(
      page * pageSize,
      (page + 1) * pageSize
    )) {
      const row = el('tr')
      row.dataset.colorRule = entry.id
      for (const language of ['aliases', 'en', 'zh', 'es']) {
        const cell = el('td'),
          input = el('input')
        input.value =
          language === 'aliases'
            ? entry.aliases.join('|')
            : entry.labels[language]
        input.dataset.ruleField = language
        const title =
          language === 'aliases'
            ? 'Seller color names'
            : { en: 'English', zh: 'Chinese', es: 'Spanish' }[language]
        bindAttribute(input, 'aria-label', m(title))
        input.maxLength = language === 'aliases' ? 4000 : 80
        input.oninput = () => {
          if (language === 'aliases')
            entry.aliases = input.value
              .split('|')
              .map((part) => part.trim())
              .filter(Boolean)
          else entry.labels[language] = input.value
          errors.hidden = true
          input.removeAttribute('aria-invalid')
        }
        preparationHelp(
          input,
          m(
            language === 'aliases'
              ? 'Match these seller color names. Separate alternatives with |.'
              : 'Display name for this color in the chosen language.'
          )
        )
        cell.append(input)
        row.append(cell)
      }
      const swatchCell = el('td'),
        swatch = el('input'),
        enabled = el('input'),
        toggle = el('label', m('Show'), 'color-swatch-toggle')
      swatch.type = 'color'
      swatch.dataset.ruleField = 'swatch'
      swatch.value = entry.swatch || '#d9985c'
      swatch.disabled = !entry.swatch
      bindAttribute(swatch, 'aria-label', m('Color swatch'))
      enabled.type = 'checkbox'
      enabled.checked = !!entry.swatch
      enabled.id = `color-swatch-${entry.id}`
      toggle.htmlFor = enabled.id
      bindAttribute(enabled, 'aria-label', m('Show color swatch'))
      enabled.onchange = () => {
        entry.swatch = enabled.checked ? swatch.value : null
        swatch.disabled = !enabled.checked
      }
      swatch.oninput = () => {
        entry.swatch = swatch.value
      }
      preparationHelp(
        swatch,
        m(
          'An illustrative swatch for this color; the seller’s photo remains the source.'
        )
      )
      preparationHelp(
        enabled,
        m(
          'Hide the swatch for patterns or finishes that cannot be represented by a solid color.'
        )
      )
      toggle.prepend(enabled)
      swatchCell.append(swatch, toggle)
      row.append(swatchCell)
      const actions = el('td'),
        remove = action(
          'Remove color rule',
          'trash',
          'Remove this translation rule when you save Settings.',
          () => {
            value.colorVocabulary = value.colorVocabulary.filter(
              (item) => item !== entry
            )
            render()
          },
          true
        )
      actions.append(remove)
      row.append(actions)
      body.append(row)
    }
    if (!matching.length) {
      const row = el('tr'),
        cell = el('td', m('No matching rules.'))
      cell.colSpan = 6
      row.append(cell)
      body.append(row)
    }
    bindText(
      status,
      m('{0}–{1} of {2} rules', {
        0: matching.length ? page * pageSize + 1 : 0,
        1: Math.min((page + 1) * pageSize, matching.length),
        2: matching.length,
      })
    )
    previous.disabled = page === 0
    next.disabled = (page + 1) * pageSize >= matching.length
    add.disabled = value.colorVocabulary.length >= 500
  }
  render()
  attachSearchSuggestions(search, () =>
    value.colorVocabulary.map((entry) => ({
      value: entry.labels[getLanguage()] || entry.aliases[0],
      text: [...entry.aliases, ...Object.values(entry.labels)].join(' '),
    }))
  )
  return {
    validate() {
      try {
        return validateColorVocabulary(value.colorVocabulary)
      } catch (error) {
        if (error.ruleReason)
          error.message = String(
            m('Color rule {0}: {1}', {
              0: error.ruleIndex + 1,
              1: m(error.ruleReason),
            })
          )
        search.value = ''
        page = Math.floor((error.ruleIndex || 0) / pageSize)
        render()
        errors.hidden = false
        bindText(errors, m(error.message))
        const row = body.querySelector(
            `[data-color-rule="${value.colorVocabulary[error.ruleIndex || 0]?.id}"]`
          ),
          input =
            row?.querySelector(
              `[data-rule-field="${error.ruleField || 'aliases'}"]`
            ) || row?.querySelector('input')
        input?.setAttribute('aria-invalid', 'true')
        input?.focus()
        throw error
      }
    },
  }
}
