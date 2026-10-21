import test from 'node:test'
import assert from 'node:assert/strict'
import {
  drawPhotoVariantTags,
  nearestPhotoTagCorner,
  photoPlacement,
  photoVariantTagLayout,
  productPhotoGallery,
  reprojectPhotoVariantTags,
  squareProductPhoto,
  validatePhotoTagScale,
  validatePhotoPointerScale,
  validatePhotoPointerInversion,
  PHOTO_TAG_SCALE,
  PHOTO_POINTER_SCALE,
  validatePhotoVariantTags,
} from '../src/product-photo.js'
import { validatePhotoEdits } from '../src/store-order.js'
import {
  cartonVolume,
  cartonPackingForItems,
  productCartonDetails,
} from '../src/carton-details.js'

test('square photos preserve aspect ratio and center or crop without stretching', () => {
  assert.deepEqual(photoPlacement(800, 200, 400), {
    width: 400,
    height: 100,
    x: 0,
    y: 150,
  })
  assert.deepEqual(photoPlacement(800, 200, 400, { fit: 'cover' }), {
    width: 1600,
    height: 400,
    x: -600,
    y: 0,
  })
  assert.deepEqual(photoPlacement(800, 200, 400, { scale: 0.5, x: 0.1 }), {
    width: 200,
    height: 50,
    x: 140,
    y: 175,
  })
})

test('gallery retains every photo and product association, including shared assets', () => {
  const first = { entryId: '1', photos: ['a', 'b'], thumbnail: 'square' },
    second = { entryId: '2', photos: ['a'], thumbnail: 'square' }
  const gallery = productPhotoGallery([first, second])
  assert.deepEqual(
    gallery.map(({ originalPhoto, photoIndex }) => [originalPhoto, photoIndex]),
    [
      ['a', 0],
      ['b', 1],
      ['a', 0],
    ]
  )
  assert.equal(gallery[0].photoSource, first)
  assert.equal(gallery[2].photoSource, second)
})

const variantTag = {
  id: 'tag-a',
  code: 'AX',
  x: 0.2,
  y: 0.7,
  labelX: 0.8,
  labelY: 0.2,
}

test('photo edits validate bounded callouts without changing older edit schemas', () => {
  const edit = {
    fit: 'contain',
    scale: 1.5,
    x: 0.2,
    y: -0.1,
    background: '#ffffff',
  }
  assert.deepEqual(validatePhotoEdits({ 0: edit }, 1), { 0: edit })
  const before = structuredClone(variantTag)
  const tagged = { ...edit, tags: [variantTag] }
  assert.deepEqual(validatePhotoEdits({ 0: tagged }, 1), { 0: tagged })
  assert.deepEqual(variantTag, before)
  assert.notEqual(validatePhotoVariantTags([variantTag])[0], variantTag)
  assert.deepEqual(validatePhotoEdits({ 0: { tags: [] } }, 1), {
    0: { tags: [] },
  })
  for (const tags of [
    null,
    {},
    Array.from({ length: 51 }, (_, index) => ({
      ...variantTag,
      id: String(index),
    })),
    [variantTag, variantTag],
    [{ ...variantTag, id: '' }],
    [{ ...variantTag, id: 'x'.repeat(81) }],
    [{ ...variantTag, code: 'a' }],
    [{ ...variantTag, code: 'ABCDEFGHI' }],
    [{ ...variantTag, code: '<A>' }],
    [{ ...variantTag, x: -0.01 }],
    [{ ...variantTag, y: 1.01 }],
    [{ ...variantTag, labelX: Infinity }],
    [{ ...variantTag, labelY: '0.5' }],
    [{ ...variantTag, x: undefined }],
  ]) {
    assert.throws(
      () => validatePhotoEdits({ 0: { tags } }, 1),
      /Photo variant tag/
    )
  }
})

