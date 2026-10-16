import test from 'node:test'
import assert from 'node:assert/strict'
import {
  THEME_PALETTES,
  UI_LABEL_COLORS,
  normalizeAppearance,
  appearanceTokens,
  contrastRatio,
  resetWorkspaceColors,
  upgradeWorkspaceColors,
  WORKSPACE_COLOR_REVISION,
  randomizeReadableColors,
} from '../src/appearance.js'
import { validatePackingPreferences } from '../src/packing-model.js'

test('randomized label pairs change both modes and retain readable colored text through validation', () => {
  for (const [key] of UI_LABEL_COLORS) {
    const current = {
      light: appearanceTokens({}, 'light')[`label-${key}-bg`],
      dark: appearanceTokens({}, 'dark')[`label-${key}-bg`],
    }
    for (let index = 0; index < 28; index++) {
      const next = randomizeReadableColors(current, () => index / 28)
      const preferences = validatePackingPreferences({
        appearance: {
          labelColors: { [key]: { light: next.light, dark: next.dark } },
          labelTextColors: {
            [key]: { light: next.lightText, dark: next.darkText },
          },
        },
      })
      for (const mode of ['light', 'dark']) {
        assert.notEqual(next[mode], current[mode])
        assert.ok(contrastRatio(next[mode], next[`${mode}Text`]) >= 4.5)
        assert.equal(
          appearanceTokens(preferences.appearance, mode)[`label-${key}-text`],
          next[`${mode}Text`]
        )
      }
      assert.equal(
        resetWorkspaceColors(preferences).appearance.labelTextColors,
        undefined
      )
    }
  }
})

test('legacy label and tag colors reseed once without changing themes or unrelated preferences', () => {
  const legacy = {
    settings: { website: 'example.test' },
    vocabulary: [{ match: '玻璃', category: '玻璃' }],
    appearance: {
      lightTheme: '1688',
      darkTheme: 'terracotta',
      labelColors: { saved: { light: '#ffff00', dark: '#0000ff' } },
    },
    orderTags: [
      {
        name: 'Display stock',
        colors: { light: '#ff00ff' },
        textColors: { dark: '#123456' },
      },
    ],
  }
  const before = structuredClone(legacy)
  const upgraded = upgradeWorkspaceColors(legacy)
  assert.deepEqual(legacy, before)
  assert.equal(upgraded.settings, legacy.settings)
  assert.equal(upgraded.vocabulary, legacy.vocabulary)
  assert.equal(upgraded.appearance.paletteRevision, WORKSPACE_COLOR_REVISION)
  assert.equal(upgraded.appearance.lightTheme, '1688')
  assert.equal(upgraded.appearance.darkTheme, 'terracotta')
  assert.deepEqual(upgraded.appearance.labelColors, {})
  assert.deepEqual(upgraded.orderTags, [{ name: 'Display stock', colors: {} }])
  upgraded.appearance.labelColors.saved = { light: '#123456' }
  upgraded.orderTags[0].colors.dark = '#654321'
  upgraded.orderTags[0].textColors = { dark: '#ffffff' }
  const normalized = validatePackingPreferences(upgraded)
  assert.equal(upgradeWorkspaceColors(normalized), normalized)
  assert.deepEqual(normalized.appearance.labelColors.saved, {
    light: '#123456',
  })
  assert.deepEqual(normalized.orderTags[0].textColors, { dark: '#ffffff' })
  const reset = resetWorkspaceColors(normalized)
  assert.deepEqual(reset.appearance.labelColors, {})
  assert.deepEqual(reset.orderTags, [{ name: 'Display stock', colors: {} }])
  assert.equal(upgradeWorkspaceColors(reset), reset)
  assert.equal(
    upgradeWorkspaceColors({}).appearance.paletteRevision,
    WORKSPACE_COLOR_REVISION
  )
})

