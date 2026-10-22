export const DEFAULT_PHOTO_EDIT = Object.freeze({
  fit: 'contain',
  scale: 1,
  x: 0,
  y: 0,
  background: '#ffffff',
})

export const DEFAULT_PHOTO_TAG_SCALE = 2
export const PHOTO_TAG_TEXT_LIMIT = 64

/** Photo annotations are plain single-line text, separate from product codes. */
export function validPhotoTagText(value) {
  return (
    typeof value === 'string' &&
    Boolean(value.trim()) &&
    value.length <= PHOTO_TAG_TEXT_LIMIT &&
    !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value)
  )
}

/** Start new annotations larger without changing existing authored artwork. */
export function photoEditDraft(saved = {}) {
  return {
    ...DEFAULT_PHOTO_EDIT,
    pointerScale: 1,
    tagScale: saved.tags?.length ? 1 : DEFAULT_PHOTO_TAG_SCALE,
    ...structuredClone(saved),
  }
}

const quarterSteps = (from, to) =>
  Array.from({ length: (to - from) * 4 + 1 }, (_, index) => from + index / 4)

export const PHOTO_TAG_SCALE = Object.freeze({
  min: 0.6,
  max: 6,
  stops: Object.freeze([0.6, ...quarterSteps(0.75, 6)]),
})
export const PHOTO_POINTER_SCALE = Object.freeze({
  min: 0.5,
  max: 4,
  stops: Object.freeze(quarterSteps(0.5, 4)),
})

/** Callouts use square-canvas coordinates, independently of the source photo. */
export function validatePhotoVariantTags(tags) {
  if (!Array.isArray(tags) || tags.length > 50)
    throw new Error('Photo variant tags must contain at most 50 callouts')
  const ids = new Set()
  return tags.map((tag) => {
    if (
      !tag ||
      typeof tag !== 'object' ||
      Array.isArray(tag) ||
      typeof tag.id !== 'string' ||
      !tag.id.trim() ||
      tag.id.length > 80 ||
      ids.has(tag.id)
    )
      throw new Error('Photo variant tag identifiers must be unique')
    ids.add(tag.id)
    if (!validPhotoTagText(tag.code))
      throw new Error('Photo tag text must contain 1–64 characters on one line')
    const result = { id: tag.id, code: tag.code }
    for (const field of ['x', 'y', 'labelX', 'labelY']) {
      if (!Number.isFinite(tag[field]) || tag[field] < 0 || tag[field] > 1)
        throw new Error('Photo variant tag coordinates must be between 0 and 1')
      result[field] = tag[field]
    }
    return result
  })
}

export function validatePhotoTagScale(value) {
  if (
    !Number.isFinite(value) ||
    value < PHOTO_TAG_SCALE.min ||
    value > PHOTO_TAG_SCALE.max
  )
    throw new Error('Photo tag size must be between 0.6 and 6')
  return value
}

export function validatePhotoPointerScale(value) {
  if (
    !Number.isFinite(value) ||
    value < PHOTO_POINTER_SCALE.min ||
    value > PHOTO_POINTER_SCALE.max
  )
    throw new Error('Photo pointer size must be between 0.5 and 4')
  return value
}

export function validatePhotoPointerInversion(value) {
  if (typeof value !== 'boolean')
    throw new Error('Photo pointer color inversion must be true or false')
  return value
}

function photoTagInk(code, font, fontSize, context) {
  let metrics
  if (context?.measureText) {
    const previous = {
      font: context.font,
      textAlign: context.textAlign,
      textBaseline: context.textBaseline,
    }
    try {
      context.font = font
      context.textAlign = 'left'
      context.textBaseline = 'alphabetic'
      metrics = context.measureText(code)
    } finally {
      Object.assign(context, previous)
    }
  }
  const measuredWidth = metrics?.width ?? code.length * fontSize * 0.66
  const horizontal =
    Number.isFinite(metrics?.actualBoundingBoxLeft) &&
    Number.isFinite(metrics?.actualBoundingBoxRight) &&
    metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight > 0
  const vertical =
    Number.isFinite(metrics?.actualBoundingBoxAscent) &&
    Number.isFinite(metrics?.actualBoundingBoxDescent) &&
    metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent > 0
  return {
    left: horizontal ? metrics.actualBoundingBoxLeft : 0,
    right: horizontal ? metrics.actualBoundingBoxRight : measuredWidth,
    ascent: vertical ? metrics.actualBoundingBoxAscent : fontSize * 0.72,
    descent: vertical ? metrics.actualBoundingBoxDescent : fontSize * 0.02,
  }
}

