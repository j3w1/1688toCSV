import test from 'node:test'
import assert from 'node:assert/strict'
import { createExcelImageBadges } from '../src/excel-image-badges.js'
import { appearanceTokens, UI_LABEL_COLORS } from '../src/appearance.js'
import { orderTagColors } from '../src/order-tags.js'

test('image badge defaults follow workspace labels in each light and dark mode', () => {
  for (const mode of ['light', 'dark']) {
    const snapshot = createExcelImageBadges({}, mode)
    const tokens = appearanceTokens({}, mode)
    assert.equal(snapshot.mode, mode)
    assert.deepEqual(snapshot.orderTags, {})
    assert.deepEqual(snapshot.productTags, {})
    assert.deepEqual(
      Object.keys(snapshot.labels),
      UI_LABEL_COLORS.map(([key]) => key)
    )
    for (const [key] of UI_LABEL_COLORS)
      assert.deepEqual(snapshot.labels[key], {
        background: tokens[`label-${key}-bg`],
        foreground: tokens[`label-${key}-text`],
      })
  }
  assert.equal(createExcelImageBadges().mode, 'light')
  assert.deepEqual(
    createExcelImageBadges({}, 'unknown'),
    createExcelImageBadges()
  )
})

test('order and product tag catalogs keep independent colors for the same name', () => {
  const preferences = {
    orderTags: [
      {
        name: 'Fragile',
        colors: { light: '#ffcc88', dark: '#221100' },
        textColors: { light: '#443322', dark: '#ffeeaa' },
      },
    ],
    productTags: [
      {
        name: 'Fragile',
        colors: { light: '#eeffee', dark: '#112211' },
        textColors: { light: '#114411', dark: '#bbffbb' },
      },
    ],
  }
  const original = structuredClone(preferences)
  for (const mode of ['light', 'dark']) {
    const snapshot = createExcelImageBadges(preferences, mode)
    for (const scope of ['orderTags', 'productTags']) {
      const entry = preferences[scope][0]
      assert.deepEqual(snapshot[scope].Fragile, {
        background: entry.colors[mode],
        foreground: entry.textColors[mode],
      })
    }
    assert.notDeepEqual(
      snapshot.orderTags.Fragile,
      snapshot.productTags.Fragile
    )
  }
  assert.deepEqual(preferences, original)
})

test('labels reuse workspace custom colors and tag defaults keep automatic readable text', () => {
  const preferences = {
    appearance: {
      labelColors: { dates: { light: '#000000', dark: '#ffffff' } },
      labelTextColors: { dates: { light: '#ffdb00', dark: '#221100' } },
    },
    orderTags: [
      { name: 'No custom colors' },
      {
        name: 'Background only',
        colors: { light: '#000000', dark: '#ffffff' },
      },
      {
        name: 'Authored text',
        colors: { light: '#111111', dark: '#eeeeee' },
        textColors: { light: '#222222', dark: '#dddddd' },
      },
    ],
  }
  for (const mode of ['light', 'dark']) {
    const snapshot = createExcelImageBadges(preferences, mode)
    assert.deepEqual(snapshot.labels.dates, {
      background: preferences.appearance.labelColors.dates[mode],
      foreground: preferences.appearance.labelTextColors.dates[mode],
    })
    for (const entry of preferences.orderTags) {
      const expected = orderTagColors(entry)
      assert.deepEqual(snapshot.orderTags[entry.name], {
        background: expected[mode],
        foreground: expected[`${mode}Text`],
      })
    }
    assert.equal(
      snapshot.orderTags['Authored text'].foreground,
      preferences.orderTags[2].textColors[mode]
    )
    assert.equal(
      snapshot.orderTags['Background only'].foreground,
      mode === 'light' ? '#ffffff' : '#000000'
    )
  }
})

test('badge snapshots are serializable, deeply frozen and independent from later settings', () => {
  const preferences = {
    appearance: { labelColors: { completed: { dark: '#aacc99' } } },
    orderTags: [{ name: 'Ready', colors: { dark: '#112233' } }],
    productTags: [{ name: 'Ready', colors: { dark: '#332211' } }],
  }
  const snapshot = createExcelImageBadges(preferences, 'dark')
  const original = JSON.parse(JSON.stringify(snapshot))
  preferences.appearance.labelColors.completed.dark = '#000000'
  preferences.orderTags[0].colors.dark = '#ffffff'
  preferences.orderTags[0].name = 'Changed'
  preferences.productTags.length = 0
  assert.deepEqual(snapshot, original)
  assert.ok(Object.isFrozen(snapshot))
  for (const catalog of ['orderTags', 'productTags', 'labels']) {
    assert.ok(Object.isFrozen(snapshot[catalog]))
    for (const colors of Object.values(snapshot[catalog]))
      assert.ok(Object.isFrozen(colors))
  }
  assert.throws(() => {
    snapshot.orderTags.Ready.background = '#abcdef'
  }, TypeError)
  assert.throws(() => {
    snapshot.productTags.Added = {
      background: '#000000',
      foreground: '#ffffff',
    }
  }, TypeError)
  assert.throws(() => {
    snapshot.labels.completed.foreground = '#000000'
  }, TypeError)
})
