import test from 'node:test'
import assert from 'node:assert/strict'
import {
  EXCEL_IMAGE_SCHEMES,
  normalizeExcelImageDisplay,
  excelImagePalette,
  workspaceExportStyle,
} from '../src/excel-image-style.js'
import {
  appearanceTokens,
  contrastRatio,
  THEME_PALETTES,
} from '../src/appearance.js'

test('new image details are opt-in and old heading preferences keep their meaning', () => {
  const defaults = normalizeExcelImageDisplay()
  assert.equal(defaults.style.scheme, 'neutral')
  assert.equal(defaults.showOrderDetails, true)
  assert.deepEqual(defaults.details, {
    seller: true,
    orderNumber: true,
    date: false,
    status: false,
    orderTags: false,
    title: true,
    specifications: true,
    model: true,
    productTags: false,
  })
  const custom = normalizeExcelImageDisplay({
    showOrderDetails: false,
    style: { scheme: 'custom', accent: '#A1B2C3' },
    details: {
      seller: false,
      orderTags: true,
      productTags: true,
      unknown: true,
    },
  })
  assert.equal(custom.showOrderDetails, false)
  assert.equal(custom.style.accent, '#a1b2c3')
  assert.equal(custom.details.seller, false)
  assert.equal(custom.details.orderTags, true)
  assert.equal(custom.details.productTags, true)
  assert.equal(Object.hasOwn(custom.details, 'unknown'), false)
  assert.equal(
    normalizeExcelImageDisplay({ details: { title: 'false' } }).details.title,
    true
  )
  assert.deepEqual(
    normalizeExcelImageDisplay({ style: { scheme: 'bad', accent: 'url(x)' } }),
    defaults
  )
})

test('every preset and custom accent produces readable header text', () => {
  for (const style of [
    ...EXCEL_IMAGE_SCHEMES.map(({ id, accent }) => ({ scheme: id, accent })),
    ...['#000000', '#ffffff', '#ffff00', '#777777', '#ff0000', '#00ff00'].map(
      (accent) => ({ scheme: 'custom', accent })
    ),
  ]) {
    const palette = excelImagePalette(style)
    assert.ok(
      contrastRatio(palette.header, palette.headerText) >= 4.5,
      JSON.stringify(style)
    )
    assert.equal(Object.isFrozen(palette), true)
  }
  assert.equal(
    excelImagePalette({ scheme: 'custom', accent: '#ffffff' }).headerText,
    '#000000'
  )
  assert.equal(
    excelImagePalette({ scheme: 'custom', accent: '#000000' }).headerText,
    '#ffffff'
  )
})

test('workspace exports snapshot the computed palette in every selected light and dark theme', () => {
  let tokens
  const root = {
    ownerDocument: {
      defaultView: {
        getComputedStyle: () => ({
          getPropertyValue: (name) => ` ${tokens[name.slice(2)] || ''} `,
        }),
      },
    },
  }
  for (const mode of ['light', 'dark'])
    for (const theme of THEME_PALETTES) {
      tokens = appearanceTokens({ [`${mode}Theme`]: theme.id }, mode)
      const style = workspaceExportStyle(root)
      const palette = excelImagePalette(style)
      assert.equal(palette.header, tokens.accent)
      assert.equal(palette.headerText, tokens['on-accent'])
      assert.equal(palette.body, tokens.surface)
      assert.equal(palette.store, tokens.selected)
      assert.equal(palette.order, tokens.field)
      assert.equal(palette.stripe, tokens.page)
      assert.equal(palette.separator, tokens.border)
      assert.equal(palette.grid, tokens.divider)
      assert.equal(palette.text, tokens.text)
      assert.equal(palette.muted, tokens.muted)
      for (const background of ['body', 'store', 'order', 'stripe'])
        for (const foreground of ['text', 'muted'])
          assert.ok(
            contrastRatio(palette[foreground], palette[background]) >= 4.5,
            `${theme.id} ${mode}: ${foreground} on ${background}`
          )
      assert.ok(contrastRatio(palette.headerText, palette.header) >= 4.5)
      const normalized = normalizeExcelImageDisplay({ style }).style
      assert.deepEqual(excelImagePalette(normalized), palette)
      assert.equal(Object.isFrozen(style), true)
      assert.equal(Object.isFrozen(style.workspace), true)
      assert.equal(Object.isFrozen(normalized.workspace), true)
      const snapshot = structuredClone(style)
      tokens = appearanceTokens({}, mode === 'light' ? 'dark' : 'light')
      assert.deepEqual(style, snapshot)
      assert.notDeepEqual(workspaceExportStyle(root), snapshot)
    }
})

test('workspace export fallback uses valid existing palette tokens when no styles are available', () => {
  const fallback = workspaceExportStyle()
  assert.deepEqual(
    workspaceExportStyle({ ownerDocument: { defaultView: {} } }),
    fallback
  )
  for (const value of Object.values(fallback.workspace))
    assert.match(value, /^#[0-9a-f]{6}$/)
  assert.equal(fallback.accent, appearanceTokens({}, 'light').accent)
})