/** Shared pixel geometry for canvas export and the interactive viewer overlay. */
export function photoVariantTagLayout(
  tag,
  size,
  context,
  tagScale = 1,
  pointerScale = 1
) {
  if (!Number.isFinite(size) || size <= 0)
    throw new Error('Photo dimensions are invalid')
  validatePhotoTagScale(tagScale)
  validatePhotoPointerScale(pointerScale)
  let fontSize = size * 0.052 * tagScale
  let font = `700 ${fontSize}px Arial, sans-serif`
  let ink = photoTagInk(tag.code, font, fontSize, context)
  const padding = size * 0.018 * tagScale
  const minimumHeight = Math.max(
    size * 0.08 * tagScale,
    ink.ascent + ink.descent + padding * 2
  )
  // At the largest size, fit long text as one shape, preserving the relative
  // text/padding/dot/line geometry instead of clipping letters out of a badge.
  const requestedWidth = Math.max(
    minimumHeight,
    ink.left + ink.right + padding * 2
  )
  const requestedHeight = tag.code.length === 1 ? requestedWidth : minimumHeight
  const fit = Math.min(1, size / (requestedWidth + size * 0.02 * tagScale))
  const scale = tagScale * fit
  fontSize *= fit
  font = `700 ${fontSize}px Arial, sans-serif`
  const inset = size * 0.01 * scale
  const height = requestedHeight * fit
  const width = requestedWidth * fit
  // Re-measure at the final font size: real glyph bounds need not scale
  // perfectly because the browser can round ink metrics at each size.
  ink = photoTagInk(tag.code, font, fontSize, context)
  const x = Math.max(
    inset,
    Math.min(size - inset - width, tag.labelX * size - width / 2)
  )
  const y = Math.max(
    inset,
    Math.min(size - inset - height, tag.labelY * size - height / 2)
  )
  const centerX = x + width / 2
  const centerY = y + height / 2
  const anchor = { x: tag.x * size, y: tag.y * size }
  const dx = anchor.x - centerX
  const dy = anchor.y - centerY
  const factor = Math.min(
    1,
    dx === 0 ? Infinity : width / (2 * Math.abs(dx)),
    dy === 0 ? Infinity : height / (2 * Math.abs(dy))
  )
  return {
    id: tag.id,
    code: tag.code,
    anchor,
    badge: { x, y, width, height, radius: Math.min(width, height) * 0.24 },
    leader: {
      x1: anchor.x,
      y1: anchor.y,
      x2: centerX + dx * factor,
      y2: centerY + dy * factor,
    },
    dot: {
      radius: size * 0.02 * scale * pointerScale,
      innerRadius: size * 0.008 * scale * pointerScale,
    },
    text: { x: centerX, y: centerY },
    ink: {
      x: centerX + (ink.left - ink.right) / 2,
      y: centerY + (ink.ascent - ink.descent) / 2,
    },
    font,
    fontSize,
    lineWidth: Math.max(1, size * 0.003) * scale,
  }
}

/** Start a callout in its nearest corner, with the whole badge inset. */
export function nearestPhotoTagCorner(tag, size, context, tagScale = 1) {
  let nearest,
    distance = Infinity
  const epsilon = size * size * Number.EPSILON * 16
  for (const labelX of [0, 1])
    for (const labelY of [0, 1]) {
      const layout = photoVariantTagLayout(
        { ...tag, labelX, labelY },
        size,
        context,
        tagScale
      )
      const squared =
        (layout.text.x - layout.anchor.x) ** 2 +
        (layout.text.y - layout.anchor.y) ** 2
      // Equal distances keep the first corner (top-left first), including
      // subpixel rounding differences for a centered point or a wide badge.
      if (squared < distance - epsilon) {
        distance = squared
        nearest = {
          ...tag,
          labelX: layout.text.x / size,
          labelY: layout.text.y / size,
        }
      }
    }
  return nearest
}

