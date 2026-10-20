import { element as el, copyTextButton } from './ui.js'
import { message as m, bindAttribute } from './i18n.js'
import { decorateIcon } from './icons.js'

const markerRows = [
  [['pic'], 'Product photos', 'Required for every imported product.'],
  [
    ['group'],
    'Product group',
    'Required. Repeated values join a group; a blank skips the row.',
  ],
  [['boxes'], 'Cartons', 'Required. Number of cartons for this row.'],
  [
    ['perbox'],
    'Pcs/box',
    'Provide perbox, qty, or both. Units inside one carton.',
  ],
  [
    ['qty'],
    'Total quantity',
    'Provide perbox, qty, or both. Units across all cartons.',
  ],
  [['price'], 'Unit price', 'Required. Price of one unit in yuan.'],
  [
    ['amount'],
    'Product amount',
    'Optional. Must equal unit price × total quantity.',
  ],
  [
    ['desc'],
    'Seller description',
    'Optional; repeat on each description column you want to include.',
  ],
  [
    ['var'],
    'Variant or size',
    'Optional. Combined variants require a reviewed quantity split.',
  ],
  [
    ['kg'],
    'Carton weight',
    'Optional. Kilograms per carton, never the row total.',
  ],
  [
    ['cbm'],
    'Carton volume',
    'Optional. Cubic metres per carton, never the row total.',
  ],
  [
    ['cbmx', 'cbmy', 'cbmz'],
    'Carton dimensions',
    'Optional. Length, width and height in centimetres; all three take priority over cbm.',
  ],
  [
    ['total'],
    'Order total',
    'Required twice, on either side of the seller’s whole-order total.',
  ],
]

function copyToken(value, label = 'Copy import marker') {
  return copyTextButton(value, {
    label: m(label),
    className: 'store-import-token',
  })
}

function section(title, text) {
  const result = el('section', undefined, 'store-import-rule')
  result.append(el('h3', m(title)), el('p', m(text)))
  return result
}