test('callout geometry scales with its square and clamps long badges inside it', () => {
  const small = photoVariantTagLayout(variantTag, 100)
  const large = photoVariantTagLayout(variantTag, 1000)
  for (const group of ['anchor', 'badge', 'leader', 'dot', 'text', 'ink'])
    for (const field of Object.keys(small[group]))
      assert.ok(Math.abs(large[group][field] - small[group][field] * 10) < 1e-8)
  assert.equal(large.fontSize, small.fontSize * 10)
  assert.deepEqual(large.anchor, { x: 200, y: 700 })
  assert.ok(large.leader.x2 >= large.badge.x)
  assert.ok(large.leader.x2 <= large.badge.x + large.badge.width)
  assert.ok(large.leader.y2 >= large.badge.y)
  assert.ok(large.leader.y2 <= large.badge.y + large.badge.height)
  for (const labelX of [0, 1])
    for (const labelY of [0, 1]) {
      const layout = photoVariantTagLayout(
        { ...variantTag, code: 'ABCDEFGH', labelX, labelY },
        640
      )
      assert.ok(layout.badge.x >= 0)
      assert.ok(layout.badge.y >= 0)
      assert.ok(layout.badge.x + layout.badge.width <= 640)
      assert.ok(layout.badge.y + layout.badge.height <= 640)
    }
  const context = {
    font: 'original font',
    measureText(text) {
      assert.match(this.font, /^700 /)
      return { width: text.length * 30 }
    },
  }
  const measured = photoVariantTagLayout(variantTag, 640, context)
  assert.equal(measured.badge.width, 60 + 640 * 0.036)
  assert.equal(context.font, 'original font')
})

test('single-character badges are square with softer corners and their actual ink has balanced opposite padding', () => {
  const context = {
    font: 'original font',
    textAlign: 'right',
    textBaseline: 'ideographic',
    measureText(code) {
      assert.equal(this.textAlign, 'left')
      assert.equal(this.textBaseline, 'alphabetic')
      const size = Number(this.font.match(/([\d.]+)px/)[1])
      return {
        width: code.length * size * 0.72,
        actualBoundingBoxLeft: size * 0.04,
        actualBoundingBoxRight: (code.length * 0.64 + 0.06) * size,
        actualBoundingBoxAscent: Math.floor(size * 0.71) + 1,
        actualBoundingBoxDescent: Math.round(size * 0.025),
      }
    },
  }
  for (const code of ['A', 'B', 'W', '0', 'AX', 'BL', 'AXL', 'WWWWWWWW'])
    for (const scale of PHOTO_TAG_SCALE.stops) {
      const layout = photoVariantTagLayout(
        { ...variantTag, code },
        640,
        context,
        scale
      )
      const size = layout.fontSize,
        left = layout.ink.x - size * 0.04,
        right = layout.ink.x + (code.length * 0.64 + 0.06) * size,
        top = layout.ink.y - (Math.floor(size * 0.71) + 1),
        bottom = layout.ink.y + Math.round(size * 0.025),
        paddingLeft = left - layout.badge.x,
        paddingRight = layout.badge.x + layout.badge.width - right,
        paddingTop = top - layout.badge.y,
        paddingBottom = layout.badge.y + layout.badge.height - bottom
      assert.ok(Math.abs(paddingLeft - paddingRight) < 1e-8)
      assert.ok(Math.abs(paddingTop - paddingBottom) < 1e-8)
      assert.ok(paddingLeft > 0 && paddingTop > 0)
      assert.equal(layout.text.x, layout.badge.x + layout.badge.width / 2)
      assert.equal(layout.text.y, layout.badge.y + layout.badge.height / 2)
      if (code.length === 1)
        assert.equal(layout.badge.width, layout.badge.height)
      else assert.ok(layout.badge.width >= layout.badge.height)
      assert.equal(
        layout.badge.radius,
        Math.min(layout.badge.width, layout.badge.height) * 0.24
      )
      assert.ok(
        layout.badge.radius >
          Math.min(layout.badge.width, layout.badge.height) * 0.15
      )
      assert.equal(context.font, 'original font')
      assert.equal(context.textAlign, 'right')
      assert.equal(context.textBaseline, 'ideographic')
    }
})

