// Pure A4 print layout for labels and carton marks. All lengths are millimetres,
// measured from the top-left corner of the page.

export const A4 = Object.freeze({ widthMm: 210, heightMm: 297 })

export const DEFAULT_PRINT_LAYOUT = Object.freeze({
  sheet: 'plain',
  marginMm: 5,
  gapXMm: 0,
  gapYMm: 0,
  rotate: 'auto',
  spares: 'equal',
  newRow: false,
  guides: true,
  dpi: 300,
  precut: Object.freeze({
    columns: 5,
    rows: 13,
    offsetXMm: 5,
    offsetYMm: 10.7,
    pitchXMm: 40,
    pitchYMm: 21.2,
  }),
})

const SPARE_MODES = ['equal', 'proportional', 'blank']

function number(value, fallback, minimum, maximum) {
  const parsed = Number(value)
  return Number.isFinite(parsed)
    ? Math.min(maximum, Math.max(minimum, parsed))
    : fallback
}

/** Bounded settings; unknown or out-of-range values fall back to defaults. */
export function normalizePrintLayout(input = {}) {
  const base = DEFAULT_PRINT_LAYOUT
  const precut = input.precut || {}
  return {
    sheet: input.sheet === 'precut' ? 'precut' : 'plain',
    marginMm: number(input.marginMm, base.marginMm, 0, 30),
    gapXMm: number(input.gapXMm, base.gapXMm, 0, 20),
    gapYMm: number(input.gapYMm, base.gapYMm, 0, 20),
    rotate: [true, false, 'auto'].includes(input.rotate)
      ? input.rotate
      : base.rotate,
    spares: SPARE_MODES.includes(input.spares) ? input.spares : base.spares,
    newRow: input.newRow === true,
    guides: input.guides !== false,
    dpi: input.dpi === 600 ? 600 : 300,
    precut: {
      columns: Math.round(number(precut.columns, base.precut.columns, 1, 30)),
      rows: Math.round(number(precut.rows, base.precut.rows, 1, 60)),
      offsetXMm: number(precut.offsetXMm, base.precut.offsetXMm, 0, 100),
      offsetYMm: number(precut.offsetYMm, base.precut.offsetYMm, 0, 150),
      pitchXMm: number(precut.pitchXMm, base.precut.pitchXMm, 5, 210),
      pitchYMm: number(precut.pitchYMm, base.precut.pitchYMm, 5, 297),
    },
  }
}

function fit(available, size, gap) {
  return size > available
    ? 0
    : Math.floor((available + gap + 1e-9) / (size + gap))
}

function plainGrid(layout, widthMm, heightMm) {
  const availableX = A4.widthMm - 2 * layout.marginMm
  const availableY = A4.heightMm - 2 * layout.marginMm
  const columns = fit(availableX, widthMm, layout.gapXMm)
  const rows = fit(availableY, heightMm, layout.gapYMm)
  const usedX = columns * widthMm + Math.max(0, columns - 1) * layout.gapXMm
  const usedY = rows * heightMm + Math.max(0, rows - 1) * layout.gapYMm
  return {
    columns,
    rows,
    // Centre the grid so both cut margins are equal.
    originXMm: layout.marginMm + (availableX - usedX) / 2,
    originYMm: layout.marginMm + (availableY - usedY) / 2,
    pitchXMm: widthMm + layout.gapXMm,
    pitchYMm: heightMm + layout.gapYMm,
  }
}

/**
 * The label grid for one A4 page. Plain paper fits as many labels as the
 * margins and gaps allow, turning them 90° when that fits more. A pre-cut
 * sheet uses its printed first-label offset and pitch.
 */
export function labelGrid(layoutInput, label) {
  const layout = normalizePrintLayout(layoutInput)
  const widthMm = Number(label?.widthMm)
  const heightMm = Number(label?.heightMm)
  if (!(widthMm > 0 && heightMm > 0))
    throw new Error('Label size must be greater than zero')
  let grid
  let rotated = false
  if (layout.sheet === 'precut') {
    const { columns, rows, offsetXMm, offsetYMm, pitchXMm, pitchYMm } =
      layout.precut
    grid = {
      columns,
      rows,
      originXMm: offsetXMm,
      originYMm: offsetYMm,
      pitchXMm,
      pitchYMm,
    }
    const right = offsetXMm + (columns - 1) * pitchXMm + widthMm
    const bottom = offsetYMm + (rows - 1) * pitchYMm + heightMm
    if (right > A4.widthMm + 0.01 || bottom > A4.heightMm + 0.01)
      throw new Error('The pre-cut sheet layout does not fit on A4')
    if (pitchXMm + 0.01 < widthMm || pitchYMm + 0.01 < heightMm)
      throw new Error('The sheet pitch is smaller than the label')
  } else {
    const upright = plainGrid(layout, widthMm, heightMm)
    const turned = plainGrid(layout, heightMm, widthMm)
    const count = (entry) => entry.columns * entry.rows
    rotated =
      layout.rotate === true ||
      (layout.rotate === 'auto' && count(turned) > count(upright))
    grid = rotated ? turned : upright
  }
  const cellWidth = rotated ? heightMm : widthMm
  const cellHeight = rotated ? widthMm : heightMm
  const cells = []
  for (let row = 0; row < grid.rows; row++)
    for (let column = 0; column < grid.columns; column++)
      cells.push({
        xMm: grid.originXMm + column * grid.pitchXMm,
        yMm: grid.originYMm + row * grid.pitchYMm,
        widthMm: cellWidth,
        heightMm: cellHeight,
      })
  return {
    sheet: layout.sheet,
    columns: grid.columns,
    rows: grid.rows,
    perPage: grid.columns * grid.rows,
    rotated,
    labelWidthMm: widthMm,
    labelHeightMm: heightMm,
    cells,
  }
}

