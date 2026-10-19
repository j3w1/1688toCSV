// Deterministic A4 layout for labels and carton marks, shared by the preview
// and the PDF. Everything here is pure: quantities in, page drawings out. All
// lengths are millimetres from the top-left corner of the page.

export const A4 = Object.freeze({ widthMm: 210, heightMm: 297 })
/** Content closer than this to a paper edge may not print. */
export const SAFE_EDGE_MM = 4
/** Extras above this share of the requested total are worth a warning. */
export const EXCESS_RATIO = 0.25
export const OFFSET_LIMIT_MM = 5
export const SPARE_MODES = Object.freeze(['proportional', 'equal', 'blank'])

export const DEFAULT_PRESET = Object.freeze({
  id: 'a4-5',
  name: 'A4 · 5 mm',
  marginMm: 5,
  offsetXMm: 0,
  offsetYMm: 0,
})

export const DEFAULT_LABEL_LAYOUT = Object.freeze({
  preset: DEFAULT_PRESET.id,
  marginMm: DEFAULT_PRESET.marginMm,
  offsetXMm: 0,
  offsetYMm: 0,
  gapXMm: 0,
  gapYMm: 0,
  spares: 'proportional',
  guides: true,
  boundaries: false,
  pageSummary: true,
  limitExtras: false,
})

export const DEFAULT_MARK_LAYOUT = Object.freeze({
  preset: DEFAULT_PRESET.id,
  marginMm: DEFAULT_PRESET.marginMm,
  offsetXMm: 0,
  offsetYMm: 0,
  numbering: true,
  fillExtra: false,
  guides: true,
  pageSummary: true,
})

function number(value, fallback, minimum, maximum) {
  const parsed = Number(value)
  return Number.isFinite(parsed)
    ? Math.min(maximum, Math.max(minimum, parsed))
    : fallback
}
const tenth = (value) => Math.round(value * 10) / 10
const offset = (value) =>
  tenth(number(value, 0, -OFFSET_LIMIT_MM, OFFSET_LIMIT_MM))
const presetId = (value) =>
  typeof value === 'string' && value.length <= 64 ? value : DEFAULT_PRESET.id

/** Bounded label settings; unknown or out-of-range values fall back. */
export function normalizeLabelLayout(input = {}) {
  const base = DEFAULT_LABEL_LAYOUT
  return {
    preset: presetId(input.preset),
    marginMm: tenth(number(input.marginMm, base.marginMm, 0, 30)),
    offsetXMm: offset(input.offsetXMm),
    offsetYMm: offset(input.offsetYMm),
    gapXMm: tenth(number(input.gapXMm, base.gapXMm, 0, 20)),
    gapYMm: tenth(number(input.gapYMm, base.gapYMm, 0, 20)),
    spares: SPARE_MODES.includes(input.spares) ? input.spares : base.spares,
    guides: input.guides !== false,
    boundaries: input.boundaries === true,
    pageSummary: input.pageSummary !== false,
    limitExtras: input.limitExtras === true,
  }
}

/** Bounded carton-mark settings. The margin is the safe inner margin of each half. */
export function normalizeMarkLayout(input = {}) {
  const base = DEFAULT_MARK_LAYOUT
  return {
    preset: presetId(input.preset),
    marginMm: tenth(number(input.marginMm, base.marginMm, 0, 30)),
    offsetXMm: offset(input.offsetXMm),
    offsetYMm: offset(input.offsetYMm),
    numbering: input.numbering !== false,
    fillExtra: input.fillExtra === true,
    guides: input.guides !== false,
    pageSummary: input.pageSummary !== false,
  }
}

function fit(available, size, gap) {
  return size > available + 1e-9
    ? 0
    : Math.floor((available + gap + 1e-9) / (size + gap))
}

function centredGrid(layout, widthMm, heightMm) {
  const availableX = A4.widthMm - 2 * layout.marginMm
  const availableY = A4.heightMm - 2 * layout.marginMm
  const columns = fit(availableX, widthMm, layout.gapXMm)
  const rows = fit(availableY, heightMm, layout.gapYMm)
  const usedX = columns * widthMm + Math.max(0, columns - 1) * layout.gapXMm
  const usedY = rows * heightMm + Math.max(0, rows - 1) * layout.gapYMm
  return {
    columns,
    rows,
    // Centre the grid so opposite cut margins are equal.
    originXMm: layout.marginMm + (availableX - usedX) / 2,
    originYMm: layout.marginMm + (availableY - usedY) / 2,
    pitchXMm: widthMm + layout.gapXMm,
    pitchYMm: heightMm + layout.gapYMm,
  }
}