test('optional tag size validates bounded numbers without adding fields to old edits', () => {
  assert.deepEqual(validatePhotoEdits({ 0: { tags: [variantTag] } }, 1), {
    0: { tags: [variantTag] },
  })
  for (const tagScale of [0.6, 1, 1.75, 2.5, 4, 6]) {
    assert.equal(validatePhotoTagScale(tagScale), tagScale)
    assert.deepEqual(validatePhotoEdits({ 0: { tagScale } }, 1), {
      0: { tagScale },
    })
  }
  for (const tagScale of [0.59, 6.01, 0, -1, NaN, Infinity, '1', null, true]) {
    assert.throws(() => validatePhotoTagScale(tagScale), /between 0.6 and 6/)
    assert.throws(
      () => validatePhotoEdits({ 0: { tagScale } }, 1),
      /between 0.6 and 6/
    )
  }
})

test('photo size controls offer many standard quarter-size stops while legacy saved values stay exact', () => {
  for (const [config, minimum, maximum] of [
    [PHOTO_TAG_SCALE, 0.6, 6],
    [PHOTO_POINTER_SCALE, 0.5, 4],
  ]) {
    assert.equal(config.stops[0], minimum)
    assert.equal(config.stops.at(-1), maximum)
    assert.ok(Object.isFrozen(config.stops))
    for (const value of [0.75, 1, 1.25, 1.5, 2, 2.25, 2.75, 3, 3.75, 4])
      assert.ok(config.stops.includes(value))
    assert.equal(config.stops.includes(0.88), false)
    assert.equal(config.stops.includes(4.31), false)
    assert.ok(
      config.stops.slice(1).every((value) => Number.isInteger(value * 4))
    )
  }
  const edit = { tags: [variantTag], tagScale: 1.88, pointerScale: 1.43 }
  assert.deepEqual(validatePhotoEdits({ 0: edit }, 1), { 0: edit })
})

test('optional pointer size validates finite bounded numbers and leaves old photo edits unchanged', () => {
  const legacy = { tags: [variantTag], tagScale: 1.5 }
  assert.deepEqual(validatePhotoEdits({ 0: legacy }, 1), { 0: legacy })
  for (const pointerScale of [0.5, 1, 1.75, 3, 4]) {
    assert.equal(validatePhotoPointerScale(pointerScale), pointerScale)
    assert.deepEqual(validatePhotoEdits({ 0: { pointerScale } }, 1), {
      0: { pointerScale },
    })
  }
  for (const pointerScale of [
    0.49,
    4.01,
    0,
    -1,
    NaN,
    Infinity,
    '1',
    null,
    true,
  ]) {
    assert.throws(
      () => validatePhotoPointerScale(pointerScale),
      /between 0.5 and 4/
    )
    assert.throws(
      () => validatePhotoEdits({ 0: { pointerScale } }, 1),
      /between 0.5 and 4/
    )
    assert.throws(
      () => photoVariantTagLayout(variantTag, 640, undefined, 1, pointerScale),
      /between 0.5 and 4/
    )
  }
})

test('pointer size scales all black and white circles without changing badge, leader or point coordinates', () => {
  const tags = [
    variantTag,
    { ...variantTag, id: 'b', code: 'B', x: 0.8, y: 0.2 },
  ]
  for (const tagScale of [0.6, 1, 2.5, 6])
    for (const pointerScale of [0.5, 1, 2, 4]) {
      const base = drawPhotoVariantTags(drawingContext(), tags, 640, tagScale)
      const changed = drawPhotoVariantTags(
        drawingContext(),
        tags,
        640,
        tagScale,
        pointerScale
      )
      for (let index = 0; index < tags.length; index++) {
        const { dot, ...geometry } = changed[index],
          { dot: originalDot, ...originalGeometry } = base[index]
        assert.deepEqual(geometry, originalGeometry)
        assert.equal(dot.radius, originalDot.radius * pointerScale)
        assert.equal(dot.innerRadius, originalDot.innerRadius * pointerScale)
      }
    }
})

