import { element as el } from './ui.js'
import {
  bindAttribute,
  bindText,
  message as m,
  t as translate,
  getLanguage,
  onLanguageChange,
} from './i18n.js'
import { decorateIcon } from './icons.js'
import { preparationHelp } from './preparation-help.js'
import { attachSearchSuggestions, searchMatcher } from './search-assistance.js'
import {
  preparationColumns,
  PREPARATION_COLUMN_PREFERENCE,
  normalizePreparationColumnPreference,
  selectedPreparationColumns,
} from './preparation-clipboard.js'

export function createPreparationColumnPicker(container, onChange = () => {}) {
  const t = (source, params) =>
    translate(source, params, getLanguage(container))
  let preference
  try {
    preference = normalizePreparationColumnPreference(
      JSON.parse(localStorage.getItem(PREPARATION_COLUMN_PREFERENCE))
    )
  } catch {
    preference = normalizePreparationColumnPreference()
  }
  const host = el('div', undefined, 'preparation-column-picker'),
    searchLabel = el('label', m('Search columns'), 'preparation-column-search'),
    search = el('input'),
    available = el('div', undefined, 'preparation-column-groups'),
    selected = el('section', undefined, 'preparation-column-selection'),
    selectedHeading = el('h3', m('Paste order')),
    selectedList = el('ol', undefined, 'preparation-selected-columns'),
    status = el('p', undefined, 'preparation-column-status'),
    actions = el('div', undefined, 'preparation-column-actions')
  search.type = 'search'
  search.autocomplete = 'off'
  searchLabel.append(search)
  status.setAttribute('role', 'status')
  bindAttribute(
    selectedList,
    'aria-label',
    m('Selected columns in paste order')
  )
  selected.append(selectedHeading, selectedList)
  host.append(searchLabel, actions, available, selected, status)
  container.append(host)
  const stopSearch = attachSearchSuggestions(search, () =>
    preparationColumns.map(([, title, group]) => ({
      value: t(title),
      text: [t(title), title, t(group)].join(' '),
    }))
  )
  const groups = [...new Set(preparationColumns.map(([, , group]) => group))]
  let storageFailed = false
  const chosen = () => selectedPreparationColumns(preference)
  function persist() {
    try {
      localStorage.setItem(
        PREPARATION_COLUMN_PREFERENCE,
        JSON.stringify(preference)
      )
      storageFailed = false
    } catch {
      storageFailed = true
    }
    render()
    onChange(chosen())
  }
  function focusColumn(key) {
    available.querySelector(`input[value="${key}"]`)?.focus()
  }
  function setSelected(key, include) {
    preference.selected = include
      ? [...preference.selected, key]
      : preference.selected.filter((entry) => entry !== key)
    if (include) {
      const order = chosen().filter((entry) => entry !== key)
      preference.order = [
        ...order,
        key,
        ...preference.order.filter(
          (entry) => !order.includes(entry) && entry !== key
        ),
      ]
    }
    persist()
    focusColumn(key)
  }
  for (const [label, action] of [
    [
      'Select all columns',
      () => {
        preference.selected = preparationColumns.map(([key]) => key)
      },
    ],
    [
      'Clear columns',
      () => {
        preference.selected = []
      },
    ],
    [
      'Restore default columns',
      () => {
        preference = normalizePreparationColumnPreference()
      },
    ],
  ]) {
    const button = el('button', m(label))
    button.type = 'button'
    button.onclick = () => {
      action()
      persist()
    }
    actions.append(button)
  }
  function render() {
    const matchesSearch = searchMatcher(search.value)
    available.replaceChildren()
    let matches = 0
    for (const group of groups) {
      const columns = preparationColumns.filter(
        ([, title, section]) =>
          section === group && matchesSearch([t(title), title, t(group)])
      )
      if (!columns.length) continue
      const fieldset = el('fieldset'),
        legend = el('legend', m(group)),
        options = el('div', undefined, 'column-options')
      fieldset.append(legend, options)
      for (const [key, title] of columns) {
        const label = el('label', m(title)),
          check = el('input')
        check.type = 'checkbox'
        check.value = key
        check.checked = preference.selected.includes(key)
        check.onchange = () => setSelected(key, check.checked)
        label.prepend(check)
        if (key === 'sourceSize')
          preparationHelp(
            label,
            m(
              'Copy the saved packing size, or the original size and specifications for products not yet prepared. Wording and units stay unchanged.'
            )
          )
        else if (key === 'sizeSuffix')
          preparationHelp(
            label,
            m(
              'Copy only the assigned size ending from the barcode, such as S, XL or 300. Products without an assigned size code stay blank.'
            )
          )
        else if (
          [
            'orderShipping',
            'orderPayable',
            'orderGoodsGross',
            'orderGoodsNet',
            'orderDiscount',
            'orderAdjustment',
            'orderCustomization',
            'orderRedPacket',
          ].includes(key)
        )
          preparationHelp(
            label,
            m(
              'Whole-order amount repeated for each product. Do not sum this column across product rows.'
            )
          )
        options.append(label)
        matches++
      }
      available.append(fieldset)
    }
    if (!matches) available.append(el('p', m('No matching columns.')))
    selectedList.replaceChildren()
    const selectedKeys = chosen()
    for (const [index, key] of selectedKeys.entries()) {
      const [, title] = preparationColumns.find(([entry]) => entry === key),
        row = el('li'),
        name = el('span', m(title)),
        moves = el('span', undefined, 'preparation-column-moves')
      row.dataset.column = key
      for (const [offset, symbol, label] of [
        [-1, 'previous', 'Move {0} left'],
        [1, 'next', 'Move {0} right'],
      ]) {
        const button = decorateIcon(el('button'), symbol, {
          iconOnly: true,
          label: m(label, { 0: m(title) }),
        })
        button.type = 'button'
        button.dataset.direction = String(offset)
        button.disabled =
          index + offset < 0 || index + offset >= selectedKeys.length
        preparationHelp(button, m(label, { 0: m(title) }))
        button.onclick = () => {
          const order = chosen()
          order.splice(index, 1)
          order.splice(index + offset, 0, key)
          preference.order = [
            ...order,
            ...preference.order.filter((entry) => !order.includes(entry)),
          ]
          persist()
          const next = selectedList.querySelector(
            `[data-column="${key}"] [data-direction="${offset}"]`
          )
          if (!next.disabled) next.focus()
          else focusColumn(key)
        }
        moves.append(button)
      }
      const remove = decorateIcon(el('button'), 'close', {
        iconOnly: true,
        label: m('Remove {0} column', { 0: m(title) }),
      })
      remove.type = 'button'
      remove.onclick = () => setSelected(key, false)
      moves.append(remove)
      row.append(name, moves)
      selectedList.append(row)
    }
    if (!selectedKeys.length)
      selectedList.append(el('li', m('Select columns to copy.')))
    bindText(
      status,
      storageFailed
        ? m(
            'Column choices are active, but this browser could not save them. Keep this popup open to copy.'
          )
        : m('{0} selected columns · choices and order are remembered.', {
            0: selectedKeys.length,
          })
    )
  }
  search.oninput = render
  const stopLanguage = onLanguageChange(render, container)
  render()
  return {
    selected: chosen,
    destroy() {
      stopSearch()
      stopLanguage()
    },
  }
}