/**
 * The label grid for one A4 page, before printer offsets. Labels turn 90°
 * only when that fits strictly more per page; on a tie they stay upright.
 */
export function labelGrid(layoutInput, label) {
  const layout = normalizeLabelLayout(layoutInput)
  const widthMm = Number(label?.widthMm)
  const heightMm = Number(label?.heightMm)
  if (!(widthMm > 0 && heightMm > 0))
    throw new Error('Label size must be greater than zero')
  const upright = centredGrid(layout, widthMm, heightMm)
  const turned = centredGrid(layout, heightMm, widthMm)
  const count = (grid) => grid.columns * grid.rows
  const rotated = count(turned) > count(upright)
  const grid = rotated ? turned : upright
  const cellWidthMm = rotated ? heightMm : widthMm
  const cellHeightMm = rotated ? widthMm : heightMm
  const cells = []
  for (let row = 0; row < grid.rows; row++)
    for (let column = 0; column < grid.columns; column++)
      cells.push({
        row,
        column,
        xMm: grid.originXMm + column * grid.pitchXMm,
        yMm: grid.originYMm + row * grid.pitchYMm,
        widthMm: cellWidthMm,
        heightMm: cellHeightMm,
      })
  return {
    columns: grid.columns,
    rows: grid.rows,
    perPage: grid.columns * grid.rows,
    rotated,
    labelWidthMm: widthMm,
    labelHeightMm: heightMm,
    cellWidthMm,
    cellHeightMm,
    cells,
  }
}