test('new callouts start in the nearest corner and keep their whole badge visible at every size', () => {
  for (const x of [0.1, 0.9])
    for (const y of [0.1, 0.9])
      for (const code of ['A', 'AS', 'BL', 'AXL', 'WWWWWWWW'])
        for (const scale of [0.6, 1, 2.5, 6]) {
          const before = { ...variantTag, code, x, y }
          const tag = nearestPhotoTagCorner(before, 640, undefined, scale)
          const layout = photoVariantTagLayout(tag, 640, undefined, scale)
          assert.equal(tag.x, x)
          assert.equal(tag.y, y)
          assert.equal(tag.code, code)
          assert.ok((tag.labelX - 0.5) * (x - 0.5) >= -1e-9)
          assert.ok((tag.labelY - 0.5) * (y - 0.5) >= -1e-9)
          const distance =
            (layout.text.x - x * 640) ** 2 + (layout.text.y - y * 640) ** 2
          for (const labelX of [0, 1])
            for (const labelY of [0, 1]) {
              const candidate = photoVariantTagLayout(
                { ...before, labelX, labelY },
                640,
                undefined,
                scale
              )
              assert.ok(
                distance - 1e-8 <=
                  (candidate.text.x - x * 640) ** 2 +
                    (candidate.text.y - y * 640) ** 2
              )
            }
          assert.ok(layout.badge.x > 0)
          assert.ok(layout.badge.y > 0)
          assert.ok(layout.badge.x + layout.badge.width < 640)
          assert.ok(layout.badge.y + layout.badge.height < 640)
          assert.deepEqual(before, { ...variantTag, code, x, y })
        }
})

test('nearest-corner placement resolves centered ties consistently toward the top-left', () => {
  for (const code of ['A', 'AS', 'WWWWWWWW'])
    for (const scale of [0.6, 1, 2.5, 6]) {
      const before = { ...variantTag, code, x: 0.5, y: 0.5 }
      const tag = nearestPhotoTagCorner(before, 640, undefined, scale)
      const layout = photoVariantTagLayout(tag, 640, undefined, scale)
      assert.ok(tag.labelX <= 0.5 + 1e-9)
      assert.ok(tag.labelY < 0.5)
      const first = photoVariantTagLayout(
        { ...before, labelX: 0, labelY: 0 },
        640,
        undefined,
        scale
      )
      assert.ok(Math.abs(layout.badge.x - first.badge.x) < 1e-8)
      assert.ok(Math.abs(layout.badge.y - first.badge.y) < 1e-8)
      assert.deepEqual(
        nearestPhotoTagCorner(before, 640, undefined, scale),
        tag
      )
    }
})

test('tag size scales callout geometry together while keeping anchors and central badges fixed', () => {
  const tag = { ...variantTag, labelX: 0.5, labelY: 0.5 }
  const base = photoVariantTagLayout(tag, 640)
  assert.equal(base.dot.radius, 640 * 0.02)
  assert.equal(base.dot.innerRadius, 640 * 0.008)
  for (const scale of [0.6, 1.75, 2.5, 6]) {
    const layout = photoVariantTagLayout(tag, 640, undefined, scale)
    assert.deepEqual(layout.anchor, base.anchor)
    assert.deepEqual(layout.text, base.text)
    for (const key of ['width', 'height', 'radius'])
      assert.ok(Math.abs(layout.badge[key] - base.badge[key] * scale) < 1e-8)
    for (const key of ['radius', 'innerRadius'])
      assert.ok(Math.abs(layout.dot[key] - base.dot[key] * scale) < 1e-8)
    assert.ok(Math.abs(layout.fontSize - base.fontSize * scale) < 1e-8)
    assert.ok(Math.abs(layout.lineWidth - base.lineWidth * scale) < 1e-8)
  }
})