/** Standard black badges, white text and a black leader with a white-core dot. */
export function drawPhotoVariantTags(
  context,
  tags,
  size,
  tagScale = 1,
  pointerScale = 1,
  invertPointer = false
) {
  validatePhotoTagScale(tagScale)
  validatePhotoPointerScale(pointerScale)
  validatePhotoPointerInversion(invertPointer)
  const layouts = validatePhotoVariantTags(tags).map((tag) =>
    photoVariantTagLayout(tag, size, context, tagScale, pointerScale)
  )
  context.save()
  for (const layout of layouts) {
    const { anchor, badge, leader, dot, ink } = layout
    const pointerColor = invertPointer ? '#ffffff' : '#000000'
    context.strokeStyle = pointerColor
    context.fillStyle = '#000000'
    context.lineWidth = layout.lineWidth
    context.lineCap = 'round'
    context.beginPath()
    context.moveTo(leader.x1, leader.y1)
    context.lineTo(leader.x2, leader.y2)
    context.stroke()
    context.beginPath()
    context.roundRect(badge.x, badge.y, badge.width, badge.height, badge.radius)
    context.fill()
    context.fillStyle = pointerColor
    context.beginPath()
    context.arc(anchor.x, anchor.y, dot.radius, 0, Math.PI * 2)
    context.fill()
    context.fillStyle = invertPointer ? '#000000' : '#ffffff'
    context.beginPath()
    context.arc(anchor.x, anchor.y, dot.innerRadius, 0, Math.PI * 2)
    context.fill()
    context.fillStyle = '#ffffff'
    context.font = layout.font
    context.textAlign = 'left'
    context.textBaseline = 'alphabetic'
    context.fillText(layout.code, ink.x, ink.y)
  }
  context.restore()
  return layouts
}

/** A square canvas preserves the source's aspect ratio in both fit modes. */
export function photoPlacement(width, height, size, edit = {}) {
  const options = { ...DEFAULT_PHOTO_EDIT, ...edit }
  if (![width, height, size].every((n) => Number.isFinite(n) && n > 0))
    throw new Error('Photo dimensions are invalid')
  const ratio =
    (options.fit === 'cover'
      ? Math.max(size / width, size / height)
      : Math.min(size / width, size / height)) * options.scale
  const w = width * ratio,
    h = height * ratio
  return {
    width: w,
    height: h,
    x: (size - w) / 2 + options.x * size,
    y: (size - h) / 2 + options.y * size,
  }
}

/** Keep anchors on their source pixels when the photo moves beneath badges. */
export function reprojectPhotoVariantTags(
  tags,
  { width, height },
  beforeEdit,
  afterEdit
) {
  const validated = validatePhotoVariantTags(tags)
  const before = photoPlacement(width, height, 1, beforeEdit)
  const after = photoPlacement(width, height, 1, afterEdit)
  const epsilon = 1e-9
  return validated.map((tag) => {
    const x = after.x + ((tag.x - before.x) / before.width) * after.width
    const y = after.y + ((tag.y - before.y) / before.height) * after.height
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      x < -epsilon ||
      x > 1 + epsilon ||
      y < -epsilon ||
      y > 1 + epsilon
    )
      throw new Error(
        'This crop would hide a tagged point. Move or remove that tag first.'
      )
    return {
      ...tag,
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
    }
  })
}

export async function squareProductPhoto(source, edit = {}, size = 640) {
  const image = new Image()
  image.src = source
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const context = canvas.getContext('2d')
  context.fillStyle = edit.background || DEFAULT_PHOTO_EDIT.background
  context.fillRect(0, 0, size, size)
  const rect = photoPlacement(
    image.naturalWidth,
    image.naturalHeight,
    size,
    edit
  )
  context.drawImage(image, rect.x, rect.y, rect.width, rect.height)
  if (edit.tags?.length)
    drawPhotoVariantTags(
      context,
      edit.tags,
      size,
      edit.tagScale ?? 1,
      edit.pointerScale ?? 1,
      edit.invertPointer ?? false
    )
  return canvas.toDataURL('image/png')
}

/** Keep product associations even when several products share one image asset. */
export function productPhotoGallery(items) {
  return items.flatMap((item) => {
    const photos = item.photos?.length
      ? item.photos
      : item.thumbnail
        ? [item.thumbnail]
        : []
    return photos.map((photo, photoIndex) => ({
      ...item,
      photoIndex,
      photoSource: item,
      originalPhoto: photo,
    }))
  })
}
