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
    'Optional. Repeat for all descriptions; colors, sizes and materials are recognized even without seller headers.',
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
export function mountStoreSpreadsheetGuide(
  host,
  { initialSection = 'setup' } = {}
) {
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
  const makePanel = (title, key) => {
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
    controls.push({ tab, panel, key })
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

  const start = makePanel('Setup', 'setup')
  const filenames = section(
    'Name the file',
    'Use the store number or factory name as the filename. Copy suffixes keep the same store; each import adds a new order.'
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
    'Keep the original. Add one marker row above the seller’s headers in a copy. Only marked columns are read, in any order.'
  )
  const steps = el('ol')
  for (const text of [
    'Copy markers from the Markers tab. Repeat desc to combine description columns.',
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

  const markers = makePanel('Markers', 'markers'),
    list = el('ul', undefined, 'store-import-marker-list')
  markers.append(
    el(
      'p',
      m(
        'Click a marker to copy its exact spelling. Markers stay the same in every language.'
      )
    )
  )
  for (const [values, title, description] of markerRows) {
    const row = el('li', undefined, 'store-import-marker-card'),
      heading = el('div', undefined, 'store-import-marker-heading'),
      tokens = el('span', undefined, 'store-import-marker-values')
    tokens.append(...values.map((value) => copyToken(value)))
    heading.append(tokens, el('strong', m(title)))
    row.append(heading, el('p', m(description)))
    list.append(row)
  }
  markers.append(list)
  const total = el('p', undefined, 'store-import-total-example')
  total.append(copyToken('total'), el('code', '500.00'), copyToken('total'))
  markers.append(total)

  const review = makePanel('Checks', 'checks')
  review.append(
    section(
      'Check quantities and prices',
      'Check boxes × perbox = qty, price × qty = amount, and the row amounts against total. A mismatch blocks import and names the affected cells; values are never silently corrected.'
    ),
    section(
      'Read numbers without their units',
      'Numbers may include units, such as 6元, 20.5 KG or 0.14 CBM. Ambiguous values need review. kg and cbm always describe one carton.'
    ),
    section(
      'Keep carton measurements separate',
      'cbm is supplier volume per carton. Put complete centimetre dimensions in cbmx, cbmy and cbmz. In the workspace, volume is calculated from Length × Width × Height ÷ 1,000,000; supplied volume stays read-only until dimensions supersede it.'
    ),
    section(
      'Keep combined variants together until review',
      'abcd shares one quantity and amount across A–D. Enter the actual split during review; never duplicate the totals or assume equal quantities. abs, abm and abl mean A/B in sizes S, M and L.'
    ),
    section(
      'Review photos before importing',
      'Every product needs a photo. One photo can serve different groups when its anchor or merged pic cell covers their rows. Confirm shared photos during review. Missing or unreadable photos block import. Square thumbnails keep proportions and originals.'
    ),
    section(
      'Keep packing exceptions explicit',
      'Import once, then review Products and Cartons in Orders. Supported source carton facts are confirmed during import; capacity-only edits remain proposals. Review prefilled remainders and confirm one order when its physical facts are ready. Add extra order costs separately.'
    ),
    section(
      'Choose contents and carton mark',
      'Each carton belongs to one purchase. Products from that purchase may mix, with an independent carton mark even when its group contributes no pieces. Eligible repeat purchases may share reviewed codes across purchase months, but keep separate quantities, prices and cartons. Unequal cartons and aggregate totals never establish a uniform per-box split.'
    ),
    section(
      'Confirm loading in a container',
      'In Packing, include whole orders in a named container and confirm Loaded or Left behind for physical cartons. Product quantities follow those decisions. Seal a revision after review; correct sealed facts through an amendment. Keep per-carton and combined measurements distinct; partial combined totals stay unknown. Receiving and supplier delivery remain separate.'
    ),
    section(
      'Confirm the purchase date',
      'Confirm the purchase date in the form. The filename identifies the store, not the date.'
    )
  )
  const initial =
    controls.find(({ key }) => key === initialSection) || controls[0]
  select(initial.tab)
  root.append(intro, tabs, panels)
  host.append(root)
  return { root, focus: () => initial.tab.focus() }
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
