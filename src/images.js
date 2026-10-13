const allowedImage =
  /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/

export async function loadThumbnail(url, repository) {
  if (allowedImage.test(url) && url.length <= 2_000_000) return url
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('Thumbnail URL is invalid.')
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'cbu01.alicdn.com')
    throw new Error('This thumbnail host is not supported for image copying.')
  const cached = await repository.getImage(url)
  if (cached) return cached.dataUrl
  const response = await fetch(url, {
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
    url,
    dataUrl,
    storedAt: new Date().toISOString(),
  })
  return dataUrl
}