test('status roles are distinct while Saved and Updated keep comparable quiet backgrounds', () => {
  for (const mode of ['light', 'dark']) {
    const tokens = appearanceTokens({}, mode)
    assert.equal(
      new Set(UI_LABEL_COLORS.map(([key]) => tokens[`label-${key}-bg`])).size,
      UI_LABEL_COLORS.length
    )
    const saved = contrastRatio(tokens['label-saved-bg'], tokens.surface)
    const updated = contrastRatio(tokens['label-updated-bg'], tokens.surface)
    assert.ok(Math.abs(saved - updated) < 0.15)
  }
})

test('every orange palette keeps text and controls readable in both modes', () => {
  for (const theme of THEME_PALETTES)
    for (const mode of ['light', 'dark']) {
      const tokens = appearanceTokens({ [`${mode}Theme`]: theme.id }, mode)
      for (const text of [
        'text',
        'muted',
        'accent-text',
        'danger-text',
        'error',
        'variant-code',
        'size-code',
        'product-name',
        'category-text',
        'material-text',
        'attribute-label',
        'amount-text',
        'quantity-text',
        'description-text',
      ])
        for (const surface of ['page', 'surface', 'hover', 'field', 'selected'])
          assert.ok(
            contrastRatio(tokens[text], tokens[surface]) >= 4.5,
            `${theme.id}/${mode}: ${text} on ${surface}`
          )
      for (const surface of ['page', 'surface', 'field', 'selected'])
        assert.ok(
          contrastRatio(tokens['control-accent'], tokens[surface]) >= 3,
          `${theme.id}/${mode}: controls on ${surface}`
        )
      for (const accent of ['accent', 'accent-hover'])
        assert.ok(
          contrastRatio(tokens['on-accent'], tokens[accent]) >= 4.5,
          `${theme.id}/${mode}: primary text`
        )
      for (const [key] of UI_LABEL_COLORS)
        assert.ok(
          contrastRatio(
            tokens[`label-${key}-text`],
            tokens[`label-${key}-bg`]
          ) >= 4.5,
          `${theme.id}/${mode}: ${key}`
        )
    }
})

test('custom tag backgrounds always receive readable text and persist independently by mode', () => {
  for (const color of [
    '#000000',
    '#ffffff',
    '#ffff00',
    '#ff6600',
    '#181020',
    '#808080',
    '#123456',
  ]) {
    const input = {
      lightTheme: '1688',
      darkTheme: 'terracotta',
      labelColors: {
        dates: { light: color },
        'awaiting-delivery': { dark: color },
      },
    }
    const saved = validatePackingPreferences({ appearance: input }).appearance
    assert.deepEqual(saved, input)
    for (const [mode, key] of [
      ['light', 'dates'],
      ['dark', 'awaiting-delivery'],
    ]) {
      const tokens = appearanceTokens(saved, mode)
      assert.equal(tokens[`label-${key}-bg`], color)
      assert.ok(contrastRatio(tokens[`label-${key}-text`], color) >= 4.5)
    }
    assert.equal(
      appearanceTokens(saved, 'dark')['label-dates-bg'],
      appearanceTokens({ darkTheme: 'terracotta' }, 'dark')['label-dates-bg']
    )
  }
})

test('invalid theme and color input cannot become CSS and original preferences stay untouched', () => {
  const input = {
    lightTheme: 'url(secret)',
    darkTheme: '1688',
    labelColors: {
      dates: { light: 'red; background:url(x)', dark: '#AABBCC' },
      invented: { light: '#ffffff' },
    },
  }
  const before = structuredClone(input)
  assert.deepEqual(normalizeAppearance(input), {
    lightTheme: 'warm',
    darkTheme: '1688',
    labelColors: { dates: { dark: '#aabbcc' } },
  })
  assert.deepEqual(input, before)
  assert.deepEqual(normalizeAppearance(null), {
    lightTheme: 'warm',
    darkTheme: 'warm',
    labelColors: {},
  })
})