test('every tag size clamps edge badges and fits wide codes without clipping letters', () => {
  const context = {
    font: '12px Arial',
    measureText(value) {
      return {
        width: value.length * Number(/700 ([\d.]+)px/.exec(this.font)[1]),
      }
    },
  }
  for (const scale of [0.6, 1, 2.5, 6])
    for (const labelX of [0, 0.5, 1])
      for (const labelY of [0, 0.5, 1]) {
        const tag = { ...variantTag, code: 'WWWWWWWW', labelX, labelY }
        const layout = photoVariantTagLayout(tag, 640, context, scale)
        assert.ok(layout.badge.x >= 0)
        assert.ok(layout.badge.y >= 0)
        assert.ok(layout.badge.x + layout.badge.width <= 640 + 1e-9)
        assert.ok(layout.badge.y + layout.badge.height <= 640 + 1e-9)
        assert.ok(layout.fontSize * tag.code.length < layout.badge.width)
        assert.deepEqual(layout.anchor, { x: 128, y: 448 })
      }
  assert.equal(context.font, '12px Arial')
})

test('photo transforms keep callout anchors on their source point and badge centers fixed', () => {
  const tags = [{ ...variantTag, x: 0.4, y: 0.4 }]
  const before = structuredClone(tags)
  const transform = { scale: 1.5, x: 0.1, y: -0.1 }
  const moved = reprojectPhotoVariantTags(
    tags,
    { width: 800, height: 800 },
    {},
    transform
  )
  assert.ok(Math.abs(moved[0].x - 0.45) < 1e-9)
  assert.ok(Math.abs(moved[0].y - 0.25) < 1e-9)
  assert.equal(moved[0].labelX, tags[0].labelX)
  assert.equal(moved[0].labelY, tags[0].labelY)
  const restored = reprojectPhotoVariantTags(
    moved,
    { width: 800, height: 800 },
    transform,
    {}
  )
  assert.ok(Math.abs(restored[0].x - tags[0].x) < 1e-9)
  assert.ok(Math.abs(restored[0].y - tags[0].y) < 1e-9)
  assert.deepEqual(tags, before)
  const centered = reprojectPhotoVariantTags(
    [{ ...variantTag, x: 0.5, y: 0.5 }],
    { width: 800, height: 200 },
    { fit: 'contain' },
    { fit: 'cover' }
  )
  assert.equal(centered[0].x, 0.5)
  assert.equal(centered[0].y, 0.5)
})

test('a crop hiding any tagged point rejects without changing the previous tags', () => {
  const tags = [
    { ...variantTag, x: 0.5, y: 0.5 },
    { ...variantTag, id: 'edge', x: 0.2, y: 0.5 },
  ]
  const before = structuredClone(tags)
  assert.throws(
    () =>
      reprojectPhotoVariantTags(
        tags,
        { width: 800, height: 200 },
        { fit: 'contain' },
        { fit: 'cover' }
      ),
    /This crop would hide a tagged point\. Move or remove that tag first\./
  )
  assert.deepEqual(tags, before)
  const rounded = reprojectPhotoVariantTags(
    [{ ...variantTag, x: 0, y: 1 }],
    { width: 100, height: 100 },
    {},
    { x: -1e-12, y: 1e-12 }
  )
  assert.equal(rounded[0].x, 0)
  assert.equal(rounded[0].y, 1)
})

function drawingContext() {
  const calls = []
  const context = {
    calls,
    measureText: (text) => ({ width: text.length * 20 }),
  }
  for (const method of [
    'save',
    'restore',
    'beginPath',
    'moveTo',
    'lineTo',
    'stroke',
    'roundRect',
    'fill',
    'arc',
    'fillText',
    'fillRect',
    'drawImage',
  ])
    context[method] = function (...args) {
      calls.push({
        method,
        args,
        fill: this.fillStyle,
        stroke: this.strokeStyle,
        font: this.font,
        textAlign: this.textAlign,
        textBaseline: this.textBaseline,
      })
    }
  return context
}

