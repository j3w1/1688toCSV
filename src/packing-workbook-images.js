import { CE_CODE_DESIGN, codeDesignMetrics } from './code-design.js'
import { codeParts } from './code-display.js'
import { photoPlacement, drawPhotoVariantTags } from './product-photo.js'

const imageBlob = (canvas, mime = 'image/png') =>
  new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error('Packing image could not be created.')),
      mime,
      0.86
    )
  )

/** The same rounded code badge and product-number reading aid as table images. */
export async function workbookCodeImage(
  value,
  { maxWidth = 512, maxHeight = 128 } = {}
) {
  if (!value) return undefined
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  const scale = 2
  let fontSize = 16 * scale
  const font = () =>
    `${CE_CODE_DESIGN.fontWeight} ${fontSize}px ${CE_CODE_DESIGN.fontFamily}`
  context.font = font()
  context.fontKerning = 'none'
  const original = codeDesignMetrics(fontSize)
  const metrics = context.measureText(value)
  const naturalWidth = metrics.width + original.paddingInline * 2
  const naturalHeight =
    metrics.actualBoundingBoxAscent +
    metrics.actualBoundingBoxDescent +
    original.paddingBlock * 2
  fontSize *= Math.min(1, maxWidth / naturalWidth, maxHeight / naturalHeight)
  context.font = font()
  const bounds = context.measureText(value)
  const design = codeDesignMetrics(fontSize)
  const ink = bounds.actualBoundingBoxAscent + bounds.actualBoundingBoxDescent
  canvas.width = Math.ceil(bounds.width + design.paddingInline * 2)
  canvas.height = Math.ceil(ink + design.paddingBlock * 2)
  context.font = font()
  context.fontKerning = 'none'
  context.fillStyle = CE_CODE_DESIGN.background
  context.beginPath()
  context.roundRect(0, 0, canvas.width, canvas.height, design.radius)
  context.fill()
  const x = (canvas.width - bounds.width) / 2
  const baseline = (canvas.height - ink) / 2 + bounds.actualBoundingBoxAscent
  context.fillStyle = CE_CODE_DESIGN.foreground
  context.fillText(value, x, baseline)
  const parts = codeParts(value)
  if (parts) {
    context.fillRect(
      x + context.measureText(parts[0]).width,
      Math.round(baseline + fontSize * 0.18),
      context.measureText(parts[1]).width,
      scale
    )
  }
  const result = {
    bytes: await imageBlob(canvas),
    width: canvas.width,
    height: canvas.height,
    mimeType: 'image/png',
  }
  canvas.width = canvas.height = 0
  return result
}

/** Decode one image at a time and retain only small assets, never original pixels. */
export function createPackingWorkbookImages(loadImage, renderCartonMark) {
  const photos = new Map()
  const marks = new Map()
  const codes = new Map()
  return async (row, limits) => {
    const value = row.barcode || row.baseCode
    let code
    if (limits.code && value) {
      const key = JSON.stringify([
        value,
        limits.code.maxWidth ?? 512,
        limits.code.maxHeight ?? 128,
      ])
      let pending = codes.get(key)
      if (!pending) {
        if (codes.size >= 24) codes.delete(codes.keys().next().value)
        pending = workbookCodeImage(value, limits.code)
        codes.set(key, pending)
      }
      try {
        code = await pending
      } catch (error) {
        if (codes.get(key) === pending) codes.delete(key)
        throw error
      }
    }
    const result = { code }
    if (
      limits.mark &&
      row.baseCode &&
      row.chineseCategory?.trim() &&
      renderCartonMark
    ) {
      const key = JSON.stringify([row.baseCode, row.chineseCategory])
      if (!marks.has(key)) {
        const create = async () => {
          const blob = await renderCartonMark(row)
          const image = new Image()
          const url = URL.createObjectURL(blob)
          const canvas = document.createElement('canvas')
          try {
            image.src = url
            await image.decode()
            const scale = Math.min(
              1,
              limits.mark.maxWidth / image.naturalWidth,
              limits.mark.maxHeight / image.naturalHeight
            )
            canvas.width = Math.max(1, Math.floor(image.naturalWidth * scale))
            canvas.height = Math.max(1, Math.floor(image.naturalHeight * scale))
            const context = canvas.getContext('2d')
            context.fillStyle = '#fff'
            context.fillRect(0, 0, canvas.width, canvas.height)
            context.drawImage(image, 0, 0, canvas.width, canvas.height)
            return {
              bytes: await imageBlob(canvas),
              width: canvas.width,
              height: canvas.height,
              mimeType: 'image/png',
            }
          } finally {
            image.removeAttribute('src')
            URL.revokeObjectURL(url)
            canvas.width = canvas.height = 0
          }
        }
        if (marks.size >= 24) marks.delete(marks.keys().next().value)
        const pending = create()
        marks.set(key, pending)
        try {
          await pending
        } catch (error) {
          marks.delete(key)
          throw error
        }
      }
      result.mark = await marks.get(key)
    }
    if (!limits.photo) return result
    const edit = row.photoEdits?.[0]
    const source = edit
      ? row.photos?.[0] || row.thumbnail
      : row.thumbnail || row.photos?.[0]
    if (!source) return result
    const signature = JSON.stringify(edit || {})
    const cached = photos.get(source)
    let photo = cached?.signature === signature ? cached.asset : undefined
    if (!photo) {
      const loaded = await loadImage(source)
      const blob =
        loaded instanceof Blob ? loaded : await (await fetch(loaded)).blob()
      const image = new Image()
      const url = URL.createObjectURL(blob)
      const canvas = document.createElement('canvas')
      try {
        image.src = url
        await image.decode()
        canvas.width = canvas.height = Math.min(
          limits.photo.maxWidth,
          limits.photo.maxHeight
        )
        const context = canvas.getContext('2d')
        context.fillStyle = edit?.background || '#fff'
        context.fillRect(0, 0, canvas.width, canvas.height)
        const rect = photoPlacement(
          image.naturalWidth,
          image.naturalHeight,
          canvas.width,
          edit
        )
        context.drawImage(image, rect.x, rect.y, rect.width, rect.height)
        if (edit?.tags?.length)
          drawPhotoVariantTags(
            context,
            edit.tags,
            canvas.width,
            edit.tagScale ?? 1,
            edit.pointerScale ?? 1,
            edit.invertPointer ?? false
          )
        photo = {
          bytes: await imageBlob(canvas, 'image/jpeg'),
          width: canvas.width,
          height: canvas.height,
          mimeType: 'image/jpeg',
        }
      } finally {
        image.removeAttribute('src')
        URL.revokeObjectURL(url)
        canvas.width = canvas.height = 0
      }
      if (photos.size >= 24) photos.delete(photos.keys().next().value)
      photos.set(source, { signature, asset: photo })
    }
    return { ...result, photo }
  }
}
