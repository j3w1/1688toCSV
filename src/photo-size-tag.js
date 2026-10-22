import { createSizeClassifier } from './size-vocabulary.js'
import { sourceSizeForCopy } from './preparation-clipboard.js'
import {
  photoVariantTagLayout,
  photoEditDraft,
  validPhotoTagText,
} from './product-photo.js'

/** Reuse source recognition without treating a saved barcode ending as a size. */
export function recognizedPhotoSize(
  item = {},
  classifier = createSizeClassifier()
) {
  const source =
    item.sourceGroup || !item.group
      ? item
      : { ...item, sourceGroup: item.group }
  const extracted = sourceSizeForCopy(source, classifier).trim()
  if (validPhotoTagText(extracted)) return extracted
  // Copied preparation rows may carry the original size separately. Never use
  // sizeSuffix, whose assigned letters are not the supplier's measurement.
  if (typeof item.sourceSize !== 'string' || !item.sourceSize.trim()) return ''
  const fallback = sourceSizeForCopy(
    {
      skuProperties: [{ label: '尺寸', value: item.sourceSize }],
    },
    classifier
  ).trim()
  return validPhotoTagText(fallback) ? fallback : ''
}

const textKey = (value) =>
  value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')

export function hasPhotoSizeTag(edit, text) {
  return (
    Boolean(text) &&
    (edit?.tags || []).some((tag) => textKey(tag.code) === textKey(text))
  )
}

/** Keep the size label bottom-right and its point 75% across the photo. */
export function addPhotoSizeTag(
  saved,
  text,
  { context, size = 640, id = crypto.randomUUID() } = {}
) {
  if (!validPhotoTagText(text))
    throw new Error(
      'No size was recognized in this product’s original description.'
    )
  if (hasPhotoSizeTag(saved, text)) return null
  const edit = photoEditDraft(saved)
  if ((edit.tags?.length || 0) >= 50)
    throw new Error('Photo variant tags must contain at most 50 callouts')
  const tag = { id, code: text, x: 0.75, y: 0.5, labelX: 1, labelY: 1 }
  const layout = photoVariantTagLayout(tag, size, context, edit.tagScale)
  tag.labelX = layout.text.x / size
  tag.labelY = layout.text.y / size
  edit.tags = [...(edit.tags || []), tag]
  return edit
}