test('callouts draw black leaders and badges, white code text and white-core dots', () => {
  const context = drawingContext()
  const layouts = drawPhotoVariantTags(context, [variantTag], 640)
  assert.deepEqual(layouts[0], photoVariantTagLayout(variantTag, 640, context))
  assert.equal(
    context.calls.find((call) => call.method === 'stroke').stroke,
    '#000000'
  )
  assert.equal(
    context.calls.filter((call) => call.method === 'fill')[0].fill,
    '#000000'
  )
  assert.equal(
    context.calls.filter((call) => call.method === 'fill')[1].fill,
    '#000000'
  )
  assert.equal(
    context.calls.filter((call) => call.method === 'fill')[2].fill,
    '#ffffff'
  )
  const text = context.calls.find((call) => call.method === 'fillText')
  assert.equal(text.fill, '#ffffff')
  assert.equal(text.args[0], 'AX')
  assert.match(text.font, /^700 /)
  assert.equal(text.textAlign, 'left')
  assert.equal(text.textBaseline, 'alphabetic')
  assert.deepEqual(text.args.slice(1), [layouts[0].ink.x, layouts[0].ink.y])
  assert.equal(context.calls.at(-1).method, 'restore')
  const scaled = drawingContext()
  const result = drawPhotoVariantTags(scaled, [variantTag], 640, 1.5)
  assert.deepEqual(
    result[0],
    photoVariantTagLayout(variantTag, 640, scaled, 1.5)
  )
})

test('pointer inversion changes all leaders and circles while preserving black badges, white text and geometry', () => {
  const tags = [variantTag, { ...variantTag, id: 'b', code: 'B' }]
  const normal = drawingContext(),
    inverted = drawingContext()
  const layouts = drawPhotoVariantTags(normal, tags, 640, 1.5, 2)
  assert.deepEqual(
    drawPhotoVariantTags(inverted, tags, 640, 1.5, 2, true),
    layouts
  )
  assert.ok(
    inverted.calls
      .filter(({ method }) => method === 'stroke')
      .every(({ stroke }) => stroke === '#ffffff')
  )
  assert.deepEqual(
    inverted.calls
      .filter(({ method }) => method === 'fill')
      .map(({ fill }) => fill),
    ['#000000', '#ffffff', '#000000', '#000000', '#ffffff', '#000000']
  )
  assert.ok(
    inverted.calls
      .filter(({ method }) => method === 'fillText')
      .every(({ fill }) => fill === '#ffffff')
  )
  for (const value of [true, false])
    assert.equal(validatePhotoPointerInversion(value), value)
  for (const value of [1, 0, 'true', null, undefined, {}, []]) {
    assert.throws(
      () => validatePhotoPointerInversion(value),
      /must be true or false/
    )
    if (value !== undefined)
      assert.throws(
        () => drawPhotoVariantTags(drawingContext(), tags, 640, 1, 1, value),
        /must be true or false/
      )
  }
})