function wholeQuantity(value) {
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

/** Share `spare` units among items by mode, in whole units that add up exactly. */
export function shareSpares(items, spare, mode) {
  const shares = items.map(() => 0)
  if (!items.length || spare <= 0 || mode === 'blank') return shares
  const total = items.reduce((sum, item) => sum + item.weight, 0)
  const exact = items.map((item) =>
    mode === 'proportional' && total > 0
      ? (spare * item.weight) / total
      : spare / items.length
  )
  for (const [index, value] of exact.entries())
    shares[index] = Math.floor(value + 1e-9)
  let left = spare - shares.reduce((sum, value) => sum + value, 0)
  // Largest remainder; ties go to the larger request, then the earlier item.
  const order = items
    .map((item, index) => ({
      index,
      remainder: exact[index] - shares[index],
      weight: item.weight,
    }))
    .sort(
      (a, b) =>
        b.remainder - a.remainder || b.weight - a.weight || a.index - b.index
    )
  for (let position = 0; left > 0; position = (position + 1) % order.length) {
    shares[order[position].index]++
    left--
  }
  return shares
}

/**
 * Final label counts and the order labels are placed on the pages. Every
 * product receives at least its requested quantity; spare places on the last
 * page are filled by mode. With `newRow`, each product starts on a new row,
 * its last row is completed with the same product, and spare whole rows are
 * shared by mode.
 */
export function planLabels(itemsInput, grid, layoutInput = {}) {
  const layout = normalizePrintLayout(layoutInput)
  const items = itemsInput
    .map((item) => ({ key: item.key, requested: wholeQuantity(item.quantity) }))
    .filter((item) => item.requested > 0)
  const perPage = grid.perPage
  if (!items.length || !perPage)
    return { pages: 0, perPage, items: [], sequence: [], spare: 0 }
  let totals
  let sequence
  if (layout.newRow && grid.columns > 1) {
    const columns = grid.columns
    const rows = items.map((item) => Math.ceil(item.requested / columns))
    const usedRows = rows.reduce((sum, value) => sum + value, 0)
    const pages = Math.ceil(usedRows / grid.rows)
    const spareRows = pages * grid.rows - usedRows
    const extraRows = shareSpares(
      items.map((item) => ({ weight: item.requested })),
      spareRows,
      layout.spares
    )
    sequence = []
    totals = items.map((item, index) => {
      const cells = (rows[index] + extraRows[index]) * columns
      const count = layout.spares === 'blank' ? item.requested : cells
      for (let cell = 0; cell < cells; cell++)
        sequence.push(cell < count ? item.key : null)
      return count
    })
    while (sequence.length < pages * perPage) sequence.push(null)
  } else {
    const requested = items.reduce((sum, item) => sum + item.requested, 0)
    const pages = Math.ceil(requested / perPage)
    const spare = pages * perPage - requested
    const extra = shareSpares(
      items.map((item) => ({ weight: item.requested })),
      spare,
      layout.spares
    )
    totals = items.map((item, index) => item.requested + extra[index])
    sequence = items.flatMap((item, index) =>
      Array.from({ length: totals[index] }, () => item.key)
    )
    while (sequence.length < pages * perPage) sequence.push(null)
  }
  const pages = Math.ceil(sequence.length / perPage)
  return {
    pages,
    perPage,
    spare:
      pages * perPage - items.reduce((sum, item) => sum + item.requested, 0),
    items: items.map((item, index) => ({
      key: item.key,
      requested: item.requested,
      spares: totals[index] - item.requested,
      total: totals[index],
    })),
    sequence,
  }
}

/** Carton marks: two halves per A4 page; an odd total leaves the last half blank. */
export function planCartonMarks(itemsInput, { fillExtra = false } = {}) {
  const items = itemsInput
    .map((item) => ({ key: item.key, requested: wholeQuantity(item.quantity) }))
    .filter((item) => item.requested > 0)
  const sequence = items.flatMap((item) =>
    Array.from({ length: item.requested }, (_, index) => ({
      key: item.key,
      number: index + 1,
      of: item.requested,
    }))
  )
  const odd = sequence.length % 2 === 1
  const extraKey = odd && fillExtra ? sequence.at(-1).key : null
  if (odd) sequence.push(extraKey ? { key: extraKey, extra: true } : null)
  return {
    pages: sequence.length / 2,
    sequence,
    items: items.map((item) => ({
      key: item.key,
      requested: item.requested,
      total: item.requested + (item.key === extraKey ? 1 : 0),
    })),
  }
}

/** Two A4 halves, each holding one mark centred inside a safe margin. */
export function cartonSlots(mark, { safeMarginMm = 6 } = {}) {
  const half = A4.heightMm / 2
  const widthMm = Number(mark?.widthMm)
  const heightMm = Number(mark?.heightMm)
  const fits = (w, h) =>
    w <= A4.widthMm - 2 * safeMarginMm && h <= half - 2 * safeMarginMm
  let rotated = false
  if (!fits(widthMm, heightMm)) {
    if (fits(heightMm, widthMm)) rotated = true
    else
      throw new Error(
        'The carton mark is larger than half an A4 page. Reduce its size in Settings → Labels.'
      )
  }
  const w = rotated ? heightMm : widthMm
  const h = rotated ? widthMm : heightMm
  return {
    rotated,
    cutYMm: half,
    slots: [0, half].map((top) => ({
      xMm: (A4.widthMm - w) / 2,
      yMm: top + (half - h) / 2,
      widthMm: w,
      heightMm: h,
    })),
  }
}
