export const DEFAULT_PHOTO_EDIT = Object.freeze({
  fit: 'contain',
  scale: 1,
  x: 0,
  y: 0,
  background: '#ffffff',
})

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