function wholeQuantity(value) {
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}
function optionalCap(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

/** Whole shares of `amount` by weight; ties go to the larger request, then the earlier item. */
function largestRemainder(amount, rows) {
  const total = rows.reduce((sum, row) => sum + row.weight, 0)
  const exact = rows.map((row) =>
    total > 0 ? (amount * row.weight) / total : 0
  )
  const shares = exact.map((value) => Math.floor(value + 1e-9))
  let left = amount - shares.reduce((sum, value) => sum + value, 0)
  const order = rows
    .map((row, index) => ({
      index,
      remainder: exact[index] - shares[index],
      row,
    }))
    .sort(
      (a, b) =>
        b.remainder - a.remainder ||
        b.row.requested - a.row.requested ||
        a.index - b.index
    )
  for (
    let position = 0;
    left > 0 && order.length;
    position = (position + 1) % order.length
  ) {
    shares[order[position].index]++
    left--
  }
  return shares
}

/**
 * Share `spare` places among items. Proportional weighs by requested quantity,
 * equal weighs every product the same and blank adds nothing. A product with a
 * cap never receives more than `cap` extras; what it cannot take is re-shared
 * among the others, and places no product can take stay blank.
 */
export function allocateSpares(items, spare, mode = 'proportional') {
  const shares = items.map(() => 0)
  if (!items.length || spare <= 0 || mode === 'blank') return shares
  let left = spare
  let active = items
    .map((item, index) => ({
      index,
      requested: item.requested,
      cap: optionalCap(item.cap),
      weight: mode === 'equal' ? 1 : item.requested,
    }))
    .filter((row) => row.cap !== 0 && row.weight > 0)
  while (left > 0 && active.length) {
    const offered = largestRemainder(left, active)
    let given = 0
    let clamped = false
    for (const [position, row] of active.entries()) {
      const room = row.cap === null ? Infinity : row.cap - shares[row.index]
      const take = Math.min(offered[position], room)
      if (take < offered[position]) clamped = true
      shares[row.index] += take
      given += take
    }
    left -= given
    if (!clamped) break
    active = active.filter(
      (row) => row.cap === null || shares[row.index] < row.cap
    )
  }
  return shares
}

/** Runs of consecutive equal keys on each page: [{ key, count }]. */
function pageRuns(sequence, perPage, pages) {
  const result = []
  for (let page = 0; page < pages; page++) {
    const runs = []
    for (const key of sequence.slice(page * perPage, (page + 1) * perPage)) {
      if (!key) continue
      const last = runs.at(-1)
      if (last?.key === key) last.count++
      else runs.push({ key, count: 1 })
    }
    result.push(runs)
  }
  return result
}

/**
 * Final label counts and their placement. Requested quantities are always
 * printed on the minimum number of pages, each product as one contiguous run
 * in the selected order; spare places on the last page are shared by mode.
 */
export function planLabels(itemsInput, grid, layoutInput = {}) {
  const layout = normalizeLabelLayout(layoutInput)
  const items = itemsInput
    .map((item) => ({
      key: item.key,
      requested: wholeQuantity(item.quantity),
      cap: optionalCap(item.cap),
    }))
    .filter((item) => item.requested > 0)
  const perPage = grid.perPage
  const requested = items.reduce((sum, item) => sum + item.requested, 0)
  if (!items.length || !perPage)
    return {
      pages: 0,
      perPage,
      requested,
      extras: 0,
      blanks: 0,
      items: [],
      sequence: [],
      pageSummaries: [],
      excess: null,
    }
  const pages = Math.ceil(requested / perPage)
  const spare = pages * perPage - requested
  const extra = allocateSpares(items, spare, layout.spares)
  const rows = items.map((item, index) => ({
    key: item.key,
    requested: item.requested,
    cap: item.cap,
    extra: extra[index],
    total: item.requested + extra[index],
  }))
  const sequence = rows.flatMap((row) =>
    Array.from({ length: row.total }, () => row.key)
  )
  while (sequence.length < pages * perPage) sequence.push(null)
  const extras = extra.reduce((sum, value) => sum + value, 0)
  return {
    pages,
    perPage,
    requested,
    extras,
    blanks: spare - extras,
    items: rows,
    sequence,
    pageSummaries: pageRuns(sequence, perPage, pages),
    excess:
      extras > EXCESS_RATIO * requested
        ? { extras, requested, percent: Math.round((extras / requested) * 100) }
        : null,
  }
}

/**
 * Carton marks: two halves per A4 page in selected order. An odd total leaves
 * the last half blank unless `fillExtra` adds one more copy of the last mark.
 * `known` is the carton count recorded for the product, when there is one.
 */
export function planCartonMarks(itemsInput, layoutInput = {}) {
  const { fillExtra } = normalizeMarkLayout(layoutInput)
  const all = itemsInput.map((item) => ({
    key: item.key,
    requested: wholeQuantity(item.quantity),
    known:
      item.known === undefined || item.known === null
        ? null
        : wholeQuantity(item.known),
  }))
  const items = all.filter((item) => item.requested > 0)
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
  const pages = sequence.length / 2
  return {
    pages,
    sequence,
    items: items.map((item) => ({
      key: item.key,
      requested: item.requested,
      known: item.known,
      total: item.requested + (item.key === extraKey ? 1 : 0),
    })),
    mismatches: all
      .filter((item) => item.known !== null && item.requested !== item.known)
      .map(({ key, requested, known }) => ({ key, requested, known })),
    blankHalf: odd && !extraKey,
    pageSummaries: pageRuns(
      sequence.map((entry) => entry?.key ?? null),
      2,
      pages
    ),
  }
}

/** Two A4 halves, each holding one mark centred inside the safe margin. */
export function cartonSlots(mark, layoutInput = {}) {
  const { marginMm } = normalizeMarkLayout(layoutInput)
  const half = A4.heightMm / 2
  const widthMm = Number(mark?.widthMm)
  const heightMm = Number(mark?.heightMm)
  const fits = (w, h) =>
    w <= A4.widthMm - 2 * marginMm + 1e-9 && h <= half - 2 * marginMm + 1e-9
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

// ---------------------------------------------------------------- drawings
// A page is a list of drawing operations: image, line, circle and text. The
// preview canvas and the PDF writer both draw exactly these operations.

// Guides help cutting; they are clipped to the printable area and never
// count as content. Dash lengths are millimetres, like every other length.
const GUIDE = Object.freeze({
  gray: 0.82,
  widthPt: 0.2,
  dash: [0.6, 1.6],
  guide: true,
})
const CROP = Object.freeze({ gray: 0.6, widthPt: 0.25, guide: true })
const SAFE = Object.freeze({
  left: SAFE_EDGE_MM,
  top: SAFE_EDGE_MM,
  right: A4.widthMm - SAFE_EDGE_MM,
  bottom: A4.heightMm - SAFE_EDGE_MM,
})
const BOUNDARY = Object.freeze({ gray: 0.35, widthPt: 0.6 })
const CAPTION_PT = 5
const MM_PER_PT = 25.4 / 72
const MM_PER_CAPTION_CHAR = CAPTION_PT * 0.5 * MM_PER_PT
// Helvetica proportions: about half an em per character, cap height 0.72 em
// and descenders 0.22 em. Used to keep text inside the printable area.
const textBox = (op) => {
  const width = String(op.value).length * op.size * 0.5 * MM_PER_PT
  const above = op.size * 0.72 * MM_PER_PT
  const below = op.size * 0.22 * MM_PER_PT
  const left =
    op.align === 'center'
      ? op.x - width / 2
      : op.align === 'right'
        ? op.x - width
        : op.x
  return {
    xMm: left,
    yMm: op.y - above,
    widthMm: width,
    heightMm: above + below,
  }
}
/** The caption baseline inside the free band below `bottomMm`, or null when it does not fit. */
function captionBaseline(bottomMm, offsetYMm) {
  const free = A4.heightMm - bottomMm - offsetYMm
  if (free < SAFE_EDGE_MM) return null
  const above = CAPTION_PT * 0.72 * MM_PER_PT
  const below = CAPTION_PT * 0.22 * MM_PER_PT
  const lowest = SAFE.bottom - below - offsetYMm
  const centred =
    bottomMm + (SAFE.bottom - offsetYMm - bottomMm) / 2 + above / 2
  const baseline = Math.min(lowest, centred)
  return baseline - above >= bottomMm + 0.8 ? baseline : null
}

/** Clip a guide segment to the printable area (Liang-Barsky); null when nothing remains. */
function clipGuide(op) {
  if (op.type === 'circle')
    return op.x - op.r >= SAFE.left &&
      op.x + op.r <= SAFE.right &&
      op.y - op.r >= SAFE.top &&
      op.y + op.r <= SAFE.bottom
      ? op
      : null
  const dx = op.x2 - op.x1
  const dy = op.y2 - op.y1
  let start = 0
  let end = 1
  for (const [p, q] of [
    [-dx, op.x1 - SAFE.left],
    [dx, SAFE.right - op.x1],
    [-dy, op.y1 - SAFE.top],
    [dy, SAFE.bottom - op.y1],
  ]) {
    if (Math.abs(p) < 1e-12) {
      if (q < -1e-9) return null
      continue
    }
    const t = q / p
    if (p < 0) start = Math.max(start, t)
    else end = Math.min(end, t)
  }
  if (end - start <= 1e-9 || Math.hypot(dx, dy) * (end - start) < 0.3)
    return null
  return {
    ...op,
    x1: op.x1 + start * dx,
    y1: op.y1 + start * dy,
    x2: op.x1 + end * dx,
    y2: op.y1 + end * dy,
  }
}
const finish = (ops, layout) =>
  shifted(ops, layout.offsetXMm, layout.offsetYMm)
    .map((op) => (op.guide ? clipGuide(op) : op))
    .filter(Boolean)

function shifted(ops, dx, dy) {
  if (!dx && !dy) return ops
  return ops.map((op) => {
    if (op.type === 'image')
      return {
        ...op,
        box: { ...op.box, xMm: op.box.xMm + dx, yMm: op.box.yMm + dy },
      }
    if (op.type === 'line')
      return {
        ...op,
        x1: op.x1 + dx,
        y1: op.y1 + dy,
        x2: op.x2 + dx,
        y2: op.y2 + dy,
      }
    return { ...op, x: op.x + dx, y: op.y + dy }
  })
}

const line = (x1, y1, x2, y2, style) => ({
  type: 'line',
  x1,
  y1,
  x2,
  y2,
  ...style,
})
const text = (value, x, y, style) => ({ type: 'text', value, x, y, ...style })

function bounds(boxes) {
  return {
    left: Math.min(...boxes.map((box) => box.xMm)),
    top: Math.min(...boxes.map((box) => box.yMm)),
    right: Math.max(...boxes.map((box) => box.xMm + box.widthMm)),
    bottom: Math.max(...boxes.map((box) => box.yMm + box.heightMm)),
  }
}

/** The smallest distance from printed content to a paper edge, after offsets. */
export function edgeClearance(boxes, { offsetXMm = 0, offsetYMm = 0 } = {}) {
  if (!boxes.length) return Infinity
  const area = bounds(boxes)
  return Math.min(
    area.left + offsetXMm,
    area.top + offsetYMm,
    A4.widthMm - area.right - offsetXMm,
    A4.heightMm - area.bottom - offsetYMm
  )
}

/** One caption line that fits the page width; products beyond it are counted. */
export function pageCaption(
  prefix,
  runs,
  suffix,
  { widthMm = A4.widthMm - 16 } = {}
) {
  const limit = Math.floor(widthMm / MM_PER_CAPTION_CHAR)
  const parts = runs.map((run) => `${run.key} x${run.count}`)
  const join = (shown) => {
    const more = parts.length - shown.length
    return [prefix, ...shown, ...(more ? [`+${more} more`] : []), suffix]
      .filter(Boolean)
      .join(' - ')
  }
  let shown = parts
  while (shown.length && join(shown).length > limit) shown = shown.slice(0, -1)
  return join(shown)
}

function cutGuides(cells) {
  const ops = []
  const xs = [...new Set(cells.flatMap((c) => [c.xMm, c.xMm + c.widthMm]))]
  const ys = [...new Set(cells.flatMap((c) => [c.yMm, c.yMm + c.heightMm]))]
  const area = bounds(cells)
  for (const x of xs) {
    ops.push(line(x, area.top, x, area.bottom, GUIDE))
    if (area.top > 2)
      ops.push(line(x, Math.max(0.5, area.top - 4), x, area.top - 1, CROP))
    if (A4.heightMm - area.bottom > 2)
      ops.push(
        line(
          x,
          area.bottom + 1,
          x,
          Math.min(A4.heightMm - 0.5, area.bottom + 4),
          CROP
        )
      )
  }
  for (const y of ys) {
    ops.push(line(area.left, y, area.right, y, GUIDE))
    if (area.left > 2)
      ops.push(line(Math.max(0.5, area.left - 4), y, area.left - 1, y, CROP))
    if (A4.widthMm - area.right > 2)
      ops.push(
        line(
          area.right + 1,
          y,
          Math.min(A4.widthMm - 0.5, area.right + 4),
          y,
          CROP
        )
      )
  }
  return ops
}

/** Solid edges between neighbouring cells that hold different products. */
function productBoundaries(grid, keys) {
  const ops = []
  const at = (row, column) =>
    row < grid.rows && column < grid.columns
      ? keys[row * grid.columns + column]
      : undefined
  for (const cell of grid.cells) {
    const key = at(cell.row, cell.column)
    const right = at(cell.row, cell.column + 1)
    const below = at(cell.row + 1, cell.column)
    if (right !== undefined && right !== key && (key || right))
      ops.push(
        line(
          cell.xMm + cell.widthMm,
          cell.yMm,
          cell.xMm + cell.widthMm,
          cell.yMm + cell.heightMm,
          BOUNDARY
        )
      )
    if (below !== undefined && below !== key && (key || below))
      ops.push(
        line(
          cell.xMm,
          cell.yMm + cell.heightMm,
          cell.xMm + cell.widthMm,
          cell.yMm + cell.heightMm,
          BOUNDARY
        )
      )
  }
  return ops
}

/** Every operation for label page `page` (0-based), offsets applied. */
export function labelPageOps({ plan, grid, layout: layoutInput, page }) {
  const layout = normalizeLabelLayout(layoutInput)
  const keys = plan.sequence.slice(
    page * grid.perPage,
    (page + 1) * grid.perPage
  )
  const ops = []
  for (const [index, key] of keys.entries())
    if (key)
      ops.push({
        type: 'image',
        key,
        box: grid.cells[index],
        rotate: grid.rotated,
      })
  if (layout.guides && grid.cells.length) ops.push(...cutGuides(grid.cells))
  if (layout.boundaries) ops.push(...productBoundaries(grid, keys))
  const area = grid.cells.length ? bounds(grid.cells) : null
  const baseline = area ? captionBaseline(area.bottom, layout.offsetYMm) : null
  if (layout.pageSummary && baseline !== null)
    ops.push(
      text(
        pageCaption(
          `CE labels - page ${page + 1} of ${plan.pages}`,
          plan.pageSummaries[page] || [],
          'print at 100% (Actual size)'
        ),
        A4.widthMm / 2,
        baseline,
        { size: CAPTION_PT, gray: 0.5, align: 'center' }
      )
    )
  return finish(ops, layout)
}

/** Every operation for carton-mark page `page` (0-based), offsets applied. */
export function markPageOps({ plan, slots, layout: layoutInput, page }) {
  const layout = normalizeMarkLayout(layoutInput)
  const ops = []
  const entries = plan.sequence.slice(page * 2, page * 2 + 2)
  for (const [index, entry] of entries.entries()) {
    if (!entry) continue
    const slot = slots.slots[index]
    ops.push({
      type: 'image',
      key: entry.key,
      box: slot,
      rotate: slots.rotated,
    })
    if (layout.numbering && entry.number)
      ops.push(
        text(
          `Carton ${entry.number} of ${entry.of}`,
          A4.widthMm / 2,
          Math.min(
            slot.yMm + slot.heightMm + 5,
            (index + 1) * slots.cutYMm - SAFE_EDGE_MM - 1
          ),
          { size: 7, gray: 0.4, align: 'center' }
        )
      )
  }
  if (layout.guides) {
    const y = slots.cutYMm
    ops.push(
      { type: 'circle', x: 6, y: y - 1.3, r: 0.9, gray: 0.5, guide: true },
      { type: 'circle', x: 6, y: y + 1.3, r: 0.9, gray: 0.5, guide: true },
      line(6.8, y - 0.9, 11.3, y + 0.6, CROP),
      line(6.8, y + 0.9, 11.3, y - 0.6, CROP),
      line(12.8, y, A4.widthMm - SAFE_EDGE_MM, y, {
        gray: 0.6,
        widthPt: 0.3,
        dash: [2, 1.5],
        guide: true,
      })
    )
  }
  const lowest = slots.slots[1]
  const baseline = captionBaseline(
    Math.max(lowest.yMm + lowest.heightMm, A4.heightMm - 12),
    layout.offsetYMm
  )
  if (layout.pageSummary && baseline !== null)
    ops.push(
      text(
        pageCaption(
          `CE carton marks - page ${page + 1} of ${plan.pages}`,
          plan.pageSummaries[page] || [],
          'print at 100% (Actual size)'
        ),
        A4.widthMm / 2,
        baseline,
        { size: CAPTION_PT, gray: 0.5, align: 'center' }
      )
    )
  return finish(ops, layout)
}

function ruler(ops, { x, y, lengthMm, vertical }) {
  const style = { gray: 0.15, widthPt: 0.3 }
  if (vertical) ops.push(line(x, y, x, y + lengthMm, style))
  else ops.push(line(x, y, x + lengthMm, y, style))
  for (let mm = 0; mm <= lengthMm; mm++) {
    const size = mm % 10 === 0 ? 4 : mm % 5 === 0 ? 2.5 : 1.5
    if (vertical) ops.push(line(x, y + mm, x + size, y + mm, style))
    else ops.push(line(x + mm, y, x + mm, y - size, style))
    if (mm % 10 === 0 && lengthMm > 10)
      ops.push(
        vertical
          ? text(String(mm), x + 5, y + mm + 1, { size: 6, gray: 0.3 })
          : text(String(mm), x + mm, y - 5, {
              size: 6,
              gray: 0.3,
              align: 'center',
            })
      )
  }
}

function cross(ops, x, y) {
  const style = { gray: 0.1, widthPt: 0.3 }
  ops.push(line(x - 4, y, x + 4, y, style), line(x, y - 4, x, y + 4, style))
}

const signed = (value) =>
  `${value >= 0 ? '+' : '-'}${Math.abs(value).toFixed(1)}`

/** A one-page calibration sheet: 10 mm and 100 mm rulers on both axes and two reference crosses. */
export function calibrationOps(layoutInput = {}, { presetName = '' } = {}) {
  const layout = normalizeLabelLayout(layoutInput)
  const ops = []
  const say = (value, y, style = {}) =>
    ops.push(text(value, 30, y, { size: 8, gray: 0.15, ...style }))
  say('CE print calibration', 34, { size: 12, gray: 0 })
  say(
    'Print this page at 100% (Actual size), with no "fit to page" scaling.',
    41
  )
  say(
    '1. Each long ruler must measure exactly 100 mm and each short ruler 10 mm.',
    47
  )
  say(
    '   If not, the printer is scaling: choose Actual size or 100% and print again.',
    52
  )
  say(
    '2. Measure from the left paper edge to the vertical line of the top-left cross:',
    58
  )
  say(
    '   it should be 20 mm. Offset X = 20 minus what you measure (21 mm -> X -1.0).',
    63
  )
  say(
    '3. Measure from the top paper edge to its horizontal line: it should be 20 mm.',
    69
  )
  say(
    '   Offset Y = 20 minus what you measure. Save the offsets as a preset.',
    74
  )
  say(
    `Offsets on this sheet: X ${signed(layout.offsetXMm)} mm, Y ${signed(layout.offsetYMm)} mm${presetName ? ` - preset ${presetName}` : ''}`,
    82,
    { gray: 0.3 }
  )
  cross(ops, 20, 20)
  ops.push(text('20 mm from left and top', 25, 18, { size: 6, gray: 0.3 }))
  cross(ops, A4.widthMm - 20, A4.heightMm - 20)
  ops.push(
    text('20 mm from right and bottom', A4.widthMm - 25, A4.heightMm - 22, {
      size: 6,
      gray: 0.3,
      align: 'right',
    })
  )
  ops.push(text('100 mm', 105, 112, { size: 7, gray: 0.3, align: 'center' }))
  ruler(ops, { x: 55, y: 125, lengthMm: 100, vertical: false })
  ops.push(text('100 mm', 40, 145, { size: 7, gray: 0.3, align: 'right' }))
  ruler(ops, { x: 45, y: 140, lengthMm: 100, vertical: true })
  ops.push(text('10 mm', 120, 160, { size: 7, gray: 0.3, align: 'center' }))
  ruler(ops, { x: 115, y: 170, lengthMm: 10, vertical: false })
  ops.push(text('10 mm', 140, 185, { size: 7, gray: 0.3 }))
  ruler(ops, { x: 135, y: 180, lengthMm: 10, vertical: true })
  return shifted(ops, layout.offsetXMm, layout.offsetYMm)
}

/** Every printed box except guides: labels, marks, text and drawn rulers. */
export const contentBoxes = (ops) =>
  ops
    .filter((op) => !op.guide)
    .map((op) =>
      op.type === 'image'
        ? op.box
        : op.type === 'text'
          ? textBox(op)
          : op.type === 'circle'
            ? {
                xMm: op.x - op.r,
                yMm: op.y - op.r,
                widthMm: 2 * op.r,
                heightMm: 2 * op.r,
              }
            : {
                xMm: Math.min(op.x1, op.x2),
                yMm: Math.min(op.y1, op.y2),
                widthMm: Math.abs(op.x2 - op.x1),
                heightMm: Math.abs(op.y2 - op.y1),
              }
    )

/**
 * Draw operations on a page API with image(source, box, options), line, circle
 * and text: the PDF page and the preview canvas implement the same calls.
 */
export function drawOps(target, ops, imageFor) {
  for (const op of ops) {
    if (op.type === 'image')
      target.image(imageFor(op.key), op.box, { rotate: op.rotate })
    else if (op.type === 'line')
      target.line(op.x1, op.y1, op.x2, op.y2, {
        gray: op.gray,
        widthPt: op.widthPt,
        dash: op.dash ?? null,
      })
    else if (op.type === 'circle')
      target.circle(op.x, op.y, op.r, { gray: op.gray, widthPt: op.widthPt })
    else
      target.text(op.value, op.x, op.y, {
        size: op.size,
        gray: op.gray,
        align: op.align,
      })
  }
  return target
}
