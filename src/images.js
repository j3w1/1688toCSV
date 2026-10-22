const allowedImage =
  /^data:image\/(?:png|jpeg|webp|gif|bmp);base64,[A-Za-z0-9+/=]+$/

export const localImageReference = /^local-image:[a-f0-9]{64}$/

/** Stable content keys retain originals without repeating base64 data per product. */
export async function localImageAsset(
  dataUrl,
  storedAt = new Date().toISOString()
) {
  if (typeof dataUrl !== 'string' || !allowedImage.test(dataUrl))
    throw new Error('Imported photos must be supported raster images.')
  if (dataUrl.length > 32 * 1024 * 1024)
    throw new Error('An imported photo exceeds the 32 MB limit.')
  const bytes = Uint8Array.from(
    atob(dataUrl.slice(dataUrl.indexOf(',') + 1)),
    (character) => character.charCodeAt(0)
  )
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  const digest = [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  return { url: `local-image:${digest}`, dataUrl, storedAt }
}

export function originalImageUrl(url) {
  const parsed = new URL(url)
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'cbu01.alicdn.com' ||
    parsed.username ||
    parsed.password
  )
    throw new Error('This thumbnail host is not supported for image copying.')
  // Alibaba appends a size/quality transform after the original file extension.
  // Keep the source filename and query (including cache keys such as ?_=2020).
  parsed.pathname = parsed.pathname
    .replace(
      /(\.(?:jpe?g|png|webp|gif))(?:_|\.)\d+x\d+(?:q\d+)?\.(?:jpe?g|png|webp)(?:_\.webp)?$/i,
      '$1'
    )
    .replace(/\.\d+x\d+\.(jpe?g|png|webp)$/i, '.$1')
  return parsed.href
}

export async function loadThumbnail(url, repository) {
  if (allowedImage.test(url) && url.length <= 32 * 1024 * 1024) return url
  if (localImageReference.test(url)) {
    const cached = await repository.getImage(url)
    if (!cached)
      throw new Error(
        'The original imported photo is missing from this library.'
      )
    return cached.dataUrl
  }
  let originalUrl
  try {
    originalUrl = originalImageUrl(url)
  } catch (error) {
    if (error instanceof Error && !(error instanceof TypeError)) throw error
    throw new Error('Thumbnail URL is invalid.')
  }
  const cached = await repository.getImage(originalUrl)
  if (cached) return cached.dataUrl
  const response = await fetch(originalUrl, {
    credentials: 'omit',
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok)
    throw new Error(`Thumbnail could not be loaded (${response.status}).`)
  const mime = response.headers.get('content-type')?.split(';')[0]
  if (!/^image\/(png|jpeg|webp|gif)$/.test(mime))
    throw new Error('Thumbnail is not a supported image.')
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.length > 1_400_000)
    throw new Error('Thumbnail is too large to copy.')
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  const dataUrl = `data:${mime};base64,${btoa(binary)}`
  await repository.putImage({
    url: originalUrl,
    dataUrl,
    storedAt: new Date().toISOString(),
  })
  return dataUrl
}