/** Canonical format documentation shared by Settings and the import review. */
export function mountStoreSpreadsheetGuide(host) {
  const root = el('div', undefined, 'store-import-guide-content'),
    intro = el(
      'p',
      m(
        'Prepare a copy of the seller’s workbook, then review its rows, photos and totals before importing a new order.'
      ),
      'store-import-guide-intro'
    ),
    tabs = el('div', undefined, 'store-import-guide-tabs'),
    panels = el('div', undefined, 'store-import-guide-panels'),
    controls = []
  tabs.setAttribute('role', 'tablist')
  bindAttribute(tabs, 'aria-label', m('Spreadsheet guide sections'))
  const makePanel = (title) => {
    const id = `store-import-guide-${crypto.randomUUID()}`,
      tab = el('button', m(title)),
      panel = el('section', undefined, 'store-import-guide-panel')
    tab.type = 'button'
    tab.id = `${id}-tab`
    tab.setAttribute('role', 'tab')
    tab.setAttribute('aria-controls', id)
    panel.id = id
    panel.tabIndex = 0
    panel.setAttribute('role', 'tabpanel')
    panel.setAttribute('aria-labelledby', tab.id)
    controls.push({ tab, panel })
    tab.addEventListener('click', () => select(tab))
    tabs.append(tab)
    panels.append(panel)
    return panel
  }
  const select = (selected) => {
    for (const { tab, panel } of controls) {
      const active = tab === selected
      tab.setAttribute('aria-selected', String(active))
      tab.tabIndex = active ? 0 : -1
      panel.hidden = !active
    }
  }
  tabs.addEventListener('keydown', (event) => {
    const current = controls.findIndex(({ tab }) => tab === event.target)
    if (current < 0 || event.altKey || event.ctrlKey || event.metaKey) return
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? controls.length - 1
          : event.key === 'ArrowRight'
            ? (current + 1) % controls.length
            : event.key === 'ArrowLeft'
              ? (current + controls.length - 1) % controls.length
              : -1
    if (next < 0) return
    event.preventDefault()
    select(controls[next].tab)
    controls[next].tab.focus()
  })

  const start = makePanel('Start here')
  const filenames = section(
    'Name the file',
    'A numeric filename identifies a store number. A company-name filename identifies a factory without a store number. Windows copy suffixes do not change the store identity. Each import creates a new order.'
  )
  const examples = el('dl', undefined, 'store-import-filenames')
  for (const [title, files] of [
    [
      'Same store · new orders',
      ['12345.xlsx', '12345 (2).xlsx', '12345 (5) (Copy).xlsx'],
    ],
    [
      'Same factory · new orders',
      ['示例工厂有限公司.xlsx', '示例工厂有限公司 (2).xlsx'],
    ],
  ]) {
    const row = el('div'),
      values = el('dd')
    values.append(
      ...files.map((file) => copyToken(file, 'Copy filename example'))
    )
    row.append(el('dt', m(title)), values)
    examples.append(row)
  }
  filenames.append(examples)
  const workflow = section(
    'Mark a copy of the workbook',
    'Keep the seller’s original file. Add a row of import markers above the seller’s column headers. Only marked columns are included; their position does not matter.'
  )
  const steps = el('ol')
  for (const text of [
    'Copy markers from the next tab. Repeat desc for every description column to combine.',
    'Give each imported row a group value. Matching group values can appear anywhere in the sheet.',
    'Mark the order total with total on both sides, then review photos, quantities and amounts before importing.',
  ])
    steps.append(el('li', m(text)))
  workflow.append(steps)
  start.append(filenames, workflow)
  start.append(
    section(
      'Use the exact English markers',
      'Only the markers listed here are imported. Old pinyin names and alternate spellings must be replaced in your workbook. amount checks one product row; the two total markers check the complete order.'
    )
  )

  const markers = makePanel('Import markers'),
    table = el('table', undefined, 'store-import-marker-table'),
    heading = el('tr'),
    thead = el('thead'),
    tbody = el('tbody')
  markers.append(
    el(
      'p',
      m(
        'Click a marker to copy its exact spelling. Markers stay the same in every language.'
      )
    )
  )
  for (const title of ['Marker', 'Meaning and requirement']) {
    const cell = el('th', m(title))
    cell.scope = 'col'
    heading.append(cell)
  }
  thead.append(heading)
  for (const [values, title, description] of markerRows) {
    const row = el('tr'),
      tokens = el('td', undefined, 'store-import-marker-values'),
      detail = el('td')
    tokens.append(...values.map((value) => copyToken(value)))
    detail.append(el('strong', m(title)), el('span', m(description)))
    row.append(tokens, detail)
    tbody.append(row)
  }
  table.append(thead, tbody)
  markers.append(table)
  const total = el('p', undefined, 'store-import-total-example')
  total.append(copyToken('total'), el('code', '500.00'), copyToken('total'))
  markers.append(total)

  const review = makePanel('Review rules')
  review.append(
    section(
      'Check quantities and prices',
      'When both quantities are supplied, boxes × perbox must equal qty. Each product amount must equal unit price × total quantity, and the sum must match the total between the two total markers. Mismatches must pause import and identify the affected cells; values are never silently corrected.'
    ),
    section(
      'Read numbers without their units',
      'Values such as 6元, 8RMB, 20.5 K.G. and 0.14 CBM describe numbers with units. Ambiguous values must be reviewed instead of guessed. Weight and volume always describe one carton.'
    ),
    section(
      'Keep carton measurements separate',
      'cbm is a decimal volume in cubic metres, not text such as 58*35*47. Put centimetre dimensions in cbmx, cbmy and cbmz. Their volume is length × width × height ÷ 1,000,000 per carton; it takes priority over the supplied decimal volume.'
    ),
    section(
      'Keep combined variants together until review',
      'A row marked abcd contains one combined quantity and amount for A, B, C and D. Review must ask for the actual split; it must never duplicate the totals or assume equal quantities. abs, abm and abl mean variants A and B together in sizes S, M and L respectively.'
    ),
    section(
      'Review photos before importing',
      'Every imported product needs a photo. Missing or uncertain row links must pause import. Shared group photos and multiple photos require review. Square thumbnails must fit without stretching, and any later photo adjustment must retain the original.'
    ),
    section(
      'Keep packing exceptions explicit',
      'Keep the ordered quantity separate from the actual carton allocation. Do not turn loose units into fractional cartons or silently combine them with another group. Mixed cartons and unequal carton contents need a reviewed physical packing record. Additional order charges must be entered separately and explained.'
    ),
    section(
      'Confirm the purchase date',
      'Review must require a confirmed purchase date when the workbook has no reliable date. The filename identifies the store, not the purchase date.'
    )
  )
  select(controls[0].tab)
  root.append(intro, tabs, panels)
  host.append(root)
  return { root, focus: () => controls[0].tab.focus() }
}

export function openStoreSpreadsheetGuide() {
  const dialog = el('dialog', undefined, 'store-import-guide'),
    header = el('header', undefined, 'store-import-guide-heading'),
    title = el('h2', m('Store spreadsheet guide')),
    close = decorateIcon(el('button', m('Close spreadsheet guide')), 'close', {
      iconOnly: true,
    })
  title.id = `store-import-guide-title-${crypto.randomUUID()}`
  dialog.setAttribute('aria-labelledby', title.id)
  close.type = 'button'
  close.addEventListener('click', () => dialog.close())
  header.append(title, close)
  dialog.append(header)
  const content = mountStoreSpreadsheetGuide(dialog)
  dialog.addEventListener('close', () => dialog.remove(), { once: true })
  document.body.append(dialog)
  dialog.showModal()
  content.focus()
  return dialog
}
