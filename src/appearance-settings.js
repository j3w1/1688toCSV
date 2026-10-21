import { element as el } from './ui.js'
import { message as m, bindAttribute, bindText } from './i18n.js'
import { decorateIcon } from './icons.js'
import { preparationHelp } from './preparation-help.js'
import {
  THEME_PALETTES,
  UI_LABEL_COLORS,
  normalizeAppearance,
  appearanceTokens,
  readableColor,
  resetWorkspaceColors,
  randomizeReadableColors,
} from './appearance.js'

/** Settings edits remain a draft until the shared Save settings action succeeds. */
export function mountAppearanceSettings(host, value, { onColorsReset } = {}) {
  value.appearance = normalizeAppearance(value.appearance)
  const title = el('h3', m('Workspace appearance'))
  const help = el(
    'p',
    m(
      'Choose a palette for each mode. Excel always uses the selected theme’s light colors. Choose Classic brown in both modes to match the reference.'
    ),
    'packing-help'
  )
  const modes = el('div', undefined, 'appearance-modes')
  const labelRows = [],
    palettePreviews = []
  function renderLabels() {
    for (const { key, mode, input, preview } of labelRows) {
      const tokens = appearanceTokens(value.appearance, mode)
      input.value = tokens[`label-${key}-bg`]
      preview.style.backgroundColor = input.value
      preview.style.setProperty('--custom-label-bg', input.value)
      preview.style.color = tokens[`label-${key}-text`]
      preview.toggleAttribute(
        'data-custom-color',
        Boolean(value.appearance.labelColors[key]?.[mode])
      )
    }
    for (const { key, mode, preview } of palettePreviews) {
      const tokens = appearanceTokens(value.appearance, mode)
      preview.style.backgroundColor = tokens[`label-${key}-bg`]
      preview.style.color = tokens[`label-${key}-text`]
    }
  }
  for (const mode of ['light', 'dark']) {
    const card = el('section', undefined, 'appearance-mode'),
      label = el(
        'label',
        m(mode === 'light' ? 'Light palette' : 'Dark palette')
      ),
      select = el('select')
    select.id = `appearance-${mode}`
    label.htmlFor = select.id
    for (const theme of THEME_PALETTES) {
      const option = el('option', m(theme.name))
      option.value = theme.id
      select.append(option)
    }
    select.value = value.appearance[`${mode}Theme`]
    const sample = el('div', undefined, 'appearance-sample')
    const sampleHeading = el('strong', m('1688 Packing workspace')),
      sampleText = el('span', m('Orders · packing · Excel')),
      sampleAccent = el(
        'span',
        m('Selected products'),
        'appearance-selection-sample'
      )
    const badges = el('div', undefined, 'appearance-sample-labels')
    for (const key of [
      'awaiting-payment',
      'awaiting-delivery',
      'saved',
      'updated',
    ]) {
      const [, name] = UI_LABEL_COLORS.find(([id]) => id === key)
      const preview = el('span', m(name))
      badges.append(preview)
      palettePreviews.push({ key, mode, preview })
    }
    sample.append(sampleHeading, sampleText, sampleAccent, badges)
    function paint() {
      const tokens = appearanceTokens(value.appearance, mode)
      sample.style.backgroundColor = tokens.page
      sample.style.color = tokens.text
      sampleText.style.color = tokens.muted
      sampleAccent.style.color = tokens['accent-text']
      sampleAccent.style.backgroundColor = tokens.selected
      sample.style.borderColor = tokens.border
    }
    select.onchange = () => {
      value.appearance[`${mode}Theme`] = select.value
      paint()
      renderLabels()
    }
    preparationHelp(
      select,
      m(
        'This palette is used when the workspace is in this light or dark mode. Save settings to apply it.'
      )
    )
    card.append(label, select, sample)
    modes.append(card)
    paint()
  }
  const heading = el('h3', m('Label colors'))
  const description = el(
    'p',
    m(
      'Customize status, date and saved-state labels. Text contrast adjusts automatically; selection and printed label colors are unchanged.'
    ),
    'packing-help'
  )
  const table = el('div', undefined, 'appearance-label-list')
  for (let index = 0; index < 2; index++) {
    const row = el('div', undefined, 'appearance-label-head')
    row.setAttribute('aria-hidden', 'true')
    row.append(
      el('span'),
      el('span', m('Light')),
      el('span', m('Dark')),
      el('span')
    )
    table.append(row)
  }
  for (const [key, name] of UI_LABEL_COLORS) {
    const row = el('div', undefined, 'appearance-label-row')
    row.append(el('span', m(name)))
    for (const mode of ['light', 'dark']) {
      const label = el('label', undefined, 'appearance-label-control'),
        input = el('input'),
        preview = el('span', 'Aa', 'appearance-label-preview')
      input.type = 'color'
      input.style.colorScheme = mode
      input.id = `appearance-label-${key}-${mode}`
      label.htmlFor = input.id
      bindAttribute(
        input,
        'aria-label',
        m('{label} · {mode}', {
          label: m(name),
          mode: m(mode === 'light' ? 'Light' : 'Dark'),
        })
      )
      input.oninput = () => {
        value.appearance.labelColors[key] ??= {}
        value.appearance.labelColors[key][mode] = input.value
        if (value.appearance.labelTextColors?.[key])
          delete value.appearance.labelTextColors[key][mode]
        preview.style.backgroundColor = input.value
        preview.style.setProperty('--custom-label-bg', input.value)
        preview.style.color = readableColor(input.value)
        preview.setAttribute('data-custom-color', '')
        renderLabels()
      }
      preparationHelp(
        input,
        m('Choose the label background. Its text automatically stays readable.')
      )
      label.append(input, preview)
      row.append(label)
      labelRows.push({ key, mode, input, preview })
    }
    const reset = decorateIcon(el('button', m('Reset label color')), 'undo', {
      iconOnly: true,
    })
    reset.type = 'button'
    bindAttribute(
      reset,
      'aria-label',
      m('Reset {label} colors', { label: m(name) })
    )
    preparationHelp(
      reset,
      m(
        'Restore the palette’s label colors in both modes. Save settings to apply.'
      )
    )
    reset.onclick = () => {
      delete value.appearance.labelColors[key]
      delete value.appearance.labelTextColors?.[key]
      renderLabels()
    }
    const actions = el('div', undefined, 'appearance-label-actions'),
      randomize = decorateIcon(
        el('button', m('Randomize {label} colors', { label: m(name) })),
        'refresh',
        { iconOnly: true }
      )
    randomize.type = 'button'
    preparationHelp(
      randomize,
      m(
        'Try another coordinated background and text color in both modes. Save settings to keep it.'
      )
    )
    randomize.onclick = () => {
      const colors = randomizeReadableColors({
        light: appearanceTokens(value.appearance, 'light')[`label-${key}-bg`],
        dark: appearanceTokens(value.appearance, 'dark')[`label-${key}-bg`],
      })
      value.appearance.labelColors[key] = {
        light: colors.light,
        dark: colors.dark,
      }
      value.appearance.labelTextColors ??= {}
      value.appearance.labelTextColors[key] = {
        light: colors.lightText,
        dark: colors.darkText,
      }
      renderLabels()
    }
    actions.append(randomize, reset)
    row.append(actions)
    table.append(row)
  }
  const themeSection = el('section', undefined, 'appearance-section'),
    colorsSection = el('section', undefined, 'appearance-section'),
    colorHeader = el('div', undefined, 'settings-section-heading'),
    reset = decorateIcon(
      el('button', m('Reset all label and tag colors')),
      'undo'
    ),
    resetStatus = el('p', undefined, 'packing-help appearance-reset-status')
  reset.type = 'button'
  resetStatus.setAttribute('role', 'status')
  preparationHelp(
    reset,
    m(
      'Reset status, date and activity label colors here, plus order and product tag colors in Tags, in both modes. Save settings to apply.'
    )
  )
  themeSection.append(title, help, modes)
  colorHeader.append(heading, reset)
  colorsSection.append(colorHeader, description, resetStatus, table)
  host.append(themeSection, colorsSection)
  reset.onclick = () => {
    const next = resetWorkspaceColors(value)
    value.appearance = next.appearance
    value.orderTags = next.orderTags
    value.productTags = next.productTags
    renderLabels()
    onColorsReset?.()
    bindText(
      resetStatus,
      m(
        'Recommended label colors are shown here and tag colors in Tags. Save settings to apply.'
      )
    )
  }
  renderLabels()
  return {
    validate: () => normalizeAppearance(value.appearance),
  }
}
