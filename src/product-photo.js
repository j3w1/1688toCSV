export const DEFAULT_PHOTO_EDIT = Object.freeze({
  fit: 'contain',
  scale: 1,
  x: 0,
  y: 0,
  background: '#ffffff',
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
    if (typeof tag.code !== 'string' || !/^[A-Z0-9]{1,8}$/.test(tag.code))
      throw new Error(
        'Photo variant tag codes require 1–8 uppercase letters or digits'
      )
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
  if (!Number.isFinite(value) || value < 0.6 || value > 2.5)
    throw new Error('Photo tag size must be between 0.6 and 2.5')
  return value
}

/** Shared pixel geometry for canvas export and the interactive viewer overlay. */
export function photoVariantTagLayout(tag, size, context, tagScale = 1) {
  if (!Number.isFinite(size) || size <= 0)
    throw new Error('Photo dimensions are invalid')
  validatePhotoTagScale(tagScale)
  let fontSize = size * 0.052 * tagScale
  let font = `700 ${fontSize}px Arial, sans-serif`
  let textWidth = tag.code.length * fontSize * 0.66
  if (context?.measureText) {
    const previousFont = context.font
    context.font = font
    textWidth = context.measureText(tag.code).width
    context.font = previousFont
  }
  // At the largest size, fit long codes as one shape, preserving the relative
  // text/padding/dot/line geometry instead of clipping letters out of a badge.
  const requestedWidth = Math.max(
    size * 0.08 * tagScale,
    textWidth + size * 0.036 * tagScale
  )
  const fit = Math.min(1, size / (requestedWidth + size * 0.02 * tagScale))
  const scale = tagScale * fit
  fontSize *= fit
  font = `700 ${fontSize}px Arial, sans-serif`
  const inset = size * 0.01 * scale
  const height = size * 0.08 * scale
  const width = requestedWidth * fit
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
    badge: { x, y, width, height, radius: size * 0.012 * scale },
    leader: {
      x1: anchor.x,
      y1: anchor.y,
      x2: centerX + dx * factor,
      y2: centerY + dy * factor,
    },
    dot: { radius: size * 0.014 * scale, innerRadius: size * 0.005 * scale },
    text: { x: centerX, y: centerY },
    font,
    fontSize,
    lineWidth: Math.max(1, size * 0.003) * scale,
  }
}

/** Standard black badges, white text and a black leader with a white-core dot. */
export function drawPhotoVariantTags(context, tags, size, tagScale = 1) {
  validatePhotoTagScale(tagScale)
  const layouts = validatePhotoVariantTags(tags).map((tag) =>
    photoVariantTagLayout(tag, size, context, tagScale)
  )
  context.save()
  for (const layout of layouts) {
    const { anchor, badge, leader, dot, text } = layout
    context.strokeStyle = '#000000'
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
    context.beginPath()
    context.arc(anchor.x, anchor.y, dot.radius, 0, Math.PI * 2)
    context.fill()
    context.fillStyle = '#ffffff'
    context.beginPath()
    context.arc(anchor.x, anchor.y, dot.innerRadius, 0, Math.PI * 2)
    context.fill()
    context.font = layout.font
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(layout.code, text.x, text.y)
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
    drawPhotoVariantTags(context, edit.tags, size, edit.tagScale ?? 1)
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