test('square photo callouts render after the image and stay independent of crop transforms', async () => {
  const previousImage = globalThis.Image
  const previousDocument = globalThis.document
  const contexts = []
  try {
    globalThis.Image = class {
      naturalWidth = 800
      naturalHeight = 200
      async decode() {}
    }
    globalThis.document = {
      createElement() {
        const context = drawingContext()
        contexts.push(context)
        return { getContext: () => context, toDataURL: () => 'rendered' }
      },
    }
    const tagged = { tags: [variantTag] }
    assert.equal(await squareProductPhoto('original', tagged, 640), 'rendered')
    await squareProductPhoto(
      'original',
      { ...tagged, fit: 'cover', scale: 2, x: 0.3 },
      640
    )
    await squareProductPhoto('original', { ...tagged, tagScale: 6 }, 640)
    await squareProductPhoto(
      'original',
      { ...tagged, tagScale: 6, pointerScale: 3 },
      640
    )
    await squareProductPhoto(
      'original',
      { ...tagged, tagScale: 6, pointerScale: 3, invertPointer: true },
      640
    )
    const geometry = (context) =>
      context.calls.filter((call) =>
        ['moveTo', 'lineTo', 'roundRect', 'arc', 'fillText'].includes(
          call.method
        )
      )
    assert.deepEqual(geometry(contexts[0]), geometry(contexts[1]))
    const calls = contexts[0].calls.map((call) => call.method)
    assert.ok(calls.indexOf('drawImage') < calls.indexOf('roundRect'))
    const radius = (context) =>
      context.calls.find((call) => call.method === 'arc').args[2]
    assert.equal(radius(contexts[2]), radius(contexts[0]) * 6)
    assert.equal(radius(contexts[3]), radius(contexts[2]) * 3)
    assert.deepEqual(
      geometry(contexts[3]).filter(({ method }) => method !== 'arc'),
      geometry(contexts[2]).filter(({ method }) => method !== 'arc')
    )
    assert.deepEqual(
      geometry(contexts[4]).map(({ method, args }) => ({ method, args })),
      geometry(contexts[3]).map(({ method, args }) => ({ method, args }))
    )
    assert.equal(
      contexts[4].calls.find(({ method }) => method === 'stroke').stroke,
      '#ffffff'
    )
  } finally {
    globalThis.Image = previousImage
    globalThis.document = previousDocument
  }
})

test('precise centimetre carton dimensions take display priority over seller CBM', () => {
  assert.equal(
    cartonVolume({ len: '70', wid: '50', ht: '30', cbm: '0.21' }),
    '0.105'
  )
  assert.equal(cartonVolume({ len: '70', cbm: '0.21' }), '0.21')
  assert.deepEqual(
    productCartonDetails(
      { entryId: '1', carton: { kg: '5' } },
      { cartonDetails: { 1: {} } }
    ),
    {}
  )
})

test('combined source variants count cartons once and partial selection requires review', () => {
  const record = {
    snapshot: {
      sourceType: 'spreadsheet',
      spreadsheet: { rows: [{ row: 5, boxes: '3', perbox: '10' }] },
      items: [
        { entryId: '1', sourceRow: 5 },
        { entryId: '2', sourceRow: 5 },
      ],
    },
  }
  assert.equal(cartonPackingForItems(record, ['1', '2']).total, 3)
  assert.equal(cartonPackingForItems(record, ['1', '2']).exact, true)
  assert.equal(cartonPackingForItems(record, ['1']).requiresReview, true)
  assert.equal(cartonPackingForItems(record, ['1']).exact, false)
})

test('1688 loose quantities still require physical carton review', () => {
  const record = {
    snapshot: { items: [{ entryId: '1', quantity: '105' }] },
    unitsPerCarton: { 1: 10 },
  }
  const result = cartonPackingForItems(record, ['1'])
  assert.equal(result.total, 10)
  assert.equal(result.exact, false)
  assert.equal(result.requiresReview, true)
})

test('editing a shared variant weight never duplicates its source cartons', () => {
  const record = {
    snapshot: {
      sourceType: 'spreadsheet',
      spreadsheet: { rows: [{ row: 5, boxes: '2', perbox: '10' }] },
      items: [
        { entryId: '1', sourceRow: 5 },
        { entryId: '2', sourceRow: 5 },
      ],
    },
    unitsPerCarton: { 1: 10, 2: 10 },
    cartonDetails: { 1: { boxes: '2', kg: '3' } },
  }
  const result = cartonPackingForItems(record, ['1', '2'])
  assert.equal(result.total, 2)
  assert.equal(result.exact, true)
  record.cartonDetails['2'] = { boxes: '1' }
  assert.equal(cartonPackingForItems(record, ['1', '2']).requiresReview, true)
  assert.equal(cartonPackingForItems(record, ['1', '2']).exact, false)
})
